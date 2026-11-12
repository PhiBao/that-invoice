use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use anyhow::{anyhow, bail, Result};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, post},
    Json, Router,
};
use futures::Stream;
use near_api::types::{AccountId, NearToken};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::{broadcast, Mutex, RwLock};
use tower_http::{compression::CompressionLayer, cors::CorsLayer, trace::TraceLayer};

use crate::{
    chain::{Chain, TxOutcome},
    config::Config,
    demo, quote,
};

pub struct AppState {
    pub cfg: Config,
    pub chain: Chain,
    pub invoices: RwLock<Vec<Value>>,
    pub last_ok: RwLock<Option<Instant>>,
    pub updates: broadcast::Sender<String>,
    pub demo_running: AtomicBool,
    /// The current (or most recent) guided demo run, so clients can reconnect and replay it.
    pub demo: Mutex<Option<Arc<DemoRun>>>,
    pub act_log: Mutex<VecDeque<Instant>>,
    /// Hourly caps on the two operations that spend the demo accounts' NEAR.
    pub issue_log: Mutex<VecDeque<Instant>>,
    pub demo_log: Mutex<VecDeque<Instant>>,
    pub quote_cache: Mutex<std::collections::HashMap<String, (Instant, Value)>>,
    pub state_cache: Mutex<Option<(Instant, Value)>>,
    /// Last payment-recording transaction the keeper sent per invoice, so the demo can link it.
    /// Guest-account funding: per-IP and global sliding windows.
    pub guest_ips: Mutex<std::collections::HashMap<String, VecDeque<Instant>>>,
    pub guest_log: Mutex<VecDeque<Instant>>,
    pub keeper_txs: Mutex<std::collections::HashMap<String, (String, String)>>,
    pub http: reqwest::Client,
}

pub type Shared = Arc<AppState>;

/// A guided-demo run that executes on the server regardless of whether a browser stays connected.
pub struct DemoRun {
    events: Mutex<Vec<Value>>,
    tx: broadcast::Sender<Value>,
}

impl DemoRun {
    fn new() -> Self {
        Self { events: Mutex::new(Vec::new()), tx: broadcast::channel(64).0 }
    }
    async fn push(&self, v: Value) {
        self.events.lock().await.push(v.clone());
        let _ = self.tx.send(v);
    }
}

fn is_terminal(v: &Value) -> bool {
    matches!(v["kind"].as_str(), Some("done") | Some("error"))
}

/// Replay everything so far, then follow live until the run ends. Safe to call again after a dropped connection.
fn attach(run: Arc<DemoRun>) -> Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>> {
    let s = async_stream::stream! {
        let mut rx = run.tx.subscribe();
        let snapshot = run.events.lock().await.clone();
        for v in snapshot {
            let t = is_terminal(&v);
            yield Ok(Event::default().json_data(&v).unwrap());
            if t { return; }
        }
        loop {
            match rx.recv().await {
                Ok(v) => {
                    let t = is_terminal(&v);
                    yield Ok(Event::default().json_data(&v).unwrap());
                    if t { break; }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            }
        }
    };
    Sse::new(s).keep_alive(KeepAlive::new().interval(Duration::from_secs(10)))
}

pub struct ApiError(pub StatusCode, pub String);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}
impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        tracing::warn!("request failed: {e:#}");
        ApiError(StatusCode::BAD_GATEWAY, format!("{e:#}"))
    }
}
fn bad(msg: impl Into<String>) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, msg.into())
}

pub fn router(state: Shared) -> Router {
    let cors = match &state.cfg.allowed_origin {
        Some(o) => CorsLayer::new()
            .allow_origin(o.parse::<axum::http::HeaderValue>().expect("ALLOWED_ORIGIN"))
            .allow_methods([axum::http::Method::GET, axum::http::Method::POST])
            .allow_headers([axum::http::header::CONTENT_TYPE]),
        None => CorsLayer::permissive(),
    };
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/api/health", get(|| async { "ok" }))
        .route("/api/state", get(get_state))
        .route("/api/invoices/{id}", get(get_invoice))
        .route("/api/debtors/{account}", get(get_debtor))
        .route("/api/act", post(act))
        .route("/api/demo/run", post(demo_run).get(demo_attach))
        .route("/api/events", get(events))
        .route("/api/quote", get(get_quote))
        .route("/api/guest", post(post_guest))
        .route("/api/balance/{account}", get(get_balance))
        .route("/api/docs", post(post_doc))
        .route("/api/docs/{hash}", get(get_doc))
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}

// ───────────────────────────── read model ─────────────────────────────

