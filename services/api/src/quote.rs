//! Live dry-run quotes from the NEAR Intents 1Click API: what it would cost a client to pay a
//! USDC-denominated invoice from another chain. `dry: true` never creates a deposit address and
//! moves no funds.
//!
//! Intents has no testnet. Dry quotes are validated against mainnet, so the recipient used here is
//! a placeholder mainnet account and the quote shows real mainnet liquidity and fees, not a payment
//! to the demo invoice. The UI says so.

use std::time::Duration;

use serde_json::{json, Value};

use crate::app::{ApiError, AppState};

const NEAR_USDC: &str = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const PLACEHOLDER_RECIPIENT: &str = "intents.near";

struct Origin {
    key: &'static str,
    label: &'static str,
    asset: &'static str,
    refund_to: &'static str,
}

const ORIGINS: &[Origin] = &[
    Origin {
        key: "base",
        label: "Base",
        asset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
        refund_to: "0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97",
    },
    Origin {
        key: "arb",
        label: "Arbitrum",
        asset: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
        refund_to: "0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97",
    },
    Origin {
        key: "eth",
        label: "Ethereum",
        asset: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near",
        refund_to: "0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97",
    },
    Origin {
        key: "sol",
        label: "Solana",
        asset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
        refund_to: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
    },
];

pub async fn dry_quotes(st: &AppState, amount: u128) -> Result<Value, ApiError> {
    let deadline = (chrono::Utc::now() + chrono::Duration::minutes(10)).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let futs = ORIGINS.iter().map(|o| {
        let http = st.http.clone();
        let jwt = st.cfg.oneclick_jwt.clone();
        let body = json!({
            "dry": true, "swapType": "EXACT_OUTPUT", "slippageTolerance": 50,
            "originAsset": o.asset, "depositType": "ORIGIN_CHAIN",
            "destinationAsset": NEAR_USDC, "amount": amount.to_string(),
            "recipient": PLACEHOLDER_RECIPIENT, "recipientType": "DESTINATION_CHAIN",
            "refundTo": o.refund_to, "refundType": "ORIGIN_CHAIN", "deadline": deadline,
        });
        async move {
            let mut req = http.post("https://1click.chaindefuser.com/v0/quote").json(&body).timeout(Duration::from_secs(12));
            if let Some(j) = jwt {
                req = req.bearer_auth(j);
            }
            let res: Result<Value, String> = match req.send().await {
                Ok(r) => r.json::<Value>().await.map_err(|e| e.to_string()),
                Err(e) => Err(e.to_string()),
            };
            (o, res)
        }
    });
    let results = futures::future::join_all(futs).await;
    let mut quotes = Vec::new();
    let mut failed = Vec::new();
    for (o, res) in results {
        match res {
            Ok(v) if v["quote"].is_object() => {
                let q = &v["quote"];
                quotes.push(json!({
                    "chain": o.key, "label": o.label,
                    "amount_in": q["amountIn"], "amount_in_formatted": q["amountInFormatted"],
                    "amount_in_usd": q["amountInUsd"], "min_amount_in": q["minAmountIn"],
                    "amount_out": q["amountOut"], "eta_seconds": q["timeEstimate"],
                    "correlation_id": v["correlationId"], "signature": v["signature"],
                }));
            }
            Ok(v) => failed.push(json!({ "chain": o.key, "label": o.label, "error": v["message"] })),
            Err(e) => failed.push(json!({ "chain": o.key, "label": o.label, "error": e })),
        }
    }
    if quotes.is_empty() {
        return Err(ApiError(axum::http::StatusCode::BAD_GATEWAY, "NEAR Intents returned no quotes".into()));
    }
    Ok(json!({
        "dry_run": true,
        "amount_out": amount.to_string(),
        "destination_asset": NEAR_USDC,
        "recipient_used": PLACEHOLDER_RECIPIENT,
        "note": "Dry-run quotes from NEAR Intents mainnet liquidity. Intents has no testnet, so these show what a payer would send; the demo invoice itself settles in test USDC on NEAR testnet.",
        "fetched_at": chrono::Utc::now().to_rfc3339(),
        "quotes": quotes,
        "failed": failed,
    }))
}
