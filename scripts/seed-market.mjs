// Seed a believable market on testnet so the Buyer desk and ledger are never empty.
// Idempotent: invoices are matched by (issuer, number) and skipped if they exist.
//   node scripts/seed-market.mjs
import { account, balance, createSubAccount, NEAR, TGAS, view, daoPropose, daoApprove } from "./lib.mjs";

const REG = process.env.REGISTRY_ACCOUNT ?? "endorse-v1.testnet";
const USDC = process.env.USDC_ACCOUNT ?? "endorse-usdc.testnet";
const DAO = process.env.ACME_DAO ?? "thatinvoice-acme.sputnikv2.testnet";
const PROPOSER = "endorse-acme.testnet";
const COUNCIL = "council.endorse-fund.testnet";
const PARENT = "endorse-studio.testnet";

const STUDIO = "endorse-studio.testnet";
const KESTREL = "kestrel.endorse-studio.testnet";   // a small security-audit shop
const LOOM = "loomlabs.endorse-studio.testnet";     // a protocol dev studio
const NORTHWIND = "northwind.endorse-studio.testnet"; // an individual client with its own key

const usd = (n) => String(Math.round(n * 1e6));
const DAY = 86_400_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);

async function invoices() {
  const all = [];
  for (let from = 0; ; from += 100) {
    const page = await view(REG, "invoices", { from_index: String(from), limit: 100 });
    all.push(...page);
    if (page.length < 100) break;
  }
  return all;
}
const find = async (issuer, number) => (await invoices()).find((i) => i.issuer === issuer && i.number === number);

async function ensureAccount(id, near) {
  if (await createSubAccount(PARENT, id, NEAR(near))) log("created", id);
  const sb = await view(USDC, "storage_balance_of", { account_id: id });
  if (!sb) await account(id).callFunction({ contractId: USDC, methodName: "storage_deposit", args: { account_id: id, registration_only: true }, deposit: NEAR(0.01), gas: TGAS(30) });
}

async function issue({ issuer, debtor, number, amount, dueDays }) {
  const have = await find(issuer, number);
  if (have) return have;
  await account(issuer).callFunction({ contractId: REG, methodName: "issue", deposit: NEAR(0.1), gas: TGAS(150),
    args: { debtor, number, amount: usd(amount), due_ms: String(Date.now() + dueDays * DAY), doc_hash: "" } });
  for (let i = 0; i < 10; i++) { await sleep(900); const f = await find(issuer, number); if (f && f.status !== "Creating") { log("issued", number, "→", f.id); return f; } }
  throw new Error("invoice did not appear: " + number);
}

async function confirm(inv) {
  if (inv.status !== "Issued") return;
  if (inv.debtor === DAO) {
    const pid = await daoPropose({ dao: DAO, proposer: PROPOSER, receiver: REG, method: "confirm", args: { id: inv.id },
      description: `Confirm invoice ${inv.number} from ${inv.issuer} for $${Number(inv.amount) / 1e6}` });
    await daoApprove({ dao: DAO, council: COUNCIL, id: pid });
  } else {
    await account(inv.debtor).callFunction({ contractId: REG, methodName: "confirm", args: { id: inv.id }, gas: TGAS(30) });
  }
  await sleep(2500);
  log("confirmed", inv.number, "by", inv.debtor);
}

async function list(inv, price) {
  const cur = await view(REG, "invoice", { id: inv.id });
  if (cur.status !== "Confirmed") return;
  await account(inv.issuer).callFunction({ contractId: REG, methodName: "list", args: { id: inv.id, price: usd(price) }, gas: TGAS(30) });
  log("listed", inv.number, "at $" + price);
}

// ── accounts
await ensureAccount(KESTREL, 1.0);
await ensureAccount(LOOM, 1.0);
await ensureAccount(NORTHWIND, 1.0);
// Northwind pays one invoice from its own USDC
const nb = Number(await view(USDC, "ft_balance_of", { account_id: NORTHWIND })) / 1e6;
if (nb < 1000) await account(USDC).callFunction({ contractId: USDC, methodName: "ft_transfer", args: { receiver_id: NORTHWIND, amount: usd(1500) }, deposit: 1n, gas: TGAS(30) });

// ── the portfolio
const A = await issue({ issuer: KESTREL, debtor: DAO, number: "KA-2611-014", amount: 8400, dueDays: 45 });
await confirm(A); await list(A, 8190);

const B = await issue({ issuer: LOOM, debtor: DAO, number: "LL-0087", amount: 2750, dueDays: 14 });
await confirm(B); await list(B, 2712);

const C = await issue({ issuer: STUDIO, debtor: NORTHWIND, number: "SN-0311", amount: 5000, dueDays: 60 });
await confirm(C); await list(C, 4825);

// Past due and discounted deeper: a distressed receivable
const D = await issue({ issuer: KESTREL, debtor: NORTHWIND, number: "KA-2610-009", amount: 3100, dueDays: -6 });
await confirm(D); await list(D, 2790);

// Issued but not yet confirmed by the client
await issue({ issuer: LOOM, debtor: DAO, number: "LL-0091", amount: 960, dueDays: 30 });

// A client with a history: Northwind confirms, pays on time, and the issuer collects
const E = await issue({ issuer: STUDIO, debtor: NORTHWIND, number: "SN-0298", amount: 400, dueDays: 20 });
await confirm(E);
let cur = await view(REG, "invoice", { id: E.id });
if (cur.status === "Confirmed") {
  await account(NORTHWIND).callFunction({ contractId: USDC, methodName: "ft_transfer", args: { receiver_id: E.id, amount: usd(400) }, deposit: 1n, gas: TGAS(30) });
  await account(STUDIO).callFunction({ contractId: REG, methodName: "sync", args: { id: E.id }, gas: TGAS(50) });
  await sleep(3500);
  cur = await view(REG, "invoice", { id: E.id });
}
if (cur.status === "Paid") {
  await account(STUDIO).callFunction({ contractId: REG, methodName: "claim", args: { id: E.id }, gas: TGAS(150) });
  log("SN-0298 paid on time and collected");
}

const all = await invoices();
console.log("\nledger now:", all.length, "invoices;", all.filter((i) => i.status === "Listed").length, "for sale");
console.log("Northwind record:", JSON.stringify(await view(REG, "debtor_record", { debtor: NORTHWIND })));
console.log("Acme DAO record:", JSON.stringify(await view(REG, "debtor_record", { debtor: DAO })));
console.log("studio NEAR:", await balance(STUDIO));
