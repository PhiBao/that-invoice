//! The market maker. Keeps a few confirmed invoices on the Buyer desk so a visitor always finds something to
//! buy. It does exactly what a real issuer and client would do: issue an invoice, have the client confirm it
//! (through the Acme DAO's proposal flow where the client is the DAO), and list it at a discount. Nothing is
//! faked: these are normal invoices that anyone can buy, pay and collect.

use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use near_api::types::{AccountId, NearToken};
use serde_json::{json, Value};

use crate::app::{persona_account, run_action, Shared};

const TARGET_FOR_SALE: usize = 4;
const MIN_FOR_SALE: usize = 3;
const CHECK_EVERY: Duration = Duration::from_secs(30);

/// (issuer account, issuer label, debtor persona-or-account, face USD, ask USD, days to due, number prefix)
const MENU: &[(&str, &str, &str, u64, u64, i64, &str)] = &[
    ("kestrel.endorse-studio.testnet", "Kestrel Audit", "acme", 8400, 8190, 45, "KA"),
    ("loomlabs.endorse-studio.testnet", "Loom Labs", "acme", 2750, 2712, 14, "LL"),
    ("endorse-studio.testnet", "Studio Nine", "northwind", 5000, 4825, 60, "SN"),
    ("kestrel.endorse-studio.testnet", "Kestrel Audit", "northwind", 1900, 1862, 21, "KA"),
    ("loomlabs.endorse-studio.testnet", "Loom Labs", "acme", 3600, 3492, 30, "LL"),
    ("endorse-studio.testnet", "Studio Nine", "acme", 760, 745, 12, "SN"),
];

pub async fn run(st: Shared) {
    // Needs a funded issuer set; skip quietly when running without the extra issuer keys.
    let have_keys = MENU.iter().all(|m| m.0.parse::<AccountId>().map(|a| st.chain.can_sign(&a)).unwrap_or(false));
    if !have_keys || st.cfg.dao.is_none() {
        tracing::info!("market maker disabled (needs the seed issuers' keys and a DAO)");
        return;
    }
    let mut cursor = 0usize;
    let mut last_fail: Option<Instant> = None;
    tokio::time::sleep(Duration::from_secs(20)).await;
    loop {
        tokio::time::sleep(CHECK_EVERY).await;
        if st.demo_running.load(std::sync::atomic::Ordering::SeqCst) {
            continue;
        }
        if last_fail.is_some_and(|t| t.elapsed() < Duration::from_secs(300)) {
            continue;
        }
        let for_sale = st
            .invoices
            .read()
            .await
            .iter()
            .filter(|i| i["status"] == "Listed" && !i["number"].as_str().unwrap_or("").starts_with("DEMO-"))
            .count();
        if for_sale >= MIN_FOR_SALE {
            continue;
        }
        let need = TARGET_FOR_SALE - for_sale;
        tracing::info!(for_sale, need, "restocking the Buyer desk");
        for _ in 0..need {
            let entry = MENU[cursor % MENU.len()];
            cursor += 1;
            if let Err(e) = list_one(&st, &entry).await {
                tracing::warn!("market maker failed: {e:#}");
                last_fail = Some(Instant::now());
                break;
            }
        }
    }
}

async fn list_one(st: &Shared, m: &(&str, &str, &str, u64, u64, i64, &str)) -> Result<()> {
    let (issuer_id, _label, debtor_key, face, ask, days, prefix) = *m;
    let issuer: AccountId = issuer_id.parse()?;
    let reg = st.chain.registry.clone();
    // Distinct invoice numbers: prefix-YYMM-NNN from the registry's invoice count.
    let n: u64 = st.chain.registry_view::<Value>("config", json!({})).await?["invoices"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0);
    let number = format!("{prefix}-{:04}", 2000 + n);
    let debtor: String = match debtor_key {
        "acme" => persona_account(st, "acme")?.to_string(),
        other => format!("{other}.endorse-studio.testnet"),
    };
    let amount = (face as u128) * 1_000_000;

    let out = st
        .chain
        .call(
            &issuer, &reg, "issue",
            json!({ "debtor": debtor, "number": number, "amount": amount.to_string(),
                    "due_ms": (chrono::Utc::now().timestamp_millis() + days * 86_400_000).to_string(), "doc_hash": "" }),
            NearToken::from_millinear(100), 150,
        )
        .await?;
    if !out.ok {
        return Err(anyhow!("issue failed: {}", out.error.unwrap_or_default()));
    }
    // find the new invoice account
    let mut id = None;
    for _ in 0..10 {
        tokio::time::sleep(Duration::from_millis(900)).await;
        let c: Value = st.chain.registry_view("config", json!({})).await?;
        let total: u64 = c["invoices"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0);
        let page: Vec<Value> = st
            .chain
            .registry_view("invoices", json!({ "from_index": total.saturating_sub(20).to_string(), "limit": 20 }))
            .await?;
        if let Some(i) = page.iter().rev().find(|i| i["number"] == number.as_str() && i["issuer"] == issuer_id) {
            if i["status"] != "Creating" {
                id = i["id"].as_str().map(str::to_string);
                break;
            }
        }
    }
    let id = id.ok_or_else(|| anyhow!("new invoice did not appear"))?;

    // The client confirms: the DAO by proposal, an individual client with its own key.
    if debtor_key == "acme" {
        let r = run_action(st, "acme", "confirm", &json!({ "id": id })).await?;
        if !r.ok {
            return Err(anyhow!("DAO confirm failed: {}", r.error.unwrap_or_default()));
        }
    } else {
        let d: AccountId = debtor.parse()?;
        if !st.chain.can_sign(&d) {
            return Err(anyhow!("no key for client {debtor}"));
        }
        let r = st.chain.call(&d, &reg, "confirm", json!({ "id": id }), NearToken::from_yoctonear(0), 30).await?;
        if !r.ok {
            return Err(anyhow!("confirm failed: {}", r.error.unwrap_or_default()));
        }
    }
    let r = st
        .chain
        .call(&issuer, &reg, "list", json!({ "id": id, "price": (ask as u128 * 1_000_000).to_string() }), NearToken::from_yoctonear(0), 30)
        .await?;
    if !r.ok {
        return Err(anyhow!("list failed: {}", r.error.unwrap_or_default()));
    }
    tracing::info!(invoice = %id, number = %number, "restocked: listed for sale");
    *st.state_cache.lock().await = None;
    let _ = st.updates.send("update".into());
    Ok(())
}