/// Poll the registry and publish a tick whenever anything changed.
pub async fn poll_loop(st: Shared) {
    let mut last = String::new();
    loop {
        match fetch_all_invoices(&st).await {
            Ok(list) => {
                let fp = serde_json::to_string(&list).unwrap_or_default();
                *st.invoices.write().await = list;
                *st.last_ok.write().await = Some(Instant::now());
                if fp != last {
                    last = fp;
                    *st.state_cache.lock().await = None;
                    let _ = st.updates.send("update".into());
                }
            }
            Err(e) => tracing::warn!("poll failed: {e:#}"),
        }
        tokio::time::sleep(Duration::from_millis(4000)).await;
    }
}

/// Read the registry once and publish it. Used at startup and by the poller.
pub async fn refresh_now(st: &Shared) -> Result<usize> {
    let list = fetch_all_invoices(st).await?;
    let n = list.len();
    *st.invoices.write().await = list;
    *st.last_ok.write().await = Some(Instant::now());
    Ok(n)
}

async fn fetch_all_invoices(st: &Shared) -> Result<Vec<Value>> {
    let mut all = Vec::new();
    loop {
        let page: Vec<Value> = st
            .chain
            .registry_view("invoices", json!({ "from_index": all.len().to_string(), "limit": 100 }))
            .await?;
        let n = page.len();
        all.extend(page);
        if n < 100 {
            break;
        }
    }
    // Newest first; invoices still being created stay hidden from lists.
    all.retain(|i| i["status"] != "Creating");
    all.sort_by_key(|i| std::cmp::Reverse(i["seq"].as_str().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0)));
    Ok(all)
}

fn micro(v: u128) -> String {
    v.to_string()
}

async fn get_state(State(st): State<Shared>) -> Result<Json<Value>, ApiError> {
    // A burst of browser refreshes (one per SSE tick) should cost one set of RPC reads.
    {
        let c = st.state_cache.lock().await;
        if let Some((t, v)) = c.as_ref() {
            if t.elapsed() < Duration::from_millis(1200) {
                return Ok(Json(v.clone()));
            }
        }
    }
    let invoices = st.invoices.read().await.clone();
    let mut debtor_ids: Vec<String> = invoices.iter().filter_map(|i| i["debtor"].as_str().map(str::to_string)).collect();
    debtor_ids.sort();
    debtor_ids.dedup();

    let persona_futs = st.cfg.personas.iter().map(|p| {
        let st = st.clone();
        let p = p.clone();
        async move {
            let acct: Option<AccountId> = p.account.parse().ok();
            let bal = match &acct {
                Some(a) => st.chain.usdc_balance(a).await.unwrap_or(0),
                None => 0,
            };
            json!({
                "key": p.key, "account": p.account, "name": p.name, "role": p.role,
                "blurb": p.blurb, "usdc": micro(bal),
                "can_sign": match (&st.cfg.dao, p.key) {
                    (Some(d), "acme") => {
                        let ok = |s: &str| s.parse::<AccountId>().map(|a| st.chain.can_sign(&a)).unwrap_or(false);
                        ok(&d.proposer) && ok(&d.council)
                    }
                    _ => acct.map(|a| st.chain.can_sign(&a)).unwrap_or(false),
                },
                "is_dao": p.key == "acme" && st.cfg.dao.is_some(),
            })
        }
    });
    let debtor_futs = debtor_ids.iter().map(|d| {
        let st = st.clone();
        let d = d.clone();
        async move {
            let rec: Value = match d.parse::<AccountId>() {
                Ok(a) => st.chain.registry_view("debtor_record", json!({ "debtor": a })).await.unwrap_or(Value::Null),
                Err(_) => Value::Null,
            };
            (d, rec)
        }
    });
    let (personas, debtors, reg_cfg) = tokio::join!(
        futures::future::join_all(persona_futs),
        futures::future::join_all(debtor_futs),
        async { st.chain.registry_view::<Value>("config", json!({})).await.unwrap_or(Value::Null) },
    );
    let debtors: serde_json::Map<String, Value> = debtors.into_iter().collect();
    let stale = match *st.last_ok.read().await {
        Some(t) => t.elapsed() > Duration::from_secs(20),
        None => true,
    };
    let v = json!({
        "network": st.cfg.network,
        "registry": st.cfg.registry,
        "token": st.cfg.token,
        "explorer": st.cfg.explorer,
        "rpc": st.cfg.rpc_fallbacks.iter().cloned().chain(std::iter::once(st.cfg.rpc_url.clone())).collect::<Vec<_>>(),
        "registry_config": reg_cfg,
        "dao": st.cfg.dao.as_ref().map(|d| json!({ "account": d.account, "proposer": d.proposer, "council": d.council })),
        "stale": stale,
        "personas": personas,
        "invoices": invoices,
        "debtors": debtors,
    });
    *st.state_cache.lock().await = Some((Instant::now(), v.clone()));
    Ok(Json(v))
}

