use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, PromiseResult};

const REGISTRY: &str = "registry.test.near";
const TOKEN: &str = "usdc.test.near";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(pred: &str, deposit: NearToken) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc(REGISTRY))
        .predecessor_account_id(acc(pred))
        .signer_account_id(acc(pred))
        .attached_deposit(deposit)
        .block_timestamp(1_000_000_000_000_000); // ms = 1_000_000_000
    b
}

fn at(pred: &str) {
    testing_env!(ctx(pred, NearToken::from_near(0)).build());
}

fn with_results(pred: &str, results: Vec<PromiseResult>) {
    testing_env!(
        ctx(pred, NearToken::from_near(0)).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        results
    );
}

fn ok(bytes: &[u8]) -> PromiseResult {
    PromiseResult::Successful(bytes.to_vec())
}

fn fresh() -> Registry {
    testing_env!(ctx("deployer.test.near", NearToken::from_near(0)).build());
    Registry::new(acc(TOKEN), Base58CryptoHash::from([7u8; 32]))
}

fn inv_id(n: u64) -> AccountId {
    acc(&format!("inv-{n}.{REGISTRY}"))
}

const FACE: u128 = 1_200_000_000; // 1,200 USDC (6 decimals)
const PRICE: u128 = 1_176_000_000;

/// Issue `inv-1` from studio to acme and finish creation.
fn issued(r: &mut Registry) -> AccountId {
    testing_env!(ctx("studio.test.near", ISSUE_DEPOSIT).build());
    let _ = r.issue(
        acc("acme.test.near"),
        "0042".into(),
        U128(FACE),
        U64(2_000_000_000),
        "sha256:abc".into(),
    );
    with_results(REGISTRY, vec![ok(b""), ok(b"{}")]);
    assert!(r.on_created(inv_id(1), acc("studio.test.near"), U128(ISSUE_DEPOSIT.as_yoctonear())));
    inv_id(1)
}

fn confirmed(r: &mut Registry) -> AccountId {
    let id = issued(r);
    at("acme.test.near");
    r.confirm(id.clone());
    id
}

fn listed(r: &mut Registry) -> AccountId {
    let id = confirmed(r);
    at("studio.test.near");
    r.list(id.clone(), U128(PRICE));
    id
}

