//! The guided demo: runs the whole invoice lifecycle with real testnet transactions and
//! streams each step to the browser as it lands. Nothing is simulated. Each step carries the
//! explorer link of the transaction that did it.

use std::sync::atomic::Ordering;

use futures::Stream;
use serde_json::{json, Value};

use crate::app::{persona_account, run_action, Shared};

struct RunGuard(Shared);
impl Drop for RunGuard {
    fn drop(&mut self) {
        self.0.demo_running.store(false, Ordering::SeqCst);
    }
}

const FACE: &str = "1200";
const PRICE: &str = "1176";

/// Yields one JSON event per step. Transport (SSE, replay, reconnect) lives in `app.rs`.
pub fn stream(st: Shared) -> impl Stream<Item = Value> {
    async_stream::stream! {
        let _guard = RunGuard(st.clone());
        let total = 10;
        macro_rules! send {
            ($v:expr) => { $v };
        }

        let number = format!("DEMO-{}", to_base36(chrono::Utc::now().timestamp_millis() as u64));
        yield send!(json!({ "kind": "start", "total": total, "number": number }));

        // 0. Make sure the demo wallets hold test USDC. This is the only non-product step.
        yield send!(json!({ "kind": "step", "index": 0, "total": total, "id": "fund", "status": "running",
            "title": "Check the demo wallets", "actor": "Faucet" }));
        match top_up(&st).await {
            Ok(note) => yield send!(json!({ "kind": "step", "index": 0, "total": total, "id": "fund", "status": "ok",
                "title": "Check the demo wallets", "actor": "Faucet", "note": note })),
            Err(e) => {
                yield send!(json!({ "kind": "error", "index": 0, "error": format!("{e:#}") }));
                return;
            }
        }

        let mut invoice_id = String::new();

        // (index, id, persona, title, expected_reject)
        let plan: [(usize, &str, &str, &str, bool); 9] = [
            (1, "issue", "studio", "Studio Nine issues a $1,200 invoice to Acme DAO. It becomes its own NEAR account.", false),
            (2, "issue_again", "studio", "Attack: Studio Nine issues the same invoice a second time.", true),
            (3, "confirm", "acme", "Acme DAO confirms it owes the invoice: a proposal is filed, a council member approves it, and the DAO calls the registry.", false),
            (4, "list", "studio", "Studio Nine lists the invoice for $1,176.", false),
            (5, "buy", "fund", "Northfield Fund buys it. Ownership and the cash move in one receipt.", false),
            (6, "relist", "studio", "Attack: Studio Nine tries to sell the invoice again after selling it.", true),
            (7, "pay", "acme", "Acme DAO pays the invoice account from its treasury, also by proposal.", false),
            (8, "record", "fund", "The server notices the payment and records it. Nobody presses a button.", false),
            (9, "claim", "fund", "Northfield Fund, the current owner, claims the payment.", false),
        ];

        for (index, id, persona, title, expect_reject) in plan {
            let actor = st.cfg.personas.iter().find(|p| p.key == persona).map(|p| p.name).unwrap_or(persona);
            yield send!(json!({ "kind": "step", "index": index, "total": total, "id": id, "status": "running",
                "title": title, "actor": actor, "invoice_id": invoice_id }));

            let (action, params): (&str, Value) = match id {
                "issue" => ("issue", json!({ "debtor": "acme", "number": number, "amount": FACE, "due_days": 30 })),
                "issue_again" => ("issue", json!({ "debtor": "acme", "number": number, "amount": FACE, "due_days": 30 })),
                "confirm" => ("confirm", json!({ "id": invoice_id })),
                "list" => ("list", json!({ "id": invoice_id, "price": PRICE })),
                "buy" => ("buy", json!({ "id": invoice_id })),
                "relist" => ("list", json!({ "id": invoice_id, "price": PRICE })),
                "pay" => ("pay", json!({ "id": invoice_id })),
                "record" => ("sync", json!({ "id": invoice_id })),
                "claim" => ("claim", json!({ "id": invoice_id })),
                _ => unreachable!(),
            };

            let outcome = if id == "record" {
                record_step(&st, &invoice_id).await
            } else {
                run_action(&st, persona, action, &params).await
            };
            let outcome = match outcome {
                Ok(o) => o,
                Err(e) => {
                    yield send!(json!({ "kind": "error", "index": index, "id": id, "error": format!("{e:#}") }));
                    return;
                }
            };

            if expect_reject {
                if outcome.ok {
                    yield send!(json!({ "kind": "error", "index": index, "id": id,
                        "error": "the contract accepted something it must reject" }));
                    return;
                }
                yield send!(json!({ "kind": "step", "index": index, "total": total, "id": id, "status": "rejected",
                    "title": title, "actor": actor, "error": outcome.error, "tx": outcome.hash,
                    "explorer_url": outcome.explorer_url, "invoice_id": invoice_id }));
                continue;
            }
            if !outcome.ok {
                yield send!(json!({ "kind": "error", "index": index, "id": id, "error": outcome.error,
                    "tx": outcome.hash, "explorer_url": outcome.explorer_url }));
                return;
            }

            if id == "issue" {
                // The invoice account id is assigned by the registry; look it up by number.
                tokio::time::sleep(std::time::Duration::from_millis(800)).await;
                match find_by_number(&st, &number).await {
                    Some(found) => invoice_id = found,
                    None => {
                        yield send!(json!({ "kind": "error", "index": index, "id": id,
                            "error": "invoice account was not created (check the transaction)",
                            "tx": outcome.hash, "explorer_url": outcome.explorer_url }));
                        return;
                    }
                }
            }
            if id == "record" || id == "claim" {
                // These settle in callbacks; wait for the registry to reflect them.
                let want = if id == "record" { "Paid" } else { "Claimed" };
                let _ = wait_status(&st, &invoice_id, want).await;
            }
            yield send!(json!({ "kind": "step", "index": index, "total": total, "id": id, "status": "ok",
                "title": title, "actor": actor, "tx": outcome.hash, "explorer_url": outcome.explorer_url,
                "events": outcome.events, "gas_tgas": outcome.gas_tgas, "extras": outcome.extras,
                "note": if id == "record" { Some("recorded automatically") } else { None }, "invoice_id": invoice_id }));
        }

        *st.state_cache.lock().await = None;
        let _ = st.updates.send("update".into());
        let final_inv: Value = match persona_account(&st, "studio") {
            Ok(_) => st.chain.registry_view("invoice", json!({ "id": invoice_id })).await.unwrap_or(Value::Null),
            Err(_) => Value::Null,
        };
        yield send!(json!({ "kind": "done", "invoice_id": invoice_id, "invoice": final_inv }));
    }
}