fn parse_invoice_id(st: &AppState, id: &str) -> Result<AccountId, ApiError> {
    let acct: AccountId = id.parse().map_err(|_| bad("invalid invoice id"))?;
    if !id.ends_with(&format!(".{}", st.cfg.registry)) {
        return Err(bad("not an invoice of this registry"));
    }
    Ok(acct)
}

async fn get_invoice(State(st): State<Shared>, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    let acct = parse_invoice_id(&st, &id)?;
    let inv: Option<Value> = st.chain.registry_view("invoice", json!({ "id": acct })).await?;
    let Some(inv) = inv else {
        return Err(ApiError(StatusCode::NOT_FOUND, "no such invoice".into()));
    };
    let held = st.chain.usdc_balance(&acct).await.unwrap_or(0);
    let debtor: Option<AccountId> = inv["debtor"].as_str().and_then(|d| d.parse().ok());
    let record: Value = match debtor {
        Some(d) => st.chain.registry_view("debtor_record", json!({ "debtor": d })).await.unwrap_or(Value::Null),
        None => Value::Null,
    };
    Ok(Json(json!({ "invoice": inv, "held": micro(held), "debtor_record": record })))
}

async fn get_debtor(State(st): State<Shared>, Path(account): Path<String>) -> Result<Json<Value>, ApiError> {
    let acct: AccountId = account.parse().map_err(|_| bad("invalid account"))?;
    let record: Value = st.chain.registry_view("debtor_record", json!({ "debtor": acct })).await?;
    let invs: Vec<Value> = st
        .invoices
        .read()
        .await
        .iter()
        .filter(|i| i["debtor"] == account.as_str())
        .cloned()
        .collect();
    Ok(Json(json!({ "account": account, "record": record, "invoices": invs })))
}

