mod app;
mod chain;
mod config;
mod demo;
mod quote;

use std::{
    collections::{HashMap, VecDeque},
    sync::{atomic::AtomicBool, Arc},
};

use tokio::sync::{broadcast, Mutex, RwLock};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,tower_http=info".into()))
        .init();

    let cfg = config::Config::from_env()?;
    let chain = chain::Chain::new(&cfg)?;
    let (tx, _) = broadcast::channel(16);
    let port = cfg.port;
    tracing::info!(registry = %cfg.registry, network = %cfg.network, rpc = %cfg.rpc_url, "starting that-invoice-api");
    for p in &cfg.personas {
        tracing::info!(persona = p.key, account = %p.account, key_loaded = cfg.secret_keys.contains_key(&p.account));
    }

    let state = Arc::new(app::AppState {
        cfg,
        chain,
        invoices: RwLock::new(Vec::new()),
        last_ok: RwLock::new(None),
        updates: tx,
        demo_running: AtomicBool::new(false),
        demo: Mutex::new(None),
        act_log: Mutex::new(VecDeque::new()),
        issue_log: Mutex::new(VecDeque::new()),
        demo_log: Mutex::new(VecDeque::new()),
        quote_cache: Mutex::new(HashMap::new()),
        state_cache: Mutex::new(None),
        http: reqwest::Client::builder().user_agent("that-invoice-api/0.1").build()?,
    });

    // Warm the read model before serving, so the first request after a cold start already has data.
    match tokio::time::timeout(std::time::Duration::from_secs(8), app::refresh_now(&state)).await {
        Ok(Ok(n)) => tracing::info!(invoices = n, "read model warmed"),
        Ok(Err(e)) => tracing::warn!("initial read failed, continuing: {e:#}"),
        Err(_) => tracing::warn!("initial read timed out, continuing"),
    }
    tokio::spawn(app::poll_loop(state.clone()));
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!("listening on :{port}");
    axum::serve(listener, app::router(state)).await?;
    Ok(())
}
