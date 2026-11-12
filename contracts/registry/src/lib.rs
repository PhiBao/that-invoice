//! That Invoice registry.
//!
//! Every invoice is three things at once:
//!
//! 1. a **NEAR account** (`inv-N.<registry>`), created by this contract and running the
//!    immutable `invoice-account` contract, so a client can pay it from anywhere;
//! 2. a **NEP-171 token** in this collection, owned by whoever is currently entitled to the money;
//! 3. a **record** with a state machine and an on-chain endorsement log.
//!
//! The money is never held by the issuer. It lands in the invoice account and can only leave
//! through `claim`, which pays the *current* owner. Selling the invoice therefore moves the
//! right to the payment without moving the payment address.
//!
//! State machine:
//!
//! ```text
//! Creating -> Issued -> Confirmed <-> Listed
//!                 \         \          \
//!                  `---------`----------`--> Paid -> Claiming -> Claimed
//!                                                  `-(failure)-> Paid
//! ```
//!
//! `Listed` and `Claiming` lock the token: it cannot be transferred, re-listed or claimed
//! a second time while a sale or a payout is in flight.

use near_sdk::json_types::{Base58CryptoHash, U128, U64};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    env, near, require, AccountId, CryptoHash, Gas, NearToken, PanicOnDefault, Promise,
    PromiseOrValue,
};

const GAS_INIT: Gas = Gas::from_tgas(10);
const GAS_STORAGE_DEPOSIT: Gas = Gas::from_tgas(10);
const GAS_CALLBACK: Gas = Gas::from_tgas(15);
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_FT_BALANCE: Gas = Gas::from_tgas(5);
const GAS_RELEASE: Gas = Gas::from_tgas(35);

/// What the issuer attaches to `issue`. Funds the invoice account and the registry's storage.
pub const ISSUE_DEPOSIT: NearToken = NearToken::from_millinear(100);
/// Balance given to the new invoice account (enough for its tiny state and contract reference).
const ACCOUNT_FUND: NearToken = NearToken::from_millinear(40);
/// Registers the invoice account on the token (NEP-145). The token refunds any excess.
const TOKEN_STORAGE: NearToken = NearToken::from_millinear(2);

const MAX_LOG: usize = 40;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    /// Account creation is in flight. The invoice cannot be used yet.
    Creating,
    Issued,
    Confirmed,
    Listed,
    Paid,
    Claiming,
    Claimed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Issued,
    Confirmed,
    Listed,
    Delisted,
    Sold,
    Transferred,
    Paid,
    ClaimFailed,
    Claimed,
}

/// One line on the back of the invoice.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Endorsement {
    pub kind: Kind,
    pub by: AccountId,
    pub counterparty: Option<AccountId>,
    pub amount: Option<U128>,
    pub at_ms: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Invoice {
    pub id: AccountId,
    pub seq: U64,
    pub issuer: AccountId,
    pub debtor: AccountId,
    pub owner: AccountId,
    pub number: String,
    /// Face value in the smallest unit of the registry's token.
    pub amount: U128,
    pub due_ms: U64,
    /// Hash of the off-chain invoice document (line items stay off-chain).
    pub doc_hash: String,
    pub status: Status,
    /// Asking price while `Listed`.
    pub price: Option<U128>,
    /// Balance observed on the invoice account at the last `sync`.
    pub received: U128,
    pub issued_ms: U64,
    pub paid_ms: Option<U64>,
    pub log: Vec<Endorsement>,
}

/// How a debtor has behaved. Only confirmed and paid invoices count, so nobody can
/// pollute a debtor's record by issuing invoices against them.
#[near(serializers = [borsh, json])]
#[derive(Clone, Default, Debug)]
pub struct DebtorRecord {
    pub confirmed: u32,
    pub paid: u32,
    pub paid_on_time: u32,
    pub paid_total: U128,
    pub late_ms_total: U64,
}

#[near(serializers = [json])]
pub struct Config {
    pub token: AccountId,
    pub invoice_code_hash: Base58CryptoHash,
    pub invoices: U64,
}

/// NEP-171 `Token`.
#[near(serializers = [json])]
pub struct Token {
    pub token_id: String,
    pub owner_id: AccountId,
}

