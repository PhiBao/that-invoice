# That Invoice

**The invoice is the account.**

That Invoice gives every invoice its own NEAR account. The client pays that account from any chain. The business can sell the invoice for cash today, and whoever owns it when it is paid collects. The payment address never changes, so nothing has to be forwarded and nothing can be sold twice.

Built for **NEAR HACKATHON 2026**. Primary track: **NFTs That Do Something** (`nfts`). Also fits **Real-World Money** (`realworld`) and **Unstoppable DeFi** (`defi`).

> Everything runs on **NEAR testnet**. Invoices settle in a **demo USDC** token. The pay-from-any-chain quotes are live dry runs against NEAR Intents mainnet liquidity (Intents has no testnet). See [What is real, what is not](#what-is-real-what-is-not).

**Live demo:** https://that-invoice.fly.dev (custom domain: https://thatinvoice.uconfidant.tech once DNS propagates) · **Repo:** https://github.com/PhiBao/that-invoice

> The demo server sleeps when idle to save cost. The first visit can take about 6 seconds to wake it; the page shows a "waking the demo server" banner meanwhile.

![The invoice document](docs/screenshots/invoice-back.png)

---

## Try it in two minutes

You do not need a wallet or any NEAR. The server signs for three demo personas (testnet keys, test USDC only).

1. Open **https://that-invoice.fly.dev/demo** (or start the stack yourself, see [Run it](#run-it), and open `http://localhost:3000/demo`).
2. Press **Run the demo**. After about 45 seconds you see ten steps, each with a transaction link. **Expected:** nine steps pass, and two of them show a red **Refused by the contract** note (the same invoice issued twice, and the old owner trying to sell again).
3. Open the invoice from the green note. Click **Endorsements ↻**. **Expected:** the back of the invoice lists *Issued, Confirmed as owed, Offered, Sold, Paid in full, Collected*, ending with `Pay to the order of endorse-fund.testnet`.
4. Open the **Buyer desk**, then run the demo again and watch the ledger update live (server-sent events, no refresh).
5. Switch persona in the header (Studio Nine, Acme DAO, Northfield Fund) and go to **New invoice** to run the flow by hand: issue as Studio Nine, confirm as Acme, list as Studio Nine, buy as the Fund, pay as Acme, **Record the payment**, claim as the Fund.

Prefer no UI? `node scripts/e2e.mjs` runs the same lifecycle from the command line and prints the result of each step.

---

## The problem

A freelancer, studio or agency that bills crypto-native clients (DAOs, protocols, web3 companies) usually waits 30 to 60 days to be paid. The ways to get cash sooner are poor:

- **Factoring** costs 1 to 5 percent a month, takes days to onboard, and needs the client to be notified.
- **Receivables pools** on-chain (Centrifuge, Huma) still send the client's payment to the original business, which then has to forward it to the investor.
- **Investors fear double-financed invoices.** First Brands had about $2.3B of factoring liabilities while investigators asked whether invoices had been sold more than once ([Reuters](https://www.investing.com/news/stock-market-news/first-brands-creditor-says-23-billion-simply-vanished-seeksprobe-4278590), [GTR](https://www.gtreview.com/news/americas/first-brands-faces-investigation-into-double-financing-of-receivables-inventory/)). The UCC registry records a pledge, but it does not identify individual invoices ([IFA Commercial Factor](https://magazine.factoring.org/magazine-articles/rethinking-receivables-risk-what-recent-frauds-reveal-about-market-infrastructure)).

## The idea

**Make the thing being paid the thing being sold.**

When the payment address *is* the asset, a sale needs no notice to the client and no forwarding step. Whoever owns the invoice token when the payment arrives can collect it. Two sellers cannot both own it, and the old owner cannot redirect the money.

| | Factoring / pools | That Invoice |
|---|---|---|
| Who the client pays | The original business | The invoice account itself |
| After a sale | Business forwards the money | Nothing to forward; the buyer collects |
| Same invoice sold twice | Possible, found later | Refused by the contract |
| Client notified of a sale | Usually yes | Not needed |
| Pay from another chain | No | Yes, through NEAR Intents |

## How it works

![Lifecycle](docs/diagrams/lifecycle.svg)

1. **Issue.** `registry.issue(debtor, number, amount, due, doc_hash)` creates `inv-N.<registry>` as a real NEAR account running one shared, immutable contract, registers it on the USDC token, and mints the invoice as an NEP-171 token to the issuer. The pair (issuer, debtor, number) is unique.
2. **Confirm.** Only the debtor account can confirm, which can be a person, a contract or a DAO executing a proposal. Only confirmed invoices can be sold.
3. **Sell.** The owner lists at a discount. A buyer calls `ft_transfer_call(registry, price, {"buy": id})`. In a single receipt the token moves to the buyer and the seller is paid. Listing locks the token.
4. **Pay.** The client sends USDC to `inv-N.<registry>`. On mainnet that can come from Base, Arbitrum, Ethereum or Solana through NEAR Intents.
5. **Record and collect.** `sync` reads the invoice account's token balance. When it covers the face value the invoice is `Paid`. The current owner calls `claim`; the registry asks the invoice account to release the money to that owner. The token is locked (`Claiming`) until the payout settles.

### Why the money cannot go to the wrong person

![Trust model](docs/diagrams/trust-model.svg)

The invoice account has one exit, `release()`, callable only by the registry. The registry calls it only from `claim`, which only the current owner can call, and only while the invoice is `Paid`. The invoice contract is published as a [NEP-591 global contract by code hash](https://docs.near.org/smart-contracts/global-contracts), so it is immutable and has no keys.

### Client record

The registry keeps a record per debtor: invoices confirmed, paid, paid on time, total paid, and days late. Only confirmed and paid invoices count, so nobody can damage an account's record by billing it. The Buyer desk shows this record next to each price, which is the information an investor needs.

---

## What is real, what is not

| Part | Status |
|---|---|
| Registry and invoice-account contracts | **Real.** Deployed on NEAR testnet; source in `contracts/`. |
| Invoice accounts (`inv-N.<registry>`) | **Real** NEAR accounts created on issue, running the shared global contract. |
| NEP-171 ownership, sale, payment, claim | **Real** transactions, each linked in the UI. |
| Refusals (duplicate issue, resale by the old owner) | **Real** contract panics, shown verbatim. |
| Debtor record | **Real**, computed on-chain. |
| USDC | **Demo token** on testnet (the shared global NEP-141, 6 decimals). Worthless. |
| Pay from any chain | **Live dry-run quotes** from the NEAR Intents 1Click API against mainnet liquidity. No funds move. Intents has no testnet, so the testnet demo invoice is paid in test USDC. A mainnet payment is the next step (see [Roadmap](#limitations-and-roadmap)). |
| Personas (Studio Nine, Acme DAO, Northfield Fund) | **Server-held testnet keys** so judges can click through without a wallet. They hold test funds only. |
| Wallet login | **Not built.** The browser never signs; the API signs for the personas. |
| Marketplace liquidity | **None.** The "investor" is a demo persona. |

## Architecture

![Architecture](docs/diagrams/architecture.svg)

| Layer | Tech | Notes |
|---|---|---|
| Contracts | Rust, `near-sdk` 5.30, wasm + `wasm-opt` | `registry` (about 260 KB) and `invoice-account` (about 110 KB). 46 unit tests. |
| API | Rust, Axum, Tokio, `near-api` | Polls the registry into a cached read model with SSE; signs for personas; runs the guided demo; proxies 1Click dry quotes; stores invoice documents by SHA-256. |
| Web | Next.js 16, React 19, TypeScript, pnpm | Hand-written CSS (no component library). Newsreader, Geist, Geist Mono. |
| Chain access | NEAR public RPC (fastnear) | |

### Repository layout

```
contracts/registry          invoice state machine, NEP-171, market, client records (+ tests)
contracts/invoice-account   the tiny contract every invoice account runs
services/api                Rust API
apps/web                    Next.js app
scripts/                    build, deploy, bootstrap, e2e, diagram generator
docs/diagrams               the three SVG diagrams (generated by scripts/gen-diagrams.py)
deployment.json             what is deployed on testnet
```

### Deployed on testnet

| Item | Value |
|---|---|
| Registry | `endorse-v1.testnet` |
| Demo USDC | `endorse-usdc.testnet` |
| Invoice contract (global, by hash) | `EGwUfUK3o1Uqp7QWC4pXenmz89idUbsnZLQj7XHXh9BV`, published by `endorse-pub2.testnet` |
| Personas | `endorse-studio.testnet`, `endorse-acme.testnet`, `endorse-fund.testnet` |

The `endorse-*` account names come from the project's working title. NEAR accounts cannot be renamed, so the testnet deployment keeps them.

---

## Run it

**Prerequisites:** Rust (stable or nightly) with the `wasm32-unknown-unknown` target, Node 22+, pnpm 11, and [`binaryen`](https://github.com/WebAssembly/binaryen) for `wasm-opt` (optional; only for size).

```bash
git clone <this repository> && cd that-invoice
pnpm install
```

### Option A: use the existing testnet deployment

You need the persona keys in `~/.near-credentials/testnet/` (the repo does not contain keys), or your own deployment (Option B).

```bash
cp .env.example .env                       # points at endorse-v1.testnet
set -a; . ./.env; set +a
cargo run -p that-invoice-api --release         # API on :8787
pnpm --dir apps/web build && pnpm --dir apps/web start    # web on :3000 (API_URL defaults to http://localhost:8787)
```

### Option B: your own deployment in about a minute

This creates new accounts, deploys your own registry against the already-published invoice contract, funds three personas, and writes `.env`.

```bash
node scripts/build-contracts.mjs                     # builds target/wasm/*.wasm
FUNDER=you.testnet node scripts/bootstrap.mjs        # sub-accounts of a funded testnet account (about 8 NEAR)
# or, without a funded account (the public faucet is rate limited):
node scripts/bootstrap.mjs
set -a; . ./.env; set +a
cargo run -p that-invoice-api --release
pnpm --dir apps/web build && pnpm --dir apps/web start
```

### Deploying to Fly.io

The repo ships a `Dockerfile` (Rust API plus Next.js in one image) and a `fly.toml` that scales to zero.

```bash
fly apps create <name> && fly volumes create that_invoice_data --size 1
fly secrets set NEAR_KEYS='{"<persona>.testnet":"ed25519:...", "<token-account>.testnet":"ed25519:..."}'
fly deploy
```

The container starts the API first and opens the public port only once the API answers `/healthz`, so a woken machine never serves a half-started app.

### Tests and checks

```bash
cargo test --workspace                 # 46 contract tests (state machine, locks, sale/claim races)
pnpm --dir apps/web typecheck
REGISTRY_ACCOUNT=endorse-v1.testnet node scripts/e2e.mjs   # full lifecycle on testnet, real transactions
```

### Environment variables

See [`.env.example`](.env.example). The important ones: `REGISTRY_ACCOUNT`, `USDC_ACCOUNT`, `PERSONA_*`, `NEAR_KEYS` (JSON of secret keys for production, instead of `~/.near-credentials`), `ALLOWED_ORIGIN`, `ONECLICK_JWT`.

---

## Security and reliability

Threat model for the paths that move money:

| Threat | Mitigation |
|---|---|
| Selling an invoice twice | `issue` refuses a repeated (issuer, debtor, number), case-insensitively. After a sale, listing fails the owner check. |
| Seller keeps the money after selling | The payee is read at `claim` time. The issuer fails the owner check. |
| Sale racing a payout | `Listed` and `Claiming` lock the token: no transfer, no re-list, no second claim, no purchase. Tested. |
| A stale `sync` result arriving late | `on_synced` only moves `Issued/Confirmed/Listed` to `Paid`, and ignores `Claiming/Claimed`. Tested. |
| Wrong token pays or buys | `ft_on_transfer` accepts only the registry's token; anything else is refunded in full. |
| Underpayment or overpayment on a buy | Underpayment is refunded; the excess is returned. |
| Seller cannot receive the proceeds | The push is attempted; on failure the amount is credited and can be pulled with `withdraw_proceeds`. |
| Failed account creation | The invoice and its number are removed and the deposit is refunded. |
| Anyone forging a payment | `sync` trusts the token contract's `ft_balance_of`, never a callback from a payer. |
| Griefing a client's record | Only confirmed and paid invoices count. |
| Abuse of the public demo API | Global rate limits (not per-IP), hourly caps on issue (20) and demo runs (12), input validation (amounts, ids, sizes), one tx at a time. |

Known risks, stated plainly:

- **The registry is upgradeable by its account key.** The invoice contract is immutable, but the registry account still has a full-access key. Before mainnet it would be locked or controlled by a DAO.
- **No audit.** The contracts have unit tests and a testnet end-to-end run, not an external review.
- **Funds paid after `Claimed` are stuck** in the invoice account (it cannot release again). The UI does not invite this, but a payer could do it.
- **Partial payments do not mark an invoice paid.** They sit at the address until the balance covers the face value.
- **Demo persona keys live on the server.** They control test funds only.

## Limitations and roadmap

- Wallet login (HOT / NEAR Connect) so real users sign for themselves.
- A mainnet deployment and one real cross-chain payment: Base USDC, through NEAR Intents' 1Click API, into an invoice account.
- DAO confirmation through a Sputnik DAO proposal (the contract already accepts any account as debtor, so a DAO can confirm by executing a `FunctionCall`).
- Sharded-NFT-item conformance (`nft_item_info`) for the draft House of Stake NEP, so wallets can verify an invoice account belongs to the collection.
- Partial sales and a real buyer market.

## Hackathon relevance

- **Track:** NFTs That Do Something. The invoice is an NFT that *is* an account, owns money, and carries the right to collect it. Selling the NFT moves the wallet, its balance and its access rights together.
- **NEAR features used:** NEP-171 and NEP-297 events, global contracts (NEP-591) by hash, programmatic account creation from a contract, cross-contract calls and callbacks, NEP-141 `ft_transfer_call`, NEAR Intents 1Click API (quotes).
- **Built in the window:** all code in this repository was written between the announcement and the deadline. No pre-existing code.

### Libraries and AI use

Open-source libraries only (`near-sdk`, `near-api`, Axum, Tokio, Next.js, React, `qrcode`). Fonts: Newsreader, Geist, Geist Mono (SIL OFL). The code was written with AI assistance (Kiro). The demo USDC uses the shared global NEP-141 contract `ft.globals.primitives.testnet`.

### Other project by the same builder

[**Bonded**](https://github.com/PhiBao/bonded) (performance bonds for AI agents) was also submitted to this hackathon by the same builder. It is independent of That Invoice: different problem, different contracts, different code.

## License

MIT. See [LICENSE](LICENSE).
