//! The contract that runs on every That Invoice invoice account.
//!
//! An invoice is a NEAR account. Whoever pays the invoice sends a NEP-141 token
//! (USDC) to this account. The account holds the money and has exactly one
//! power: when the registry that created it says so, it forwards the balance to
//! the invoice's *current* owner. There is no key on the account, no upgrade
//! path (it is published as a global contract by hash), and no other method
//! that can move funds.

use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, NearToken, Promise, PromiseOrValue};

const GAS_FT_TRANSFER: near_sdk::Gas = near_sdk::Gas::from_tgas(15);

#[near(contract_state)]
pub struct InvoiceAccount {
    registry: AccountId,
    token: AccountId,
}

impl Default for InvoiceAccount {
    fn default() -> Self {
        env::panic_str("invoice account is not initialised")
    }
}

#[near]
impl InvoiceAccount {
    /// Runs in the same batch that creates the account, so nobody can front-run it.
    #[init]
    pub fn new(registry: AccountId, token: AccountId) -> Self {
        require!(
            env::predecessor_account_id() == registry,
            "only the registry initialises an invoice account"
        );
        Self { registry, token }
    }

    /// Forward `amount` of the invoice currency to `to`. Registry only.
    #[payable]
    pub fn release(&mut self, to: AccountId, amount: U128) -> Promise {
        require!(
            env::predecessor_account_id() == self.registry,
            "only the registry can release funds"
        );
        require!(
            env::attached_deposit() == NearToken::from_yoctonear(1),
            "attach exactly 1 yoctoNEAR"
        );
        Promise::new(self.token.clone()).function_call(
            "ft_transfer".to_string(),
            format!(r#"{{"receiver_id":"{}","amount":"{}"}}"#, to, amount.0).into_bytes(),
            NearToken::from_yoctonear(1),
            GAS_FT_TRANSFER,
        )
    }

    /// Accept a `ft_transfer_call` of the invoice currency. Anything else is refunded in full.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let _ = (sender_id, msg);
        if env::predecessor_account_id() == self.token {
            PromiseOrValue::Value(U128(0))
        } else {
            PromiseOrValue::Value(amount)
        }
    }

    pub fn info(&self) -> (AccountId, AccountId) {
        (self.registry.clone(), self.token.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    fn ctx(pred: AccountId, deposit: u128) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(pred)
            .attached_deposit(NearToken::from_yoctonear(deposit));
        b
    }

    #[test]
    #[should_panic(expected = "only the registry can release funds")]
    fn stranger_cannot_release() {
        testing_env!(ctx(accounts(0), 0).build());
        let mut c = InvoiceAccount::new(accounts(0), accounts(1));
        testing_env!(ctx(accounts(2), 1).build());
        let _ = c.release(accounts(2), U128(1));
    }

    #[test]
    fn registry_can_release() {
        testing_env!(ctx(accounts(0), 0).build());
        let mut c = InvoiceAccount::new(accounts(0), accounts(1));
        testing_env!(ctx(accounts(0), 1).build());
        let _ = c.release(accounts(2), U128(5));
    }

    #[test]
    #[should_panic(expected = "only the registry initialises")]
    fn stranger_cannot_init() {
        testing_env!(ctx(accounts(3), 0).build());
        let _ = InvoiceAccount::new(accounts(0), accounts(1));
    }

    #[test]
    fn foreign_tokens_are_refunded() {
        testing_env!(ctx(accounts(0), 0).build());
        let mut c = InvoiceAccount::new(accounts(0), accounts(1));
        testing_env!(ctx(accounts(4), 0).build());
        match c.ft_on_transfer(accounts(2), U128(9), String::new()) {
            PromiseOrValue::Value(v) => assert_eq!(v.0, 9),
            _ => panic!(),
        }
    }
}