#[near(serializers = [json])]
pub struct NftContractMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Registry {
    token: AccountId,
    invoice_code_hash: CryptoHash,
    next_seq: u64,
    invoices: IterableMap<AccountId, Invoice>,
    /// `issuer|debtor|number` -> invoice id. One invoice number exists once per issuer and debtor.
    keys: LookupMap<String, AccountId>,
    /// Sale proceeds that could not be pushed to the seller. Pull with `withdraw_proceeds`.
    proceeds: LookupMap<AccountId, u128>,
    debtors: LookupMap<AccountId, DebtorRecord>,
}

fn now_ms() -> u64 {
    env::block_timestamp_ms()
}

fn emit(standard: &str, version: &str, event: &str, data: near_sdk::serde_json::Value) {
    let e = near_sdk::serde_json::json!({
        "standard": standard, "version": version, "event": event, "data": data
    });
    env::log_str(&format!("EVENT_JSON:{e}"));
}

fn ft_transfer(token: &AccountId, to: &AccountId, amount: u128, memo: &str) -> Promise {
    Promise::new(token.clone()).function_call(
        "ft_transfer".to_string(),
        near_sdk::serde_json::json!({ "receiver_id": to, "amount": U128(amount), "memo": memo })
            .to_string()
            .into_bytes(),
        NearToken::from_yoctonear(1),
        GAS_FT_TRANSFER,
    )
}

#[near]
impl Registry {
    /// `token` is the NEP-141 the invoices are denominated in (USDC). The registry account must
    /// be registered on it (NEP-145) before the first sale.
    /// `invoice_code_hash` is the hash of the already-published `invoice-account` global contract.
    #[init]
    pub fn new(token: AccountId, invoice_code_hash: Base58CryptoHash) -> Self {
        Self {
            token,
            invoice_code_hash: invoice_code_hash.into(),
            next_seq: 0,
            invoices: IterableMap::new(b"i"),
            keys: LookupMap::new(b"k"),
            proceeds: LookupMap::new(b"p"),
            debtors: LookupMap::new(b"d"),
        }
    }

    // ───────────────────────────── issue ─────────────────────────────