/// Wait for the keeper to record the payment. If it is not running or is slow, record it ourselves so the
/// demo never hangs: `sync` is callable by anyone.
async fn record_step(st: &Shared, id: &str) -> anyhow::Result<crate::chain::TxOutcome> {
    for _ in 0..16 {
        if let Ok(Some(i)) = st.chain.registry_view::<Option<Value>>("invoice", json!({ "id": id })).await {
            if i["status"] == "Paid" {
                let known = st.keeper_txs.lock().await.get(id).cloned();
                let (hash, url) = known.unwrap_or_default();
                return Ok(crate::chain::TxOutcome {
                    ok: true, hash, explorer_url: url, error: None, events: vec![], gas_tgas: 0.0, extras: vec![], ret: None, soft_error: None,
                });
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
    }
    run_action(st, "fund", "sync", &json!({ "id": id })).await
}

async fn find_by_number(st: &Shared, number: &str) -> Option<String> {
    for _ in 0..8 {
        let list: Vec<Value> = st
            .chain
            .registry_view("invoices", json!({ "from_index": "0", "limit": 100 }))
            .await
            .ok()?;
        // The registry returns oldest first, so search the whole page and keep the last match.
        let all: Vec<Value> = if list.len() == 100 {
            let total = st.chain.registry_view::<Value>("config", json!({})).await.ok()?["invoices"]
                .as_str()?
                .parse::<u64>()
                .ok()?;
            let from = total.saturating_sub(100);
            st.chain.registry_view("invoices", json!({ "from_index": from.to_string(), "limit": 100 })).await.ok()?
        } else {
            list
        };
        if let Some(i) = all.iter().rev().find(|i| i["number"] == number) {
            if i["status"] != "Creating" {
                return i["id"].as_str().map(str::to_string);
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(900)).await;
    }
    None
}

async fn wait_status(st: &Shared, id: &str, want: &str) -> bool {
    for _ in 0..12 {
        if let Ok(Some(i)) = st.chain.registry_view::<Option<Value>>("invoice", json!({ "id": id })).await {
            if i["status"] == want {
                return true;
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(900)).await;
    }
    false
}

/// Keep Acme and the fund stocked with demo USDC from the token account.
async fn top_up(st: &Shared) -> anyhow::Result<String> {
    let token = st.chain.token.clone();
    let mut moved = Vec::new();
    for (persona, need) in [("acme", 2_400_000_000u128), ("fund", 2_400_000_000u128)] {
        let acct = persona_account(st, persona)?;
        // The DAO account must be registered on the token before it can hold USDC.
        let registered: Value = st.chain.view(&token, "storage_balance_of", json!({ "account_id": acct })).await.unwrap_or(Value::Null);
        if registered.is_null() {
            let out = st
                .chain
                .call(&token, &token, "storage_deposit", json!({ "account_id": acct, "registration_only": true }),
                    near_api::types::NearToken::from_millinear(2), 30)
                .await?;
            if !out.ok {
                anyhow::bail!("could not register {persona} on the token: {}", out.error.unwrap_or_default());
            }
        }
        let have = st.chain.usdc_balance(&acct).await.unwrap_or(0);
        if have >= need {
            continue;
        }
        let out = st
            .chain
            .call(
                &token,
                &token,
                "ft_transfer",
                json!({ "receiver_id": acct, "amount": (10_000_000_000u128 - have).to_string() }),
                near_api::types::NearToken::from_yoctonear(1),
                30,
            )
            .await?;
        if !out.ok {
            anyhow::bail!("could not fund {persona}: {}", out.error.unwrap_or_default());
        }
        moved.push(persona);
    }
    Ok(if moved.is_empty() { "wallets already funded".into() } else { format!("topped up {}", moved.join(", ")) })
}

fn to_base36(mut n: u64) -> String {
    const D: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut s = Vec::new();
    while n > 0 {
        s.push(D[(n % 36) as usize]);
        n /= 36;
    }
    s.reverse();
    String::from_utf8(s).unwrap().to_uppercase()
}
