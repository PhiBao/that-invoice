// Idempotent testnet deployment: global invoice-account, registry, demo USDC.
// Usage: node scripts/deploy-testnet.mjs
import fs from "node:fs";
import { account, balance, b58, sha256, wasmPath, view, NEAR, TGAS, provider } from "./lib.mjs";

const PUB = process.env.PUB_ACCOUNT ?? "endorse-pub.testnet";
const REG = process.env.REGISTRY_ACCOUNT ?? "endorse-reg.testnet";
const USDC = process.env.USDC_ACCOUNT ?? "endorse-usdc.testnet";
const GLOBAL_FT = "ft.globals.primitives.testnet";

const invoiceWasm = fs.readFileSync(wasmPath("invoice_account"));
const registryWasm = fs.readFileSync(wasmPath("registry"));
const invoiceHash = b58(sha256(invoiceWasm));
const log = (...a) => console.log("•", ...a);

async function exists(id) { return (await balance(id)) !== null; }
async function globalPublished(hash) {
  // A published global contract can be referenced by hash; probe by looking for it via an account that uses it.
  return fs.existsSync(wasmPath("invoice_account") + ".published") &&
    fs.readFileSync(wasmPath("invoice_account") + ".published", "utf8").trim() === hash;
}

// 1. publish invoice-account as an immutable global contract (by code hash)
if (!(await globalPublished(invoiceHash))) {
  log(`publishing invoice-account ${invoiceHash} (${invoiceWasm.length} bytes) from ${PUB}`);
  const res = await account(PUB).deployGlobalContract(invoiceWasm, "codeHash");
  log("published, tx", res.transaction.hash);
  fs.writeFileSync(wasmPath("invoice_account") + ".published", invoiceHash);
} else log("invoice-account already published", invoiceHash);

// 2. demo USDC: the shared global NEP-141, 6 decimals, 1B supply to the token account
const usdc = account(USDC);
let usdcReady = false;
try { await view(USDC, "ft_metadata"); usdcReady = true; } catch {}
if (!usdcReady) {
  log("setting up demo USDC on", USDC);
  await usdc.useGlobalContract({ accountId: GLOBAL_FT });
  await usdc.callFunction({
    contractId: USDC, methodName: "new", gas: TGAS(30),
    args: { owner_id: USDC, total_supply: "1000000000000000", metadata: {
      spec: "ft-1.0.0", name: "Demo USDC (That Invoice testnet)", symbol: "USDC", decimals: 6 } },
  });
}
log("USDC metadata", JSON.stringify(await view(USDC, "ft_metadata")));

// 3. registry
let regReady = false;
try { await view(REG, "config"); regReady = true; } catch {}
if (!regReady) {
  log("deploying registry to", REG);
  await account(REG).deployContract(registryWasm);
  await account(REG).callFunction({ contractId: REG, methodName: "new", args: { token: USDC, invoice_code_hash: invoiceHash }, gas: TGAS(30) });
}
log("registry config", JSON.stringify(await view(REG, "config")));

// 4. the registry must be registered on the token to receive sales
const sb = await view(USDC, "storage_balance_of", { account_id: REG });
if (!sb) {
  await account(REG).callFunction({ contractId: USDC, methodName: "storage_deposit", args: { account_id: REG, registration_only: true }, deposit: NEAR(0.01), gas: TGAS(30) });
  log("registered registry on USDC");
}
console.log(JSON.stringify({ registry: REG, usdc: USDC, invoiceHash }, null, 2));
