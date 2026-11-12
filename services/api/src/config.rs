use std::{collections::HashMap, env, fs, path::PathBuf};

use anyhow::{anyhow, Context, Result};

/// A demo persona: a testnet account whose key the server holds so judges can click through
/// the whole lifecycle without a wallet. These keys control worthless testnet funds only.
#[derive(Clone, Debug)]
pub struct PersonaCfg {
    pub key: &'static str,
    pub account: String,
    pub name: &'static str,
    pub role: &'static str,
    pub blurb: &'static str,
}

#[derive(Clone)]
pub struct Config {
    pub port: u16,
    pub network: String,
    pub rpc_url: String,
    pub registry: String,
    pub token: String,
    pub explorer: String,
    pub personas: Vec<PersonaCfg>,
    /// account id -> "ed25519:..." secret key
    pub secret_keys: HashMap<String, String>,
    pub data_dir: PathBuf,
    pub allowed_origin: Option<String>,
    pub oneclick_jwt: Option<String>,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let network = env::var("NEAR_NETWORK").unwrap_or_else(|_| "testnet".into());
        let rpc_url = env::var("NEAR_RPC").unwrap_or_else(|_| {
            if network == "mainnet" {
                "https://free.rpc.fastnear.com".into()
            } else {
                "https://test.rpc.fastnear.com".into()
            }
        });
        let registry = env::var("REGISTRY_ACCOUNT").context("REGISTRY_ACCOUNT is required")?;
        let token = env::var("USDC_ACCOUNT").unwrap_or_else(|_| "endorse-usdc.testnet".into());
        let studio = env::var("PERSONA_STUDIO").unwrap_or_else(|_| "endorse-studio.testnet".into());
        let acme = env::var("PERSONA_ACME").unwrap_or_else(|_| "endorse-acme.testnet".into());
        let fund = env::var("PERSONA_FUND").unwrap_or_else(|_| "endorse-fund.testnet".into());
        let personas = vec![
            PersonaCfg {
                key: "studio",
                account: studio,
                name: "Studio Nine",
                role: "Issuer",
                blurb: "A design studio that bills crypto-native clients on net-30 terms.",
            },
            PersonaCfg {
                key: "acme",
                account: acme,
                name: "Acme DAO",
                role: "Debtor",
                blurb: "A DAO that hires contractors and pays invoices from its treasury.",
            },
            PersonaCfg {
                key: "fund",
                account: fund,
                name: "Northfield Fund",
                role: "Investor",
                blurb: "Buys confirmed invoices at a discount and collects at maturity.",
            },
        ];

        let mut secret_keys = HashMap::new();
        // Preferred in production: ENDORSE_KEYS='{"account.testnet":"ed25519:..."}'
        if let Ok(raw) = env::var("ENDORSE_KEYS") {
            let m: HashMap<String, String> =
                serde_json::from_str(&raw).context("ENDORSE_KEYS must be a JSON object")?;
            secret_keys.extend(m);
        }
        // Local development: read the standard near-cli credential files.
        let creds_dir = env::var("NEAR_CREDENTIALS_DIR").ok().map(PathBuf::from).or_else(|| {
            env::var("HOME")
                .ok()
                .map(|h| PathBuf::from(h).join(".near-credentials"))
        });
        let mut accounts: Vec<String> = personas.iter().map(|p| p.account.clone()).collect();
        accounts.push(token.clone()); // the token account funds the demo wallets
        for account in &accounts {
            if secret_keys.contains_key(account) {
                continue;
            }
            if let Some(dir) = &creds_dir {
                let f = dir.join(&network).join(format!("{account}.json"));
                if let Ok(s) = fs::read_to_string(&f) {
                    let v: serde_json::Value = serde_json::from_str(&s)?;
                    let k = v["private_key"]
                        .as_str()
                        .ok_or_else(|| anyhow!("no private_key in {}", f.display()))?;
                    secret_keys.insert(account.clone(), k.to_string());
                }
            }
        }

        let explorer = env::var("EXPLORER_BASE").unwrap_or_else(|_| {
            if network == "mainnet" {
                "https://nearblocks.io".into()
            } else {
                "https://testnet.nearblocks.io".into()
            }
        });

        Ok(Self {
            port: env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8787),
            network,
            rpc_url,
            registry,
            token,
            explorer,
            personas,
            secret_keys,
            data_dir: env::var("DATA_DIR").map(PathBuf::from).unwrap_or_else(|_| "data".into()),
            allowed_origin: env::var("ALLOWED_ORIGIN").ok(),
            oneclick_jwt: env::var("ONECLICK_JWT").ok(),
        })
    }
}
