// Create testnet accounts through the public faucet helper and store their keys in ~/.near-credentials.
// Usage: node scripts/new-account.mjs name.testnet [name2.testnet ...]
import { createFaucetAccount } from "./lib.mjs";
for (const id of process.argv.slice(2)) {
  try { console.log((await createFaucetAccount(id)) ? "created" : "exists ", id); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
