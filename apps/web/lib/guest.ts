"use client";

/**
 * Guest accounts. The browser generates an ed25519 key and keeps it in localStorage. The matching *implicit*
 * NEAR account (the 64-hex form of the public key) is the visitor's identity: the server only sends it a little
 * gas money and demo USDC, and every transaction afterwards is signed here, in the browser.
 * The key controls testnet funds that are worth nothing.
 */

import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";

const STORAGE = "thatinvoice.guest.v1";

export interface GuestIdentity {
  account: string;
  publicKey: string;
  secretKey: string;
}

export function loadGuest(): GuestIdentity | null {
  try {
    const raw = localStorage.getItem(STORAGE);
    return raw ? (JSON.parse(raw) as GuestIdentity) : null;
  } catch {
    return null;
  }
}

export function createGuest(): GuestIdentity {
  const kp = KeyPair.fromRandom("ed25519");
  const pk = kp.getPublicKey();
  const g = {
    account: Array.from(pk.data as Uint8Array).map((b) => b.toString(16).padStart(2, "0")).join(""),
    publicKey: pk.toString(),
    secretKey: kp.toString(),
  };
  localStorage.setItem(STORAGE, JSON.stringify(g));
  return g;
}

export function forgetGuest() {
  localStorage.removeItem(STORAGE);
}

/** Ask the server to fund the guest's account (gas money and demo USDC). Safe to call again. */
export async function fundGuest(g: GuestIdentity): Promise<{ usdc: string; funded: boolean }> {
  // Funding takes several seconds, long enough for a flaky connection to drop the request. The endpoint is
  // idempotent (an already-funded account costs nothing), so retrying is safe.
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch("/api/guest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ public_key: g.publicKey }),
      });
      const b = await r.json();
      if (!r.ok) throw Object.assign(new Error(b.error ?? `HTTP ${r.status}`), { final: true });
      return b;
    } catch (e) {
      if ((e as { final?: boolean }).final) throw e; // a real answer from the server: do not retry
      lastError = e;
      await new Promise((res) => setTimeout(res, 1500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("could not reach the server");
}

function providerFor(rpc: string[]) {
  const providers = rpc.map((url) => new JsonRpcProvider({ url }));
  return providers.length > 1 ? new FailoverRpcProvider(providers) : providers[0];
}

export interface GuestCall {
  contractId: string;
  methodName: string;
  args: Record<string, unknown>;
  /** yoctoNEAR */
  deposit?: bigint;
  /** gas units */
  gas?: bigint;
}

export interface GuestResult {
  ok: boolean;
  hash: string;
  explorerUrl: string;
  error: string | null;
}

const TGAS = (n: number) => BigInt(n) * 10n ** 12n;
export const gas = TGAS;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const EXECUTED = new Set(["EXECUTED_OPTIMISTIC", "EXECUTED", "FINAL"]);

type Outcome = { transaction?: { hash?: string }; receipts_outcome?: { outcome: { status: unknown } }[]; status?: unknown; final_execution_status?: string };

function failureIn(res: Outcome): unknown | undefined {
  const all = [res.status, ...(res.receipts_outcome?.map((r) => r.outcome.status) ?? [])];
  return all.find((s) => typeof s === "object" && s !== null && "Failure" in (s as object));
}

/**
 * Sign a function call with the guest's own key and send it.
 *
 * Public RPC nodes give up waiting for execution after ~10s and answer 408; a client that then re-sends the same
 * signed transaction is rejected. So we only ask the node to include the transaction, then poll its status.
 */
export async function guestCall(g: GuestIdentity, rpc: string[], explorer: string, call: GuestCall): Promise<GuestResult> {
  const account = new Account(g.account, providerFor(rpc), KeyPairSigner.fromSecretKey(g.secretKey as `ed25519:${string}`));
  const fail = (hash: string, error: string): GuestResult => ({ ok: false, hash, explorerUrl: hash ? `${explorer}/txns/${hash}` : "", error });
  let hash = "";
  try {
    const sent = (await account.callFunctionRaw({
      contractId: call.contractId,
      methodName: call.methodName,
      args: call.args,
      deposit: call.deposit ?? 0n,
      gas: call.gas ?? TGAS(100),
      waitUntil: "INCLUDED",
    })) as Outcome;
    hash = (sent.transaction?.hash as string) ?? "";
    if (!hash) return fail("", "the network did not return a transaction hash");

    let res: Outcome = sent;
    for (let i = 0; i < 60; i++) {
      if (res.final_execution_status && EXECUTED.has(res.final_execution_status)) break;
      await sleep(1200);
      try {
        res = (await account.provider.viewTransactionStatusWithReceipts({
          txHash: hash,
          accountId: g.account,
          waitUntil: "EXECUTED_OPTIMISTIC",
        })) as Outcome;
      } catch {
        /* the node may not know the tx yet, or timed out waiting: keep polling */
      }
    }
    if (!(res.final_execution_status && EXECUTED.has(res.final_execution_status))) {
      return fail(hash, "the transaction was sent but has not finished yet; check the explorer link");
    }
    const failure = failureIn(res);
    if (failure) return fail(hash, readableFailure(failure));
    return { ok: true, hash, explorerUrl: `${explorer}/txns/${hash}`, error: null };
  } catch (e) {
    const tx = (e as { transactionResult?: Outcome }).transactionResult;
    const failure = tx ? failureIn(tx) : undefined;
    return fail(tx?.transaction?.hash ?? hash, failure ? readableFailure(failure) : e instanceof Error ? e.message.slice(0, 200) : "transaction failed");
  }
}

function readableFailure(f: unknown): string {
  const s = JSON.stringify(f);
  const m = s.match(/(?:Smart contract panicked|Contract panicked): ([^"\\]+)/);
  return m ? m[1] : s.slice(0, 160);
}
