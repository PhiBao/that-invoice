// Stand up your own complete That Invoice deployment on NEAR testnet in about a minute.
//   node scripts/bootstrap.mjs            # random prefix
//   PREFIX=myteam node scripts/bootstrap.mjs
// With FUNDER=you.testnet (a funded account whose key is in ~/.near-credentials) the accounts are created
// as sub-accounts of it instead of through the rate-limited public faucet (about 12 NEAR needed).
// Creates 5 faucet accounts (registry, demo USDC, three personas), deploys the registry against the
// already-published invoice-account global contract, and writes ./.env for the API.
// Run `node scripts/build-contracts.mjs` first so target/wasm/registry.wasm exists.
import fs from "node:fs";
import crypto from "node:crypto";
import { account, balance, createFaucetAccount, createSubAccount, NEAR, TGAS, view, wasmPath, root } from "./lib.mjs";
import path from "node:path";

const dep = JSON.parse(fs.readFileSync(path.join(root, "deployment.json"), "utf8"));
const funder = process.env.FUNDER;
const prefix = process.env.PREFIX ?? `endorse-${crypto.randomBytes(2).toString("hex")}`;
const ids = Object.fromEntries(["reg", "usdc", "studio", "acme", "fund"].map((k) => [k, funder ? `${prefix}-${k}.${funder}` : `${prefix}-${k}.testnet`]));
const invoiceHash = process.env.INVOICE_HASH ?? dep.invoiceHash;
const log = (...a) => console.log("•", ...a);

log("creating accounts", Object.values(ids).join(", "));
for (const [k, id] of Object.entries(ids)) {
  if (funder) await createSubAccount(funder, id, NEAR(k === "reg" ? Number(process.env.REG_NEAR ?? 3.2) : k === "usdc" ? 0.5 : Number(process.env.PERSONA_NEAR ?? 1.5)));
  else await createFaucetAccount(id);
}

// demo USDC: the shared global NEP-141, 6 decimals
const usdc = account(ids.usdc);
await usdc.useGlobalContract({ accountId: dep.globalFt });
await usdc.callFunction({ contractId: ids.usdc, methodName: "new", gas: TGAS(30),
  args: { owner_id: ids.usdc, total_supply: "1000000000000000", metadata: { spec: "ft-1.0.0", name: "Demo USDC (That Invoice testnet)", symbol: "USDC", decimals: 6 } } });
log("demo USDC ready on", ids.usdc);

// registry
const wasm = fs.readFileSync(wasmPath("registry"));
const reg = account(ids.reg);
await reg.deployContract(wasm);
await reg.callFunction({ contractId: ids.reg, methodName: "new", args: { token: ids.usdc, invoice_code_hash: invoiceHash }, gas: TGAS(30) });
log("registry deployed on", ids.reg, "using invoice-account", invoiceHash);

// register everyone on the token and fund the personas
for (const id of [ids.reg, ids.studio, ids.acme, ids.fund]) {
  await account(id).callFunction({ contractId: ids.usdc, methodName: "storage_deposit", args: { account_id: id, registration_only: true }, deposit: NEAR(0.01), gas: TGAS(30) });
}
for (const [id, amount] of [[ids.acme, "10000000000"], [ids.fund, "10000000000"], [ids.studio, "1000000"]]) {
  await usdc.callFunction({ contractId: ids.usdc, methodName: "ft_transfer", args: { receiver_id: id, amount }, deposit: 1n, gas: TGAS(30) });
}
log("personas funded");

const env = [
  "NEAR_NETWORK=testnet",
  `REGISTRY_ACCOUNT=${ids.reg}`,
  `USDC_ACCOUNT=${ids.usdc}`,
  `PERSONA_STUDIO=${ids.studio}`,
  `PERSONA_ACME=${ids.acme}`,
  `PERSONA_FUND=${ids.fund}`,
  "PORT=8787",
  "DATA_DIR=data",
  "",
].join("\n");
fs.writeFileSync(path.join(root, ".env"), env);
log("wrote .env");
console.log("\nNext:\n  set -a; . ./.env; set +a\n  cargo run -p that-invoice-api --release     # terminal 1\n  pnpm --dir apps/web build && pnpm --dir apps/web start   # terminal 2\n  open http://localhost:3000/demo");
console.log("registry balance:", await balance(ids.reg), "NEAR; registry config:", JSON.stringify(await view(ids.reg, "config")));
