// Verify the trust claims of a deployment from public chain data. No keys needed.
//   node scripts/verify-deployment.mjs            (uses deployment.json)
//   REGISTRY_ACCOUNT=... node scripts/verify-deployment.mjs
import fs from "node:fs";
import path from "node:path";
import { provider, root, view, b58, sha256, wasmPath } from "./lib.mjs";

const dep = JSON.parse(fs.readFileSync(path.join(root, "deployment.json"), "utf8"));
const REG = process.env.REGISTRY_ACCOUNT ?? dep.registry;
let bad = 0;
const check = (ok, label, detail = "") => { console.log(ok ? "✓" : "✗", label, detail); if (!ok) bad++; };

const acct = await provider.viewAccount({ accountId: REG });
const keys = await provider.viewAccessKeyList({ accountId: REG });
const list = keys.keys ?? keys;
check(list.length === 0, "registry account has no access keys (nobody can redeploy or upgrade it)", `keys: ${list.length}`);

const cfg = await view(REG, "config");
check(cfg.invoice_code_hash === dep.invoiceHash, "registry points at the published invoice contract", cfg.invoice_code_hash);

// The invoice contract is a global contract by hash: immutable by construction. Check a real invoice account uses it.
const invs = await view(REG, "invoices", { from_index: "0", limit: 1 });
if (invs[0]) {
  const inv = await provider.viewAccount({ accountId: invs[0].id });
  check(!!inv.global_contract_hash || inv.code_hash === "11111111111111111111111111111111", `${invs[0].id} runs a global contract`, JSON.stringify({ global_contract_hash: inv.global_contract_hash, global_contract_account_id: inv.global_contract_account_id }));
  const keysI = await provider.viewAccessKeyList({ accountId: invs[0].id });
  check((keysI.keys ?? keysI).length === 0, "invoice accounts have no access keys", `keys: ${(keysI.keys ?? keysI).length}`);
}

console.log("\nregistry code hash on chain:", acct.code_hash);
const local = wasmPath("registry");
if (fs.existsSync(local)) {
  const h = b58(sha256(fs.readFileSync(local)));
  console.log("registry wasm built here:  ", h, h === acct.code_hash ? "(matches)" : "(differs: rebuild from the tagged commit with the same toolchain)");
}
process.exit(bad ? 1 : 0);
