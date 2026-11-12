// Shared helpers for the testnet scripts. Keys are read from ~/.near-credentials (never committed).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPairSigner, KeyPair } from "near-api-js";

export const NETWORK = process.env.NEAR_NETWORK ?? "testnet";
export const RPC = process.env.NEAR_RPC ?? (NETWORK === "mainnet" ? "https://free.rpc.fastnear.com" : "https://test.rpc.fastnear.com");
// Public RPCs rate-limit; try several in order. NEAR_RPC overrides the primary.
const FALLBACKS = NETWORK === "mainnet"
  ? ["https://rpc.mainnet.near.org"]
  : ["https://near-testnet.drpc.org", "https://archival-rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"];
export const provider = new FailoverRpcProvider([RPC, ...FALLBACKS].map((url) => new JsonRpcProvider({ url })));
export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58(buf) {
  let n = BigInt("0x" + Buffer.from(buf).toString("hex"));
  let s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = "1" + s; else break; }
  return s;
}
export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest();

export function creds(accountId) {
  const dir = process.env.NEAR_CREDENTIALS_DIR ?? path.join(os.homedir(), ".near-credentials");
  const file = path.join(dir, NETWORK, `${accountId}.json`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
export function account(accountId) {
  const { private_key } = creds(accountId);
  return new Account(accountId, provider, KeyPairSigner.fromSecretKey(private_key));
}
export const NEAR = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 18n;
export const TGAS = (n) => BigInt(n) * 10n ** 12n;

export async function balance(accountId) {
  try {
    const s = await provider.viewAccount({ accountId });
    return Number(BigInt(s.amount) / 10n ** 21n) / 1000;
  } catch { return null; }
}
export async function view(contractId, methodName, args = {}) {
  return provider.callFunction({ contractId, method: methodName, args });
}
export async function call(signer, contractId, methodName, args = {}, { deposit = 0n, gas = TGAS(100) } = {}) {
  const res = await account(signer).callFunctionRaw({ contractId, methodName, args, deposit, gas });
  return res;
}
export const wasmPath = (name) => path.join(root, "target", "wasm", `${name}.wasm`);

/** Create a testnet account through the public faucet helper; stores its key in ~/.near-credentials. */
export async function createFaucetAccount(id) {
  if ((await balance(id)) !== null) return false;
  const kp = KeyPair.fromRandom("ed25519");
  const res = await fetch("https://helper.nearprotocol.com/account", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }),
  });
  if (!res.ok) throw new Error(`faucet refused ${id}: ${res.status} ${await res.text()}`);
  const dir = path.join(os.homedir(), ".near-credentials", NETWORK);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ account_id: id, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }), { mode: 0o600 });
  return true;
}

/** Create `id` as a sub-account of `funder` (a funded testnet account whose key is in ~/.near-credentials). */
export async function createSubAccount(funder, id, nearToTransfer) {
  if ((await balance(id)) !== null) return false;
  const kp = KeyPair.fromRandom("ed25519");
  await account(funder).createSubAccount({ accountOrPrefix: id, publicKey: kp.getPublicKey().toString(), nearToTransfer });
  const dir = path.join(os.homedir(), ".near-credentials", NETWORK);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ account_id: id, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }), { mode: 0o600 });
  return true;
}

// ───────── Sputnik DAO helpers (used by seed + setup scripts) ─────────
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64");

/** Create a DAO with a single council account and the default policy (anyone may propose, council approves). */
export async function createDao({ factory, name, creator, council, purpose, deposit }) {
  const args = { config: { name, purpose, metadata: "" }, policy: [council] };
  return account(creator).callFunctionRaw({
    contractId: factory, methodName: "create", gas: TGAS(300), deposit: deposit ?? NEAR(6.2),
    args: { name, args: b64(args) },
  });
}

/** Proposer asks the DAO to call `method` on `receiver`; returns the proposal id. */
export async function daoPropose({ dao, proposer, receiver, method, args, deposit = "0", description, gasTgas = 60 }) {
  await account(proposer).callFunction({
    contractId: dao, methodName: "add_proposal", gas: TGAS(30), deposit: NEAR(1),
    args: { proposal: { description, kind: { FunctionCall: { receiver_id: receiver, actions: [{ method_name: method, args: b64(args), deposit, gas: String(TGAS(gasTgas)) }] } } } },
  });
  return Number(await view(dao, "get_last_proposal_id")) - 1;
}

/** A council member approves; if the vote passes, the DAO executes the call in the same transaction tree. */
export async function daoApprove({ dao, council, id }) {
  return account(council).callFunctionRaw({ contractId: dao, methodName: "act_proposal", gas: TGAS(250), args: { id, action: "VoteApprove" } });
}