async fn events(State(st): State<Shared>) -> Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>> {
    let mut rx = st.updates.subscribe();
    let s = async_stream::stream! {
        yield Ok(Event::default().event("hello").data("ok"));
        loop {
            match rx.recv().await {
                Ok(m) => yield Ok(Event::default().event(m).data("1")),
                Err(broadcast::error::RecvError::Lagged(_)) => yield Ok(Event::default().event("update").data("1")),
                Err(_) => break,
            }
        }
    };
    Sse::new(s).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

// ───────────────────────────── actions ─────────────────────────────

#[derive(Deserialize)]
pub struct ActReq {
    pub persona: String,
    pub action: String,
    #[serde(default)]
    pub params: Value,
}

/// `12.5` -> 12_500_000. Six decimals, no scientific notation, bounded.
pub fn parse_usdc(v: &Value) -> Result<u128> {
    let s = match v {
        Value::String(s) => s.trim().to_string(),
        Value::Number(n) => n.to_string(),
        _ => bail!("amount must be a number"),
    };
    if s.is_empty() || !s.chars().all(|c| c.is_ascii_digit() || c == '.') || s.matches('.').count() > 1 {
        bail!("amount must be a plain decimal like 1200 or 1200.50");
    }
    let (whole, frac) = s.split_once('.').unwrap_or((&s, ""));
    if frac.len() > 6 {
        bail!("at most 6 decimal places");
    }
    let whole: u128 = if whole.is_empty() { 0 } else { whole.parse()? };
    let frac: u128 = format!("{frac:0<6}").parse()?;
    let total = whole.checked_mul(1_000_000).and_then(|w| w.checked_add(frac)).ok_or_else(|| anyhow!("amount too large"))?;
    if total == 0 || total > 1_000_000 * 1_000_000 {
        bail!("amount must be between 0.000001 and 1,000,000");
    }
    Ok(total)
}

/// Sliding-window limiter: at most `max` events per `window`.
pub async fn within(log: &Mutex<VecDeque<Instant>>, max: usize, window: Duration) -> bool {
    let mut log = log.lock().await;
    let now = Instant::now();
    while log.front().is_some_and(|t| now.duration_since(*t) > window) {
        log.pop_front();
    }
    if log.len() >= max {
        return false;
    }
    log.push_back(now);
    true
}

async fn rate_ok(st: &AppState) -> bool {
    let mut log = st.act_log.lock().await;
    let now = Instant::now();
    while log.front().is_some_and(|t| now.duration_since(*t) > Duration::from_secs(60)) {
        log.pop_front();
    }
    if log.len() >= 60 {
        return false;
    }
    log.push_back(now);
    true
}

pub fn persona_account(st: &AppState, key: &str) -> Result<AccountId> {
    st.cfg
        .personas
        .iter()
        .find(|p| p.key == key)
        .map(|p| p.account.parse().map_err(|e| anyhow!("{e}")))
        .unwrap_or_else(|| Err(anyhow!("unknown persona {key}")))
}

/// Execute one product action on behalf of a demo persona.
pub async fn run_action(st: &AppState, persona: &str, action: &str, p: &Value) -> Result<TxOutcome> {
    if persona == "acme" {
        if let Some(dao) = st.cfg.dao.clone() {
            return run_dao_action(st, &dao, action, p).await;
        }
    }
    let who = persona_account(st, persona)?;
    let reg = st.chain.registry.clone();
    let id_of = |p: &Value| -> Result<AccountId> {
        let id = p["id"].as_str().ok_or_else(|| anyhow!("id is required"))?;
        parse_invoice_id(st, id).map_err(|e| anyhow!(e.1))
    };
    match action {
        "issue" => {
            let debtor = match p["debtor"].as_str() {
                Some(d) if st.cfg.personas.iter().any(|x| x.key == d) => persona_account(st, d)?,
                Some(d) => d.parse().map_err(|_| anyhow!("invalid debtor account"))?,
                None => bail!("debtor is required"),
            };
            let number = p["number"].as_str().ok_or_else(|| anyhow!("number is required"))?;
            let amount = parse_usdc(&p["amount"])?;
            let days = p["due_days"].as_i64().unwrap_or(30).clamp(0, 365);
            let due_ms = p["due_ms"]
                .as_u64()
                .unwrap_or_else(|| (chrono::Utc::now().timestamp_millis() + days * 86_400_000) as u64);
            let doc_hash = p["doc_hash"].as_str().unwrap_or("");
            st.chain
                .call(
                    &who,
                    &reg,
                    "issue",
                    json!({ "debtor": debtor, "number": number, "amount": micro(amount),
                            "due_ms": due_ms.to_string(), "doc_hash": doc_hash }),
                    NearToken::from_millinear(100),
                    150,
                )
                .await
        }
        "confirm" => st.chain.call(&who, &reg, "confirm", json!({ "id": id_of(p)? }), NearToken::from_yoctonear(0), 30).await,
        "list" => {
            let price = parse_usdc(&p["price"])?;
            st.chain.call(&who, &reg, "list", json!({ "id": id_of(p)?, "price": micro(price) }), NearToken::from_yoctonear(0), 30).await
        }
        "delist" => st.chain.call(&who, &reg, "delist", json!({ "id": id_of(p)? }), NearToken::from_yoctonear(0), 30).await,
        "buy" => {
            let id = id_of(p)?;
            let inv: Option<Value> = st.chain.registry_view("invoice", json!({ "id": id })).await?;
            let price: u128 = inv
                .as_ref()
                .and_then(|i| i["price"].as_str())
                .and_then(|s| s.parse().ok())
                .ok_or_else(|| anyhow!("invoice is not for sale"))?;
            let token = st.chain.token.clone();
            st.chain
                .call(
                    &who,
                    &token,
                    "ft_transfer_call",
                    json!({ "receiver_id": reg, "amount": micro(price), "msg": json!({ "buy": id }).to_string() }),
                    NearToken::from_yoctonear(1),
                    200,
                )
                .await
        }
        "pay" => {
            let id = id_of(p)?;
            let amount = if p["amount"].is_null() {
                let inv: Option<Value> = st.chain.registry_view("invoice", json!({ "id": id })).await?;
                inv.as_ref()
                    .and_then(|i| i["amount"].as_str())
                    .and_then(|s| s.parse().ok())
                    .ok_or_else(|| anyhow!("no such invoice"))?
            } else {
                parse_usdc(&p["amount"])?
            };
            let token = st.chain.token.clone();
            st.chain
                .call(&who, &token, "ft_transfer", json!({ "receiver_id": id, "amount": micro(amount) }), NearToken::from_yoctonear(1), 30)
                .await
        }
        "sync" => st.chain.call(&who, &reg, "sync", json!({ "id": id_of(p)? }), NearToken::from_yoctonear(0), 50).await,
        "claim" => st.chain.call(&who, &reg, "claim", json!({ "id": id_of(p)? }), NearToken::from_yoctonear(0), 150).await,
        "withdraw" => st.chain.call(&who, &reg, "withdraw_proceeds", json!({}), NearToken::from_yoctonear(0), 60).await,
        other => bail!("unknown action {other}"),
    }
}

/// Acme is a real Sputnik DAO. Anything it "does" is a proposal that a council member approves; the DAO
/// contract then makes the call itself, so the registry sees the DAO account as the caller.
async fn run_dao_action(st: &AppState, dao: &crate::config::DaoCfg, action: &str, p: &Value) -> Result<TxOutcome> {
    let dao_id: AccountId = dao.account.parse()?;
    let proposer: AccountId = dao.proposer.parse()?;
    let council: AccountId = dao.council.parse()?;
    let reg = st.chain.registry.clone();
    let token = st.chain.token.clone();
    let id = |p: &Value| -> Result<AccountId> {
        let id = p["id"].as_str().ok_or_else(|| anyhow!("id is required"))?;
        parse_invoice_id(st, id).map_err(|e| anyhow!(e.1))
    };
    let (receiver, method, args, deposit, gas, description) = match action {
        "confirm" => {
            let i = id(p)?;
            let inv: Option<Value> = st.chain.registry_view("invoice", json!({ "id": i })).await?;
            let inv = inv.ok_or_else(|| anyhow!("no such invoice"))?;
            (
                reg,
                "confirm",
                json!({ "id": i }),
                "0".to_string(),
                60_000_000_000_000u64,
                format!(
                    "Confirm invoice {} from {} for ${}",
                    inv["number"].as_str().unwrap_or("?"),
                    inv["issuer"].as_str().unwrap_or("?"),
                    inv["amount"].as_str().and_then(|a| a.parse::<u128>().ok()).map(|a| a / 1_000_000).unwrap_or(0)
                ),
            )
        }
        "pay" => {
            let i = id(p)?;
            let inv: Option<Value> = st.chain.registry_view("invoice", json!({ "id": i })).await?;
            let inv = inv.ok_or_else(|| anyhow!("no such invoice"))?;
            let amount = if p["amount"].is_null() {
                inv["amount"].as_str().and_then(|s| s.parse::<u128>().ok()).ok_or_else(|| anyhow!("no such invoice"))?
            } else {
                parse_usdc(&p["amount"])?
            };
            // A treasury pays from what it holds. Make sure the demo DAO's treasury can cover this invoice.
            ensure_usdc(st, &dao_id, amount).await?;
            (
                token,
                "ft_transfer",
                json!({ "receiver_id": i, "amount": micro(amount) }),
                "1".to_string(),
                30_000_000_000_000u64,
                format!("Pay invoice {} (${})", inv["number"].as_str().unwrap_or("?"), amount / 1_000_000),
            )
        }
        other => bail!("the DAO persona can confirm and pay invoices, not {other}"),
    };

    use base64_engine as b64;
    let kind = json!({ "FunctionCall": { "receiver_id": receiver, "actions": [{
        "method_name": method, "args": b64::encode(args.to_string()), "deposit": deposit, "gas": gas.to_string() }] } });
    // 1. a proposer files the proposal (the bond is returned when it is approved)
    let filed = st
        .chain
        .call(&proposer, &dao_id, "add_proposal", json!({ "proposal": { "description": description, "kind": kind } }),
            NearToken::from_near(1), 30)
        .await?;
    if !filed.ok {
        return Ok(filed);
    }
    let pid = filed.ret.as_ref().and_then(|v| v.as_u64()).ok_or_else(|| anyhow!("the DAO did not return a proposal id"))?;
    // 2. a council member approves it; the DAO then makes the call
    let mut out = st
        .chain
        .call(&council, &dao_id, "act_proposal", json!({ "id": pid, "action": "VoteApprove" }), NearToken::from_yoctonear(0), 250)
        .await?;
    out.extras.insert(0, crate::chain::Extra {
        label: format!("proposal #{pid}"),
        hash: filed.hash.clone(),
        explorer_url: filed.explorer_url.clone(),
    });
    if out.ok {
        // The approval can succeed while the DAO's call fails (the proposal then ends up Failed).
        let status: Value = st.chain.view(&dao_id, "get_proposal", json!({ "id": pid })).await.unwrap_or(Value::Null);
        if status["status"] != "Approved" {
            out.ok = false;
            out.error = Some(out.soft_error.clone().unwrap_or_else(|| format!("the proposal ended as {}", status["status"])));
        }
    }
    Ok(out)
}

/// Top up a demo account with test USDC from the token account so it can cover `need`.
/// Used for the Acme DAO treasury: it must hold at least the invoice it is asked to pay.
pub async fn ensure_usdc(st: &AppState, account: &AccountId, need: u128) -> Result<()> {
    let have = st.chain.usdc_balance(account).await.unwrap_or(0);
    if have >= need {
        return Ok(());
    }
    let token = st.chain.token.clone();
    let registered: Value = st.chain.view(&token, "storage_balance_of", json!({ "account_id": account })).await.unwrap_or(Value::Null);
    if registered.is_null() {
        let out = st
            .chain
            .call(&token, &token, "storage_deposit", json!({ "account_id": account, "registration_only": true }), NearToken::from_millinear(2), 30)
            .await?;
        if !out.ok {
            bail!("could not register {account} on the token: {}", out.error.unwrap_or_default());
        }
    }
    // Fund to need + a buffer, so the next invoice does not need another top-up.
    let amount = need - have + 5_000_000_000;
    let out = st
        .chain
        .call(&token, &token, "ft_transfer", json!({ "receiver_id": account, "amount": micro(amount) }), NearToken::from_yoctonear(1), 30)
        .await?;
    if !out.ok {
        bail!("could not fund the treasury: {}", out.error.unwrap_or_default());
    }
    Ok(())
}

mod base64_engine {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    pub fn encode(s: String) -> String {
        let b = s.as_bytes();
        let mut o = String::with_capacity(b.len().div_ceil(3) * 4);
        for c in b.chunks(3) {
            let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
            o.push(T[(n >> 18 & 63) as usize] as char);
            o.push(T[(n >> 12 & 63) as usize] as char);
            o.push(if c.len() > 1 { T[(n >> 6 & 63) as usize] as char } else { '=' });
            o.push(if c.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
        }
        o
    }
}

async fn act(State(st): State<Shared>, Json(req): Json<ActReq>) -> Result<Json<Value>, ApiError> {
    if !rate_ok(&st).await {
        return Err(ApiError(StatusCode::TOO_MANY_REQUESTS, "slow down: demo actions are rate limited".into()));
    }
    if st.demo_running.load(Ordering::SeqCst) {
        return Err(ApiError(StatusCode::CONFLICT, "the guided demo is running; try again in a minute".into()));
    }
    if req.action == "issue" && !within(&st.issue_log, 20, Duration::from_secs(3600)).await {
        return Err(ApiError(StatusCode::TOO_MANY_REQUESTS, "the demo allows 20 new invoices an hour; try again later".into()));
    }
    let out = run_action(&st, &req.persona, &req.action, &req.params)
        .await
        .map_err(|e| bad(format!("{e:#}")))?;
    // Give the poller a nudge so the UI sees the new state quickly.
    if out.ok {
        if let Ok(list) = fetch_all_invoices(&st).await {
            *st.invoices.write().await = list;
            *st.state_cache.lock().await = None;
            let _ = st.updates.send("update".into());
        }
    }
    Ok(Json(serde_json::to_value(out).unwrap()))
}

// ───────────────────────────── demo, quote, docs ─────────────────────────────

async fn demo_run(State(st): State<Shared>) -> Result<Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>>, ApiError> {
    // A run already in progress is shared: a second visitor watches the same one.
    if st.demo_running.swap(true, Ordering::SeqCst) {
        let run = st.demo.lock().await.clone();
        return match run {
            Some(r) => Ok(attach(r)),
            None => Err(ApiError(StatusCode::CONFLICT, "a demo run is already in progress".into())),
        };
    }
    if !within(&st.demo_log, 12, Duration::from_secs(3600)).await {
        st.demo_running.store(false, Ordering::SeqCst);
        return Err(ApiError(StatusCode::TOO_MANY_REQUESTS, "the live demo is limited to 12 runs an hour; try again later".into()));
    }
    let run = Arc::new(DemoRun::new());
    *st.demo.lock().await = Some(run.clone());
    let worker = run.clone();
    let st2 = st.clone();
    // The run belongs to the server, not to the HTTP connection: a dropped browser does not stop it.
    tokio::spawn(async move {
        use futures::StreamExt;
        let s = demo::stream(st2);
        futures::pin_mut!(s);
        while let Some(v) = s.next().await {
            worker.push(v).await;
        }
    });
    Ok(attach(run))
}

/// Re-attach to the current or latest run (used after a dropped connection).
async fn demo_attach(State(st): State<Shared>) -> Result<Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>>, ApiError> {
    match st.demo.lock().await.clone() {
        Some(r) => Ok(attach(r)),
        None => Err(ApiError(StatusCode::NOT_FOUND, "no demo run to attach to".into())),
    }
}

#[derive(Deserialize)]
struct QuoteQ {
    amount: Option<String>,
}

async fn get_quote(State(st): State<Shared>, Query(q): Query<QuoteQ>) -> Result<Json<Value>, ApiError> {
    let amount = parse_usdc(&Value::String(q.amount.unwrap_or_else(|| "1200".into()))).map_err(|e| bad(format!("{e:#}")))?;
    let cache_key = amount.to_string();
    {
        let c = st.quote_cache.lock().await;
        if let Some((t, v)) = c.get(&cache_key) {
            if t.elapsed() < Duration::from_secs(20) {
                return Ok(Json(v.clone()));
            }
        }
    }
    let v = quote::dry_quotes(&st, amount).await?;
    st.quote_cache.lock().await.insert(cache_key, (Instant::now(), v.clone()));
    Ok(Json(v))
}

async fn post_doc(State(st): State<Shared>, Json(doc): Json<Value>) -> Result<Json<Value>, ApiError> {
    if !doc.is_object() {
        return Err(bad("document must be a JSON object"));
    }
    let canonical = serde_json::to_string(&doc).map_err(|e| bad(e.to_string()))?; // keys sorted: serde_json Map is a BTreeMap
    if canonical.len() > 16 * 1024 {
        return Err(bad("document too large (16 KB max)"));
    }
    let hex = hex::encode(Sha256::digest(canonical.as_bytes()));
    let dir = st.cfg.data_dir.join("docs");
    tokio::fs::create_dir_all(&dir).await.map_err(|e| anyhow!(e))?;
    let mut n = 0usize;
    if let Ok(mut rd) = tokio::fs::read_dir(&dir).await {
        while let Ok(Some(_)) = rd.next_entry().await {
            n += 1;
        }
    }
    if n > 5000 {
        return Err(ApiError(StatusCode::INSUFFICIENT_STORAGE, "document store is full".into()));
    }
    tokio::fs::write(dir.join(format!("{hex}.json")), canonical).await.map_err(|e| anyhow!(e))?;
    Ok(Json(json!({ "doc_hash": format!("sha256:{hex}") })))
}

async fn get_doc(State(st): State<Shared>, Path(hash): Path<String>) -> Result<Json<Value>, ApiError> {
    let hex = hash.strip_prefix("sha256:").unwrap_or(&hash);
    if hex.len() != 64 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(bad("bad hash"));
    }
    let raw = tokio::fs::read_to_string(st.cfg.data_dir.join("docs").join(format!("{}.json", hex.to_lowercase())))
        .await
        .map_err(|_| ApiError(StatusCode::NOT_FOUND, "no such document".into()))?;
    let verified = hex::encode(Sha256::digest(raw.as_bytes())) == hex.to_lowercase();
    Ok(Json(json!({ "doc_hash": format!("sha256:{hex}"), "verified": verified, "document": serde_json::from_str::<Value>(&raw).unwrap_or(Value::Null) })))
}

// ───────────────────────────── guest accounts ─────────────────────────────
//
// A visitor's browser generates an ed25519 key. The matching *implicit* NEAR account is the 64-character hex of
// the public key, so it exists the moment it receives NEAR. We send it a little gas money and some demo USDC;
// from then on the browser signs its own transactions. The server never sees the secret key.

const B58: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

fn base58_decode(s: &str) -> Option<Vec<u8>> {
    let mut out: Vec<u8> = Vec::new();
    for ch in s.bytes() {
        let mut carry = B58.iter().position(|&c| c == ch)? as u32;
        for b in out.iter_mut() {
            carry += (*b as u32) * 58;
            *b = (carry & 0xff) as u8;
            carry >>= 8;
        }
        while carry > 0 {
            out.push((carry & 0xff) as u8);
            carry >>= 8;
        }
    }
    for _ in s.bytes().take_while(|&c| c == b'1') {
        out.push(0);
    }
    out.reverse();
    Some(out)
}

/// `ed25519:<base58>` -> the implicit account id (lowercase hex of the 32 key bytes).
pub fn implicit_account(public_key: &str) -> Option<String> {
    let raw = public_key.strip_prefix("ed25519:")?;
    let bytes = base58_decode(raw)?;
    if bytes.len() != 32 {
        return None;
    }
    Some(hex::encode(bytes))
}

#[derive(Deserialize)]
struct GuestReq {
    public_key: String,
}

fn client_ip(h: &axum::http::HeaderMap) -> String {
    for name in ["fly-client-ip", "x-forwarded-for", "x-real-ip"] {
        if let Some(v) = h.get(name).and_then(|v| v.to_str().ok()) {
            return v.split(',').next().unwrap_or("").trim().to_string();
        }
    }
    "local".into()
}

/// Gas money for a guest. Prepaid gas is refunded, so this covers a few full journeys.
const GUEST_NEAR: NearToken = NearToken::from_millinear(300);
const GUEST_MIN_NEAR: u128 = 150_000_000_000_000_000_000_000; // below this a guest is topped up
const GUEST_USDC: u128 = 10_000_000_000; // 10,000 demo USDC: enough to buy any invoice in the seeded market

async fn post_guest(
    State(st): State<Shared>,
    headers: axum::http::HeaderMap,
    Json(req): Json<GuestReq>,
) -> Result<Json<Value>, ApiError> {
    let account = implicit_account(&req.public_key).ok_or_else(|| bad("public_key must be an ed25519 key"))?;
    let acct: AccountId = account.parse().map_err(|_| bad("bad account"))?;
    let usdc_have = st.chain.usdc_balance(&acct).await.unwrap_or(0);
    let near_have = st.chain.near_balance(&acct).await;

    // Returning visitors who are already funded cost nothing.
    if near_have >= GUEST_MIN_NEAR && usdc_have >= 1_000_000_000 {
        return Ok(Json(json!({ "account_id": account, "funded": false, "usdc": micro(usdc_have), "near": near_have.to_string() })));
    }
    let ip = client_ip(&headers);
    {
        let mut m = st.guest_ips.lock().await;
        let log = m.entry(ip.clone()).or_default();
        let now = Instant::now();
        while log.front().is_some_and(|t| now.duration_since(*t) > Duration::from_secs(3600)) {
            log.pop_front();
        }
        if log.len() >= st.cfg.guest_per_ip {
            return Err(ApiError(StatusCode::TOO_MANY_REQUESTS, "you already created guest accounts from this address; try again in an hour".into()));
        }
        log.push_back(now);
    }
    if !within(&st.guest_log, 20, Duration::from_secs(3600)).await {
        return Err(ApiError(StatusCode::TOO_MANY_REQUESTS, "the demo is handing out a lot of guest accounts right now; try again shortly".into()));
    }

    let funder: AccountId = st.cfg.guest_funder.parse().map_err(|_| bad("guest funding is not configured"))?;
    if !st.chain.can_sign(&funder) {
        return Err(ApiError(StatusCode::SERVICE_UNAVAILABLE, "guest funding is not configured".into()));
    }
    // Don't hand out the last of the demo's NEAR.
    if st.chain.near_balance(&funder).await < 1_500_000_000_000_000_000_000_000 {
        return Err(ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "guest accounts are temporarily unavailable (the demo faucet is empty). The server personas still work.".into(),
        ));
    }
    let token = st.chain.token.clone();
    // The NEAR transfer (from the funder) and the token set-up (from the token account) use different keys, so they run in parallel.
    let gas_money = async {
        if near_have < GUEST_MIN_NEAR {
            st.chain.send_near(&funder, &acct, GUEST_NEAR).await.map(|_| ())
        } else {
            Ok(())
        }
    };
    let token_setup = async {
        let reg: Value = st.chain.view(&token, "storage_balance_of", json!({ "account_id": acct })).await.unwrap_or(Value::Null);
        if reg.is_null() {
            let out = st
                .chain
                .call(&token, &token, "storage_deposit", json!({ "account_id": acct, "registration_only": true }), NearToken::from_millinear(2), 30)
                .await?;
            if !out.ok {
                anyhow::bail!(out.error.unwrap_or_default());
            }
        }
        if usdc_have < 1_000_000_000 {
            let out = st
                .chain
                .call(&token, &token, "ft_transfer", json!({ "receiver_id": acct, "amount": micro(GUEST_USDC) }), NearToken::from_yoctonear(1), 30)
                .await?;
            if !out.ok {
                anyhow::bail!(out.error.unwrap_or_default());
            }
        }
        Ok::<(), anyhow::Error>(())
    };
    let (a1, a2) = tokio::join!(gas_money, token_setup);
    a1.map_err(|e| ApiError(StatusCode::BAD_GATEWAY, format!("{e:#}")))?;
    a2.map_err(|e| ApiError(StatusCode::BAD_GATEWAY, format!("{e:#}")))?;
    let usdc = st.chain.usdc_balance(&acct).await.unwrap_or(0);
    Ok(Json(json!({ "account_id": account, "funded": true, "usdc": micro(usdc), "near": GUEST_NEAR.as_yoctonear().to_string() })))
}

