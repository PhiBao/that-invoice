// Shared helpers for the testnet scripts. Keys are read from ~/.near-credentials (never committed).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Account, JsonRpcProvider, KeyPairSigner } from "near-api-js";

export const NETWORK = process.env.NEAR_NETWORK ?? "testnet";
export const RPC = process.env.NEAR_RPC ?? (NETWORK === "mainnet" ? "https://free.rpc.fastnear.com" : "https://test.rpc.fastnear.com");
export const provider = new JsonRpcProvider({ url: RPC });
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
