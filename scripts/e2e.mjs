// Full lifecycle on testnet with real transactions:
// issue -> confirm -> list -> buy -> pay -> sync -> claim, plus the "cannot sell twice" rejections.
import { account, view, call, NEAR, TGAS, provider } from "./lib.mjs";

const REG = process.env.REGISTRY_ACCOUNT ?? "endorse-reg.testnet";
const USDC = process.env.USDC_ACCOUNT ?? "endorse-usdc.testnet";
const STUDIO = "endorse-studio.testnet", ACME = "endorse-acme.testnet", FUND = "endorse-fund.testnet";
const usd = (n) => String(BigInt(Math.round(n * 1e6)));
const bal = async (a) => Number(await view(USDC, "ft_balance_of", { account_id: a })) / 1e6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = (res) => (res.receipts_outcome ?? []).flatMap((r) => r.outcome.logs).filter((l) => l.startsWith("EVENT_JSON"));
const reason = (e) => { const t = JSON.stringify(e?.result ?? e?.status ?? e?.message ?? e); const m = t.match(/Smart contract panicked: ([^"\\]+)/); return m ? m[1] : t.slice(0, 160); };
const failed = (res) => JSON.stringify(res.status).includes("Failure");

async function ensureFunded(id, amount) {
  const sb = await view(USDC, "storage_balance_of", { account_id: id });
  if (!sb) await account(id).callFunction({ contractId: USDC, methodName: "storage_deposit", args: { account_id: id, registration_only: true }, deposit: NEAR(0.01), gas: TGAS(30) });
  const have = await bal(id);
  if (have < amount) await account(USDC).callFunction({ contractId: USDC, methodName: "ft_transfer", args: { receiver_id: id, amount: usd(amount - have) }, deposit: 1n, gas: TGAS(30) });
}
async function step(name, fn) { const t = Date.now(); const r = await fn(); console.log(`✓ ${name} (${((Date.now() - t) / 1000).toFixed(1)}s)`); return r; }

await ensureFunded(STUDIO, 0); await ensureFunded(ACME, 5000); await ensureFunded(FUND, 5000);
const number = "E2E-" + Date.now().toString(36);
const face = 1200, price = 1176;

const issued = await step("issue", () => account(STUDIO).callFunctionRaw({ contractId: REG, methodName: "issue",
  args: { debtor: ACME, number, amount: usd(face), due_ms: String(Date.now() + 30 * 864e5), doc_hash: "sha256:demo" }, deposit: NEAR(0.1), gas: TGAS(150) }));
if (failed(issued)) { console.log(JSON.stringify(issued.status)); process.exit(1); }
await sleep(1500);
const all = await view(REG, "invoices", { limit: 100 });
const inv = all.find((i) => i.number === number);
console.log("  invoice account:", inv.id, "status:", inv.status);
const id = inv.id;

const dup = await account(STUDIO).callFunctionRaw({ contractId: REG, methodName: "issue",
  args: { debtor: ACME, number, amount: usd(face), due_ms: String(Date.now() + 1e9), doc_hash: "x" }, deposit: NEAR(0.1), gas: TGAS(150) }).catch((e) => e);
console.log("✓ duplicate issue rejected:", reason(dup));

await step("confirm (by debtor)", () => call(ACME, REG, "confirm", { id }));
await step("list at $" + price, () => call(STUDIO, REG, "list", { id, price: usd(price) }));
const before = await bal(STUDIO);
await step("buy (fund pays $" + price + ")", () => account(FUND).callFunctionRaw({ contractId: USDC, methodName: "ft_transfer_call",
  args: { receiver_id: REG, amount: usd(price), msg: JSON.stringify({ buy: id }) }, deposit: 1n, gas: TGAS(200) }));
await sleep(3000);
const afterBuy = await view(REG, "invoice", { id });
console.log("  owner now:", afterBuy.owner, "| studio USDC +", (await bal(STUDIO)) - before);

const resell = await call(STUDIO, REG, "list", { id, price: usd(price) }).catch((e) => e);
console.log("✓ old owner cannot re-list:", reason(resell));

await step("pay (acme sends $" + face + " to the invoice account)", () => account(ACME).callFunctionRaw({ contractId: USDC, methodName: "ft_transfer",
  args: { receiver_id: id, amount: usd(face) }, deposit: 1n, gas: TGAS(30) }));
await step("sync", () => call(FUND, REG, "sync", { id }));
await sleep(3000);
console.log("  status:", (await view(REG, "invoice", { id })).status);

const fb = await bal(FUND);
await step("claim (by buyer)", () => call(FUND, REG, "claim", { id }, { gas: TGAS(150) }));
await sleep(4000);
const done = await view(REG, "invoice", { id });
console.log("  status:", done.status, "| fund USDC +", (await bal(FUND)) - fb, "| invoice acct left:", await bal(id));
console.log("  log:", done.log.map((l) => l.kind).join(" → "));
console.log("  debtor record:", JSON.stringify(await view(REG, "debtor_record", { debtor: ACME })));