fn buy_msg(id: &AccountId) -> String {
    format!(r#"{{"buy":"{id}"}}"#)
}

fn value(p: PromiseOrValue<U128>) -> u128 {
    match p {
        PromiseOrValue::Value(v) => v.0,
        _ => panic!("expected value"),
    }
}

fn mark_paid(r: &mut Registry, id: &AccountId, balance: u128) -> bool {
    with_results(REGISTRY, vec![ok(format!("\"{balance}\"").as_bytes())]);
    r.on_synced(id.clone())
}

#[test]
fn issue_creates_issued_invoice_owned_by_issuer() {
    let mut r = fresh();
    let id = issued(&mut r);
    let inv = r.invoice(id.clone()).unwrap();
    assert_eq!(inv.status, Status::Issued);
    assert_eq!(inv.owner, acc("studio.test.near"));
    assert_eq!(inv.debtor, acc("acme.test.near"));
    assert_eq!(inv.log.len(), 1);
    assert_eq!(r.nft_token(id.to_string()).unwrap().owner_id, acc("studio.test.near"));
}

#[test]
#[should_panic(expected = "already exists as inv-1.registry.test.near")]
fn the_same_invoice_cannot_exist_twice() {
    let mut r = fresh();
    issued(&mut r);
    testing_env!(ctx("studio.test.near", ISSUE_DEPOSIT).build());
    let _ = r.issue(acc("acme.test.near"), "0042".into(), U128(FACE), U64(2_000_000_000), "x".into());
}

#[test]
#[should_panic(expected = "already exists")]
fn duplicate_check_ignores_case_in_the_number() {
    let mut r = fresh();
    testing_env!(ctx("studio.test.near", ISSUE_DEPOSIT).build());
    let _ = r.issue(acc("acme.test.near"), "INV-A".into(), U128(FACE), U64(1), "x".into());
    testing_env!(ctx("studio.test.near", ISSUE_DEPOSIT).build());
    let _ = r.issue(acc("acme.test.near"), "inv-a".into(), U128(FACE), U64(1), "x".into());
}

#[test]
fn same_number_to_a_different_debtor_is_a_different_invoice() {
    let mut r = fresh();
    issued(&mut r);
    testing_env!(ctx("studio.test.near", ISSUE_DEPOSIT).build());
    let _ = r.issue(acc("other.test.near"), "0042".into(), U128(FACE), U64(1), "x".into());
}

#[test]
#[should_panic(expected = "attach at least")]
fn issue_needs_the_deposit() {
    let mut r = fresh();
    testing_env!(ctx("studio.test.near", NearToken::from_millinear(1)).build());
    let _ = r.issue(acc("acme.test.near"), "1".into(), U128(1), U64(1), "x".into());
}

#[test]
fn failed_creation_removes_the_invoice_and_frees_the_number() {
    let mut r = fresh();
    testing_env!(ctx("studio.test.near", ISSUE_DEPOSIT).build());
    let _ = r.issue(acc("acme.test.near"), "7".into(), U128(FACE), U64(1), "x".into());
    with_results(REGISTRY, vec![PromiseResult::Failed, ok(b"{}")]);
    assert!(!r.on_created(inv_id(1), acc("studio.test.near"), U128(ISSUE_DEPOSIT.as_yoctonear())));
    assert!(r.invoice(inv_id(1)).is_none());
    testing_env!(ctx("studio.test.near", ISSUE_DEPOSIT).build());
    let _ = r.issue(acc("acme.test.near"), "7".into(), U128(FACE), U64(1), "x".into());
}

#[test]
#[should_panic(expected = "only the debtor can confirm")]
fn only_the_debtor_confirms() {
    let mut r = fresh();
    let id = issued(&mut r);
    at("studio.test.near");
    r.confirm(id);
}

#[test]
fn confirming_updates_the_debtor_record() {
    let mut r = fresh();
    confirmed(&mut r);
    assert_eq!(r.debtor_record(acc("acme.test.near")).confirmed, 1);
}

#[test]
#[should_panic(expected = "only a confirmed invoice can be listed")]
fn an_unconfirmed_invoice_cannot_be_listed() {
    let mut r = fresh();
    let id = issued(&mut r);
    at("studio.test.near");
    r.list(id, U128(PRICE));
}

#[test]
#[should_panic(expected = "only the owner can list")]
fn only_the_owner_lists() {
    let mut r = fresh();
    let id = confirmed(&mut r);
    at("mallory.test.near");
    r.list(id, U128(PRICE));
}

#[test]
#[should_panic(expected = "price must be between")]
fn price_cannot_exceed_face_value() {
    let mut r = fresh();
    let id = confirmed(&mut r);
    at("studio.test.near");
    r.list(id, U128(FACE + 1));
}

#[test]
fn buying_moves_ownership_and_pays_the_seller() {
    let mut r = fresh();
    let id = listed(&mut r);
    testing_env!(ctx(TOKEN, NearToken::from_near(0)).build());
    let refund = value(r.ft_on_transfer(acc("fund.test.near"), U128(PRICE), buy_msg(&id)));
    assert_eq!(refund, 0);
    let inv = r.invoice(id.clone()).unwrap();
    assert_eq!(inv.owner, acc("fund.test.near"));
    assert_eq!(inv.status, Status::Confirmed);
    assert!(inv.price.is_none());
    assert_eq!(inv.log.last().unwrap().kind, Kind::Sold);
    assert_eq!(r.nft_token(id.to_string()).unwrap().owner_id, acc("fund.test.near"));
}

#[test]
fn overpayment_is_refunded() {
    let mut r = fresh();
    let id = listed(&mut r);
    testing_env!(ctx(TOKEN, NearToken::from_near(0)).build());
    let refund = value(r.ft_on_transfer(acc("fund.test.near"), U128(PRICE + 5), buy_msg(&id)));
    assert_eq!(refund, 5);
}

#[test]
fn underpayment_is_refunded_in_full_and_changes_nothing() {
    let mut r = fresh();
    let id = listed(&mut r);
    testing_env!(ctx(TOKEN, NearToken::from_near(0)).build());
    let refund = value(r.ft_on_transfer(acc("fund.test.near"), U128(PRICE - 1), buy_msg(&id)));
    assert_eq!(refund, PRICE - 1);
    assert_eq!(r.invoice(id).unwrap().owner, acc("studio.test.near"));
}

#[test]
fn a_foreign_token_cannot_buy() {
    let mut r = fresh();
    let id = listed(&mut r);
    testing_env!(ctx("fake-usdc.test.near", NearToken::from_near(0)).build());
    let refund = value(r.ft_on_transfer(acc("fund.test.near"), U128(PRICE), buy_msg(&id)));
    assert_eq!(refund, PRICE);
    assert_eq!(r.invoice(id).unwrap().owner, acc("studio.test.near"));
}

#[test]
fn the_owner_cannot_buy_their_own_invoice() {
    let mut r = fresh();
    let id = listed(&mut r);
    testing_env!(ctx(TOKEN, NearToken::from_near(0)).build());
    let refund = value(r.ft_on_transfer(acc("studio.test.near"), U128(PRICE), buy_msg(&id)));
    assert_eq!(refund, PRICE);
}

#[test]
fn a_bad_message_is_refunded() {
    let mut r = fresh();
    listed(&mut r);
    testing_env!(ctx(TOKEN, NearToken::from_near(0)).build());
    assert_eq!(value(r.ft_on_transfer(acc("fund.test.near"), U128(PRICE), "nonsense".into())), PRICE);
}

#[test]
fn an_invoice_cannot_be_bought_twice() {
    let mut r = fresh();
    let id = listed(&mut r);
    testing_env!(ctx(TOKEN, NearToken::from_near(0)).build());
    assert_eq!(value(r.ft_on_transfer(acc("fund.test.near"), U128(PRICE), buy_msg(&id))), 0);
    testing_env!(ctx(TOKEN, NearToken::from_near(0)).build());
    assert_eq!(value(r.ft_on_transfer(acc("second.test.near"), U128(PRICE), buy_msg(&id))), PRICE);
    assert_eq!(r.invoice(id).unwrap().owner, acc("fund.test.near"));
}

#[test]
#[should_panic(expected = "only the owner can list")]
fn the_old_owner_cannot_relist_after_a_sale() {
    let mut r = fresh();
    let id = listed(&mut r);
    testing_env!(ctx(TOKEN, NearToken::from_near(0)).build());
    let _ = r.ft_on_transfer(acc("fund.test.near"), U128(PRICE), buy_msg(&id));
    at("studio.test.near");
    r.list(id, U128(PRICE));
}

#[test]
fn failed_proceeds_push_is_credited_for_withdrawal() {
    let mut r = fresh();
    with_results(REGISTRY, vec![PromiseResult::Failed]);
    r.on_proceeds_sent(acc("studio.test.near"), U128(PRICE));
    assert_eq!(r.proceeds_of(acc("studio.test.near")).0, PRICE);
    at("studio.test.near");
    let _ = r.withdraw_proceeds();
    assert_eq!(r.proceeds_of(acc("studio.test.near")).0, 0);
}

#[test]
fn successful_proceeds_push_credits_nothing() {
    let mut r = fresh();
    with_results(REGISTRY, vec![ok(b"")]);
    r.on_proceeds_sent(acc("studio.test.near"), U128(PRICE));
    assert_eq!(r.proceeds_of(acc("studio.test.near")).0, 0);
}

#[test]
#[should_panic(expected = "locked")]
fn a_listed_invoice_cannot_be_transferred() {
    let mut r = fresh();
    let id = listed(&mut r);
    testing_env!(ctx("studio.test.near", NearToken::from_yoctonear(1)).build());
    r.nft_transfer(acc("friend.test.near"), id.to_string(), None, None);
}

#[test]
fn an_unlisted_invoice_can_be_transferred_by_its_owner() {
    let mut r = fresh();
    let id = confirmed(&mut r);
    testing_env!(ctx("studio.test.near", NearToken::from_yoctonear(1)).build());
    r.nft_transfer(acc("friend.test.near"), id.to_string(), None, None);
    assert_eq!(r.invoice(id).unwrap().owner, acc("friend.test.near"));
}

#[test]
#[should_panic(expected = "only the owner can transfer")]
fn a_stranger_cannot_transfer() {
    let mut r = fresh();
    let id = confirmed(&mut r);
    testing_env!(ctx("mallory.test.near", NearToken::from_yoctonear(1)).build());
    r.nft_transfer(acc("mallory.test.near"), id.to_string(), None, None);
}

#[test]
fn full_payment_marks_paid_and_records_the_debtor() {
    let mut r = fresh();
    let id = confirmed(&mut r);
    assert!(mark_paid(&mut r, &id, FACE));
    let inv = r.invoice(id).unwrap();
    assert_eq!(inv.status, Status::Paid);
    assert_eq!(inv.received.0, FACE);
    let rec = r.debtor_record(acc("acme.test.near"));
    assert_eq!((rec.confirmed, rec.paid, rec.paid_on_time), (1, 1, 1));
    assert_eq!(rec.paid_total.0, FACE);
}

#[test]
fn partial_payment_does_not_mark_paid() {
    let mut r = fresh();
    let id = confirmed(&mut r);
    assert!(!mark_paid(&mut r, &id, FACE - 1));
    assert_eq!(r.invoice(id).unwrap().status, Status::Confirmed);
}

#[test]
fn late_payment_is_recorded_as_late() {
    let mut r = fresh();
    testing_env!(ctx("studio.test.near", ISSUE_DEPOSIT).build());
    let _ = r.issue(acc("acme.test.near"), "late".into(), U128(FACE), U64(1_000), "x".into()); // due long ago
    with_results(REGISTRY, vec![ok(b""), ok(b"{}")]);
    r.on_created(inv_id(1), acc("studio.test.near"), U128(0));
    assert!(mark_paid(&mut r, &inv_id(1), FACE));
    let rec = r.debtor_record(acc("acme.test.near"));
    assert_eq!((rec.paid, rec.paid_on_time), (1, 0));
    assert!(rec.late_ms_total.0 > 0);
}

#[test]
fn paying_a_listed_invoice_delists_it() {
    let mut r = fresh();
    let id = listed(&mut r);
    assert!(mark_paid(&mut r, &id, FACE));
    let inv = r.invoice(id.clone()).unwrap();
    assert_eq!(inv.status, Status::Paid);
    assert!(inv.price.is_none());
    // and the stale listing can no longer be bought
    testing_env!(ctx(TOKEN, NearToken::from_near(0)).build());
    assert_eq!(value(r.ft_on_transfer(acc("fund.test.near"), U128(PRICE), buy_msg(&id))), PRICE);
}

#[test]
fn overpayment_is_all_claimable() {
    let mut r = fresh();
    let id = confirmed(&mut r);
    assert!(mark_paid(&mut r, &id, FACE));
    assert!(mark_paid(&mut r, &id, FACE + 50));
    assert_eq!(r.invoice(id).unwrap().received.0, FACE + 50);
}

fn sold_and_paid(r: &mut Registry) -> AccountId {
    let id = listed(r);
    testing_env!(ctx(TOKEN, NearToken::from_near(0)).build());
    let _ = r.ft_on_transfer(acc("fund.test.near"), U128(PRICE), buy_msg(&id));
    assert!(mark_paid(r, &id, FACE));
    id
}

#[test]
#[should_panic(expected = "only the current owner can claim")]
fn the_issuer_cannot_claim_after_selling() {
    let mut r = fresh();
    let id = sold_and_paid(&mut r);
    at("studio.test.near");
    let _ = r.claim(id);
}

#[test]
fn the_buyer_collects_the_payment() {
    let mut r = fresh();
    let id = sold_and_paid(&mut r);
    at("fund.test.near");
    let _ = r.claim(id.clone());
    assert_eq!(r.invoice(id).unwrap().status, Status::Claiming);
}

#[test]
fn claim_settles_and_cannot_repeat() {
    let mut r = fresh();
    let id = confirmed(&mut r);
    mark_paid(&mut r, &id, FACE);
    at("studio.test.near");
    let _ = r.claim(id.clone());
    assert_eq!(r.invoice(id.clone()).unwrap().status, Status::Claiming);
    with_results(REGISTRY, vec![ok(b"")]);
    assert!(r.on_claimed(id.clone(), acc("studio.test.near"), U128(FACE)));
    assert_eq!(r.invoice(id).unwrap().status, Status::Claimed);
}

#[test]
#[should_panic(expected = "invoice is not paid")]
fn a_claimed_invoice_cannot_be_claimed_again() {
    let mut r = fresh();
    let id = confirmed(&mut r);
    mark_paid(&mut r, &id, FACE);
    at("studio.test.near");
    let _ = r.claim(id.clone());
    with_results(REGISTRY, vec![ok(b"")]);
    r.on_claimed(id.clone(), acc("studio.test.near"), U128(FACE));
    at("studio.test.near");
    let _ = r.claim(id);
}

#[test]
#[should_panic(expected = "invoice is not paid")]
fn double_claim_while_in_flight_is_refused() {
    let mut r = fresh();
    let id = confirmed(&mut r);
    mark_paid(&mut r, &id, FACE);
    at("studio.test.near");
    let _ = r.claim(id.clone());
    at("studio.test.near");
    let _ = r.claim(id);
}

#[test]
fn a_failed_payout_returns_the_invoice_to_paid() {
    let mut r = fresh();
    let id = confirmed(&mut r);
    mark_paid(&mut r, &id, FACE);
    at("studio.test.near");
    let _ = r.claim(id.clone());
    with_results(REGISTRY, vec![PromiseResult::Failed]);
    assert!(!r.on_claimed(id.clone(), acc("studio.test.near"), U128(FACE)));
    let inv = r.invoice(id).unwrap();
    assert_eq!(inv.status, Status::Paid);
    assert_eq!(inv.log.last().unwrap().kind, Kind::ClaimFailed);
}

// The "sale in the middle of a payout" cases.

#[test]
#[should_panic(expected = "locked")]
fn cannot_transfer_while_a_claim_is_in_flight() {
    let mut r = fresh();
    let id = confirmed(&mut r);
    mark_paid(&mut r, &id, FACE);
    at("studio.test.near");
    let _ = r.claim(id.clone());
    testing_env!(ctx("studio.test.near", NearToken::from_yoctonear(1)).build());
    r.nft_transfer(acc("friend.test.near"), id.to_string(), None, None);
}

#[test]
fn cannot_buy_while_a_claim_is_in_flight() {
    let mut r = fresh();
    let id = confirmed(&mut r);
    mark_paid(&mut r, &id, FACE);
    at("studio.test.near");
    let _ = r.claim(id.clone());
    testing_env!(ctx(TOKEN, NearToken::from_near(0)).build());
    assert_eq!(value(r.ft_on_transfer(acc("fund.test.near"), U128(PRICE), buy_msg(&id))), PRICE);
    assert_eq!(r.invoice(id).unwrap().owner, acc("studio.test.near"));
}

#[test]
#[should_panic(expected = "only a confirmed invoice can be listed")]
fn cannot_list_while_a_claim_is_in_flight() {
    let mut r = fresh();
    let id = confirmed(&mut r);
    mark_paid(&mut r, &id, FACE);
    at("studio.test.near");
    let _ = r.claim(id.clone());
    at("studio.test.near");
    r.list(id, U128(PRICE));
}

#[test]
fn a_payment_arriving_during_a_claim_does_not_disturb_it() {
    let mut r = fresh();
    let id = confirmed(&mut r);
    mark_paid(&mut r, &id, FACE);
    at("studio.test.near");
    let _ = r.claim(id.clone());
    assert!(!mark_paid(&mut r, &id, FACE * 2));
    assert_eq!(r.invoice(id).unwrap().status, Status::Claiming);
}

#[test]
fn a_sync_result_from_before_a_sale_cannot_pay_a_claimed_invoice_twice() {
    let mut r = fresh();
    let id = confirmed(&mut r);
    mark_paid(&mut r, &id, FACE);
    at("studio.test.near");
    let _ = r.claim(id.clone());
    with_results(REGISTRY, vec![ok(b"")]);
    r.on_claimed(id.clone(), acc("studio.test.near"), U128(FACE));
    assert!(!mark_paid(&mut r, &id, FACE));
    assert_eq!(r.invoice(id).unwrap().status, Status::Claimed);
}

#[test]
fn nft_views_skip_invoices_still_being_created() {
    let mut r = fresh();
    testing_env!(ctx("studio.test.near", ISSUE_DEPOSIT).build());
    let _ = r.issue(acc("acme.test.near"), "p".into(), U128(1), U64(1), "x".into());
    assert_eq!(r.nft_total_supply().0, 0);
    assert!(r.nft_token(inv_id(1).to_string()).is_none());
}

#[test]
fn the_log_never_grows_without_bound() {
    let mut r = fresh();
    let id = confirmed(&mut r);
    for i in 0..60 {
        let from = if i % 2 == 0 { "studio.test.near" } else { "friend.test.near" };
        let to = if i % 2 == 0 { "friend.test.near" } else { "studio.test.near" };
        testing_env!(ctx(from, NearToken::from_yoctonear(1)).build());
        r.nft_transfer(acc(to), id.to_string(), None, None);
    }
    let inv = r.invoice(id).unwrap();
    assert!(inv.log.len() <= MAX_LOG);
    assert_eq!(inv.log[0].kind, Kind::Issued);
}
