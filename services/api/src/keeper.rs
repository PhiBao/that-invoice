//! The payment keeper. Watches invoice accounts and, as soon as one holds enough to cover its invoice (or
//! receives money after it was collected), asks the registry to look: `registry.sync(id)`. Anyone can call
//! `sync`, so the keeper holds no special power. It only saves people from having to press a button.

use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use near_api::types::{AccountId, NearToken};
use serde_json::{json, Value};

use crate::app::Shared;

const TICK: Duration = Duration::from_secs(10);
const RETRY_AFTER: Duration = Duration::from_secs(40);
const CLAIMED_EVERY: Duration = Duration::from_secs(180);
const MAX_WATCHED: usize = 30;

pub async fn run(st: Shared) {
    let keeper: AccountId = match st.cfg.keeper.parse() {
        Ok(k) if st.chain.can_sign(&k) => k,
        _ => {
            tracing::warn!("keeper disabled: no key for {}", st.cfg.keeper);
            return;
        }
    };
    let mut attempted: HashMap<String, Instant> = HashMap::new();
    let mut last_claimed_scan = Instant::now() - CLAIMED_EVERY;

    loop {
        tokio::select! {
            _ = tokio::time::sleep(TICK) => {}
            _ = st.keeper_wake.notified() => {}
        }
        let scan_claimed = last_claimed_scan.elapsed() >= CLAIMED_EVERY;
        if scan_claimed {
            last_claimed_scan = Instant::now();
        }
        let invoices: Vec<Value> = st.invoices.read().await.clone();
        let watched: Vec<&Value> = invoices
            .iter()
            .filter(|i| match i["status"].as_str() {
                Some("Issued") | Some("Confirmed") | Some("Listed") | Some("Paid") => true,
                Some("Claimed") => scan_claimed,
                _ => false,
            })
            .take(MAX_WATCHED)
            .collect();

        let balances = futures::future::join_all(watched.iter().map(|i| {
            let st = st.clone();
            let id = i["id"].as_str().unwrap_or_default().to_string();
            async move {
                let bal = match id.parse::<AccountId>() {
                    Ok(a) => st.chain.usdc_balance(&a).await.ok(),
                    Err(_) => None,
                };
                (id, bal)
            }
        }))
        .await;

        for (inv, (id, bal)) in watched.iter().zip(balances) {
            let Some(bal) = bal else { continue };
            let amount: u128 = inv["amount"].as_str().and_then(|s| s.parse().ok()).unwrap_or(u128::MAX);
            let received: u128 = inv["received"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0);
            let due = match inv["status"].as_str() {
                Some("Issued") | Some("Confirmed") | Some("Listed") => bal >= amount,
                Some("Paid") => bal > received,
                Some("Claimed") => bal > 0,
                _ => false,
            };
            if !due || attempted.get(&id).is_some_and(|t| t.elapsed() < RETRY_AFTER) {
                continue;
            }
            attempted.insert(id.clone(), Instant::now());
            match st
                .chain
                .call(&keeper, &st.chain.registry.clone(), "sync", json!({ "id": id }), NearToken::from_yoctonear(0), 50)
                .await
            {
                Ok(out) => {
                    tracing::info!(invoice = %id, ok = out.ok, balance = bal as u64, "keeper recorded a payment");
                    if out.ok {
                        st.keeper_txs.lock().await.insert(id.clone(), (out.hash.clone(), out.explorer_url.clone()));
                        *st.state_cache.lock().await = None;
                        let _ = st.updates.send("update".into());
                    }
                }
                Err(e) => tracing::warn!(invoice = %id, "keeper sync failed: {e:#}"),
            }
        }
        attempted.retain(|_, t| t.elapsed() < Duration::from_secs(600));
    }
}
