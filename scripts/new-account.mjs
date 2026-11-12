// Create a testnet account through the public faucet helper and store its key in ~/.near-credentials.
// Usage: node scripts/new-account.mjs name.testnet [name2.testnet ...]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { KeyPair } from "near-api-js";

for (const id of process.argv.slice(2)) {
  const kp = KeyPair.fromRandom("ed25519");
  const res = await fetch("https://helper.nearprotocol.com/account", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }),
  });
  if (!res.ok) { console.error(id, res.status, await res.text()); process.exitCode = 1; continue; }
  const dir = path.join(os.homedir(), ".near-credentials", "testnet");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ account_id: id, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }), { mode: 0o600 });
  console.log("created", id);
}