    /// Create an invoice and its account. The caller is the issuer and first owner.
    /// Attach at least `ISSUE_DEPOSIT`. The deposit is refunded if account creation fails.
    #[payable]
    pub fn issue(
        &mut self,
        debtor: AccountId,
        number: String,
        amount: U128,
        due_ms: U64,
        doc_hash: String,
    ) -> Promise {
        let issuer = env::predecessor_account_id();
        let deposit = env::attached_deposit();
        require!(
            deposit >= ISSUE_DEPOSIT,
            format!("attach at least {ISSUE_DEPOSIT} to issue an invoice")
        );
        require!(debtor != issuer, "an invoice cannot be addressed to its issuer");
        require!(amount.0 > 0, "amount must be positive");
        require!(
            !number.is_empty()
                && number.len() <= 40
                && number.chars().all(|c| c.is_ascii_graphic() && c != '|'),
            "invoice number: 1-40 printable characters, no '|'"
        );
        require!(doc_hash.len() <= 128, "doc_hash too long");

        let key = format!("{issuer}|{debtor}|{}", number.to_lowercase());
        if let Some(existing) = self.keys.get(&key) {
            let owner = self.invoices.get(existing).map(|i| i.owner.to_string());
            env::panic_str(&format!(
                "invoice {number} from {issuer} to {debtor} already exists as {existing} (owner: {})",
                owner.unwrap_or_default()
            ));
        }

        self.next_seq += 1;
        let id: AccountId = format!("inv-{}.{}", self.next_seq, env::current_account_id())
            .parse()
            .unwrap();
        let now = now_ms();
        let invoice = Invoice {
            id: id.clone(),
            seq: U64(self.next_seq),
            issuer: issuer.clone(),
            debtor,
            owner: issuer.clone(),
            number,
            amount,
            due_ms,
            doc_hash,
            status: Status::Creating,
            price: None,
            received: U128(0),
            issued_ms: U64(now),
            paid_ms: None,
            log: vec![],
        };
        self.keys.insert(key, id.clone());
        self.invoices.insert(id.clone(), invoice);

        let create = Promise::new(id.clone())
            .create_account()
            .transfer(ACCOUNT_FUND)
            .use_global_contract(self.invoice_code_hash)
            .function_call(
                "new".to_string(),
                near_sdk::serde_json::json!({
                    "registry": env::current_account_id(),
                    "token": self.token,
                })
                .to_string()
                .into_bytes(),
                NearToken::from_near(0),
                GAS_INIT,
            );
        let register = Promise::new(self.token.clone()).function_call(
            "storage_deposit".to_string(),
            near_sdk::serde_json::json!({ "account_id": id, "registration_only": true })
                .to_string()
                .into_bytes(),
            TOKEN_STORAGE,
            GAS_STORAGE_DEPOSIT,
        );
        create.and(register).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_CALLBACK)
                .on_created(id, issuer, U128(deposit.as_yoctonear())),
        )
    }

    #[private]
    pub fn on_created(&mut self, id: AccountId, issuer: AccountId, deposit: U128) -> bool {
        let ok = (0..env::promise_results_count())
            .all(|i| env::promise_result_checked(i, 4096).is_ok());
        if !ok {
            if let Some(inv) = self.invoices.remove(&id) {
                let key = format!(
                    "{}|{}|{}",
                    inv.issuer,
                    inv.debtor,
                    inv.number.to_lowercase()
                );
                self.keys.remove(&key);
            }
            Promise::new(issuer).transfer(NearToken::from_yoctonear(deposit.0));
            emit(
                "thatinvoice",
                "1.0.0",
                "issue_failed",
                near_sdk::serde_json::json!([{ "invoice": id }]),
            );
            return false;
        }
        let mut inv = self.must(&id);
        inv.status = Status::Issued;
        let face = inv.amount;
        self.push_log(&mut inv, Kind::Issued, issuer.clone(), None, Some(face));
        let owner = inv.owner.clone();
        let debtor = inv.debtor.clone();
        let number = inv.number.clone();
        let amount = inv.amount;
        let due = inv.due_ms;
        self.invoices.insert(id.clone(), inv);
        emit(
            "nep171",
            "1.2.0",
            "nft_mint",
            near_sdk::serde_json::json!([{ "owner_id": owner, "token_ids": [id.to_string()] }]),
        );
        emit(
            "thatinvoice",
            "1.0.0",
            "issued",
            near_sdk::serde_json::json!([{
                "invoice": id, "issuer": issuer, "debtor": debtor, "number": number,
                "amount": amount, "due_ms": due
            }]),
        );
        true
    }

    // ─────────────────────────── confirm / list ───────────────────────────

    /// The debtor (a person, a contract, or a DAO executing a proposal) acknowledges the invoice.
    /// Only confirmed invoices can be listed for sale.
    pub fn confirm(&mut self, id: AccountId) {
        let mut inv = self.must(&id);
        let caller = env::predecessor_account_id();
        require!(caller == inv.debtor, "only the debtor can confirm an invoice");
        require!(inv.status == Status::Issued, "only an issued invoice can be confirmed");
        inv.status = Status::Confirmed;
        self.push_log(&mut inv, Kind::Confirmed, caller, None, None);
        let debtor = inv.debtor.clone();
        self.invoices.insert(id.clone(), inv);
        let mut rec = self.debtors.get(&debtor).cloned().unwrap_or_default();
        rec.confirmed += 1;
        self.debtors.insert(debtor.clone(), rec);
        emit(
            "thatinvoice",
            "1.0.0",
            "confirmed",
            near_sdk::serde_json::json!([{ "invoice": id, "debtor": debtor }]),
        );
    }

    /// Offer a confirmed invoice for `price` (in the invoice token). Locks the token.
    pub fn list(&mut self, id: AccountId, price: U128) {
        let mut inv = self.must(&id);
        let caller = env::predecessor_account_id();
        require!(caller == inv.owner, "only the owner can list an invoice");
        require!(inv.status == Status::Confirmed, "only a confirmed invoice can be listed");
        require!(price.0 > 0 && price.0 <= inv.amount.0, "price must be between 1 and the face value");
        inv.status = Status::Listed;
        inv.price = Some(price);
        self.push_log(&mut inv, Kind::Listed, caller.clone(), None, Some(price));
        self.invoices.insert(id.clone(), inv);
        emit(
            "thatinvoice",
            "1.0.0",
            "listed",
            near_sdk::serde_json::json!([{ "invoice": id, "owner": caller, "price": price }]),
        );
    }

    pub fn delist(&mut self, id: AccountId) {
        let mut inv = self.must(&id);
        let caller = env::predecessor_account_id();
        require!(caller == inv.owner, "only the owner can delist an invoice");
        require!(inv.status == Status::Listed, "invoice is not listed");
        inv.status = Status::Confirmed;
        inv.price = None;
        self.push_log(&mut inv, Kind::Delisted, caller.clone(), None, None);
        self.invoices.insert(id.clone(), inv);
        emit(
            "thatinvoice",
            "1.0.0",
            "delisted",
            near_sdk::serde_json::json!([{ "invoice": id, "owner": caller }]),
        );
    }

    // ───────────────────────────── buy ─────────────────────────────

    /// NEP-141 receiver. To buy, `ft_transfer_call` the invoice token to the registry with
    /// `msg = {"buy":"inv-N.<registry>"}`. Ownership moves and the seller is paid in the same
    /// receipt. Anything that does not qualify is refunded in full instead of failing.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        if env::predecessor_account_id() != self.token {
            return PromiseOrValue::Value(amount);
        }
        #[derive(near_sdk::serde::Deserialize)]
        #[serde(crate = "near_sdk::serde")]
        struct Buy {
            buy: AccountId,
        }
        let Ok(Buy { buy: id }) = near_sdk::serde_json::from_str::<Buy>(&msg) else {
            return PromiseOrValue::Value(amount);
        };
        let Some(mut inv) = self.invoices.get(&id).cloned() else {
            return PromiseOrValue::Value(amount);
        };
        let Some(price) = inv.price else {
            return PromiseOrValue::Value(amount);
        };
        if inv.status != Status::Listed || sender_id == inv.owner || amount.0 < price.0 {
            return PromiseOrValue::Value(amount);
        }

        // Effects first.
        let seller = inv.owner.clone();
        inv.owner = sender_id.clone();
        inv.status = Status::Confirmed;
        inv.price = None;
        self.push_log(&mut inv, Kind::Sold, sender_id.clone(), Some(seller.clone()), Some(price));
        self.invoices.insert(id.clone(), inv);

        // Then pay the seller. If the push fails the proceeds are credited for withdrawal.
        let _detached = ft_transfer(&self.token, &seller, price.0, "that-invoice sale").then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_CALLBACK)
                .on_proceeds_sent(seller.clone(), price),
        );

        emit(
            "nep171",
            "1.2.0",
            "nft_transfer",
            near_sdk::serde_json::json!([{
                "old_owner_id": seller, "new_owner_id": sender_id, "token_ids": [id.to_string()],
                "memo": "sale"
            }]),
        );
        emit(
            "thatinvoice",
            "1.0.0",
            "sold",
            near_sdk::serde_json::json!([{
                "invoice": id, "seller": seller, "buyer": sender_id, "price": price
            }]),
        );
        PromiseOrValue::Value(U128(amount.0 - price.0))
    }

    #[private]
    pub fn on_proceeds_sent(&mut self, to: AccountId, amount: U128) {
        if env::promise_result_checked(0, 64).is_err() {
            let cur = self.proceeds.get(&to).copied().unwrap_or(0);
            self.proceeds.insert(to.clone(), cur + amount.0);
            emit(
                "thatinvoice",
                "1.0.0",
                "proceeds_credited",
                near_sdk::serde_json::json!([{ "account": to, "amount": amount }]),
            );
        }
    }

    /// Pull sale proceeds that could not be pushed (for example the seller had not registered on the token).
    pub fn withdraw_proceeds(&mut self) -> Promise {
        let who = env::predecessor_account_id();
        let amount = self.proceeds.remove(&who).unwrap_or(0);
        require!(amount > 0, "no proceeds to withdraw");
        ft_transfer(&self.token, &who, amount, "that-invoice proceeds").then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_CALLBACK)
                .on_proceeds_sent(who, U128(amount)),
        )
    }

    // ───────────────────────────── pay / claim ─────────────────────────────

    /// Anyone can ask the registry to look at the invoice account's token balance.
    /// When the balance covers the face value the invoice becomes `Paid`.
    /// The registry trusts the token contract's balance, not any callback from a payer.
    pub fn sync(&mut self, id: AccountId) -> Promise {
        let inv = self.must(&id);
        require!(
            matches!(
                inv.status,
                Status::Issued | Status::Confirmed | Status::Listed | Status::Paid
            ),
            "invoice cannot be synced in its current state"
        );
        Promise::new(self.token.clone())
            .function_call(
                "ft_balance_of".to_string(),
                near_sdk::serde_json::json!({ "account_id": id })
                    .to_string()
                    .into_bytes(),
                NearToken::from_near(0),
                GAS_FT_BALANCE,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_synced(id),
            )
    }

    #[private]
    pub fn on_synced(&mut self, id: AccountId) -> bool {
        let Ok(bytes) = env::promise_result_checked(0, 256) else {
            return false;
        };
        let Ok(balance) = near_sdk::serde_json::from_slice::<U128>(&bytes) else {
            return false;
        };
        let mut inv = self.must(&id);
        match inv.status {
            Status::Issued | Status::Confirmed | Status::Listed if balance.0 >= inv.amount.0 => {
                let now = now_ms();
                inv.status = Status::Paid;
                inv.price = None; // a paid invoice is no longer for sale
                inv.received = balance;
                inv.paid_ms = Some(U64(now));
                let owner = inv.owner.clone();
                self.push_log(&mut inv, Kind::Paid, id.clone(), None, Some(balance));
                let debtor = inv.debtor.clone();
                let due = inv.due_ms.0;
                let face = inv.amount.0;
                self.invoices.insert(id.clone(), inv);

                let mut rec = self.debtors.get(&debtor).cloned().unwrap_or_default();
                rec.paid += 1;
                if now <= due {
                    rec.paid_on_time += 1;
                } else {
                    rec.late_ms_total = U64(rec.late_ms_total.0.saturating_add(now - due));
                }
                rec.paid_total = U128(rec.paid_total.0.saturating_add(face));
                self.debtors.insert(debtor, rec);
                emit(
                    "thatinvoice",
                    "1.0.0",
                    "paid",
                    near_sdk::serde_json::json!([{
                        "invoice": id, "owner": owner, "received": balance, "on_time": now <= due
                    }]),
                );
                true
            }
            Status::Paid if balance.0 > inv.received.0 => {
                inv.received = balance;
                self.invoices.insert(id, inv);
                true
            }
            _ => false,
        }
    }

    /// The current owner collects the money. The token is locked (`Claiming`) until the payout
    /// settles, so it cannot be sold or claimed twice mid-flight.
    pub fn claim(&mut self, id: AccountId) -> Promise {
        let mut inv = self.must(&id);
        let caller = env::predecessor_account_id();
        require!(caller == inv.owner, "only the current owner can claim");
        require!(inv.status == Status::Paid, "invoice is not paid");
        let amount = inv.received;
        inv.status = Status::Claiming;
        self.invoices.insert(id.clone(), inv);
        Promise::new(id.clone())
            .function_call(
                "release".to_string(),
                near_sdk::serde_json::json!({ "to": caller, "amount": amount })
                    .to_string()
                    .into_bytes(),
                NearToken::from_yoctonear(1),
                GAS_RELEASE,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_claimed(id, caller, amount),
            )
    }

    #[private]
    pub fn on_claimed(&mut self, id: AccountId, to: AccountId, amount: U128) -> bool {
        let ok = env::promise_result_checked(0, 256).is_ok();
        let mut inv = self.must(&id);
        require!(inv.status == Status::Claiming, "invoice is not being claimed");
        if ok {
            inv.status = Status::Claimed;
            self.push_log(&mut inv, Kind::Claimed, to.clone(), None, Some(amount));
            self.invoices.insert(id.clone(), inv);
            emit(
                "thatinvoice",
                "1.0.0",
                "claimed",
                near_sdk::serde_json::json!([{ "invoice": id, "owner": to, "amount": amount }]),
            );
        } else {
            inv.status = Status::Paid;
            self.push_log(&mut inv, Kind::ClaimFailed, to, None, Some(amount));
            self.invoices.insert(id, inv);
        }
        ok
    }

    // ───────────────────────────── NEP-171 ─────────────────────────────

    /// NEP-171 transfer. Refused while the invoice is listed, being claimed, or still being created.
    #[payable]
    pub fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        require!(
            env::attached_deposit() == NearToken::from_yoctonear(1),
            "requires attached deposit of exactly 1 yoctoNEAR"
        );
        require!(approval_id.is_none(), "approvals are not supported");
        let id: AccountId = token_id.parse().unwrap_or_else(|_| env::panic_str("bad token id"));
        let mut inv = self.must(&id);
        let caller = env::predecessor_account_id();
        require!(caller == inv.owner, "only the owner can transfer");
        require!(receiver_id != inv.owner, "receiver is already the owner");
        require!(
            matches!(
                inv.status,
                Status::Issued | Status::Confirmed | Status::Paid | Status::Claimed
            ),
            "invoice is locked (listed, being claimed, or not ready)"
        );
        let old = inv.owner.clone();
        inv.owner = receiver_id.clone();
        self.push_log(&mut inv, Kind::Transferred, caller, Some(receiver_id.clone()), None);
        self.invoices.insert(id.clone(), inv);
        emit(
            "nep171",
            "1.2.0",
            "nft_transfer",
            near_sdk::serde_json::json!([{
                "old_owner_id": old, "new_owner_id": receiver_id, "token_ids": [token_id],
                "memo": memo
            }]),
        );
    }

    pub fn nft_token(&self, token_id: String) -> Option<Token> {
        let id: AccountId = token_id.parse().ok()?;
        let inv = self.invoices.get(&id)?;
        if inv.status == Status::Creating {
            return None;
        }
        Some(Token { token_id, owner_id: inv.owner.clone() })
    }

    pub fn nft_total_supply(&self) -> U128 {
        U128(self.invoices.values().filter(|i| i.status != Status::Creating).count() as u128)
    }

    pub fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.invoices
            .values()
            .filter(|i| i.status != Status::Creating)
            .skip(from_index.map(|f| f.0 as usize).unwrap_or(0))
            .take(limit.unwrap_or(50) as usize)
            .map(|i| Token { token_id: i.id.to_string(), owner_id: i.owner.clone() })
            .collect()
    }

    pub fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        U128(
            self.invoices
                .values()
                .filter(|i| i.owner == account_id && i.status != Status::Creating)
                .count() as u128,
        )
    }

    pub fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        self.invoices
            .values()
            .filter(|i| i.owner == account_id && i.status != Status::Creating)
            .skip(from_index.map(|f| f.0 as usize).unwrap_or(0))
            .take(limit.unwrap_or(50) as usize)
            .map(|i| Token { token_id: i.id.to_string(), owner_id: i.owner.clone() })
            .collect()
    }

    pub fn nft_metadata(&self) -> NftContractMetadata {
        NftContractMetadata {
            spec: "nft-1.0.0".to_string(),
            name: "That Invoice".to_string(),
            symbol: "INV".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }

    // ───────────────────────────── views ─────────────────────────────

    pub fn config(&self) -> Config {
        Config {
            token: self.token.clone(),
            invoice_code_hash: Base58CryptoHash::from(self.invoice_code_hash),
            invoices: U64(self.invoices.len() as u64),
        }
    }

    pub fn invoice(&self, id: AccountId) -> Option<Invoice> {
        self.invoices.get(&id).cloned()
    }

    pub fn invoices(&self, from_index: Option<U64>, limit: Option<u64>) -> Vec<Invoice> {
        self.invoices
            .values()
            .skip(from_index.map(|f| f.0 as usize).unwrap_or(0))
            .take(limit.unwrap_or(50).min(100) as usize)
            .cloned()
            .collect()
    }

    pub fn debtor_record(&self, debtor: AccountId) -> DebtorRecord {
        self.debtors.get(&debtor).cloned().unwrap_or_default()
    }

    pub fn proceeds_of(&self, account_id: AccountId) -> U128 {
        U128(self.proceeds.get(&account_id).copied().unwrap_or(0))
    }
}

impl Registry {
    fn must(&self, id: &AccountId) -> Invoice {
        self.invoices
            .get(id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no such invoice"))
    }

    fn push_log(
        &self,
        inv: &mut Invoice,
        kind: Kind,
        by: AccountId,
        counterparty: Option<AccountId>,
        amount: Option<U128>,
    ) {
        if inv.log.len() >= MAX_LOG {
            // Keep the first (issue) line and drop the oldest middle line.
            inv.log.remove(1);
        }
        inv.log.push(Endorsement { kind, by, counterparty, amount, at_ms: U64(now_ms()) });
    }
}

#[cfg(test)]
mod tests;