async fn get_balance(State(st): State<Shared>, Path(account): Path<String>) -> Result<Json<Value>, ApiError> {
    let acct: AccountId = account.parse().map_err(|_| bad("invalid account"))?;
    let usdc = st.chain.usdc_balance(&acct).await.unwrap_or(0);
    let near = st.chain.near_balance(&acct).await;
    Ok(Json(json!({ "account_id": account, "usdc": micro(usdc), "near": near.to_string() })))
}

#[cfg(test)]
mod guest_tests {
    use super::implicit_account;

    #[test]
    fn implicit_account_matches_near_api_js() {
        assert_eq!(implicit_account("ed25519:FNm6T6Baz3oQ8Uz2ENTdBBW5ixyV8iKPak6N1w5cPFGe").as_deref(), Some("d596abd1409e1ffcdc38cf6df9d3e09d2c31896adbf4b7b9c32b9930ad2b7723"));
        assert_eq!(implicit_account("ed25519:D6ASynjExGML98QharEWDSZGvoDhKvyNw6vWtXpvqe4H").as_deref(), Some("b39ed477dc980cd05d88ed613a1f0494ef37e16548911559be1f70e4b357a122"));
        assert_eq!(implicit_account("ed25519:E1VQCKrpGjNVapRJENCCK1fvTtFzzbHoBTQ4C6eRTvHT").as_deref(), Some("c1480abc17db7d7432c2758b90bdd5b9011ea310e9352ca234be6e0414f9219e"));
        assert_eq!(implicit_account("ed25519:5KC5Qwek92ENdukyP396vjAsqgJUwWHdd3QCShdYN8uj").as_deref(), Some("4017b9dd74f21c74f0d585b8215b01768d93df46e16917c6c615eab124a05626"));
    }

    #[test]
    fn rejects_malformed_keys() {
        assert!(implicit_account("secp256k1:abc").is_none());
        assert!(implicit_account("ed25519:").is_none());
        assert!(implicit_account("ed25519:0OIl").is_none()); // characters outside base58
        assert!(implicit_account("ed25519:3yZe7d").is_none()); // wrong length
    }
}
