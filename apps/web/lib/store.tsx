"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { LedgerState, Persona, TxOutcome } from "./types";
import { createGuest, forgetGuest, fundGuest, gas, guestCall, loadGuest, type GuestIdentity } from "./guest";
import { toMicro } from "./format";

export interface Toast {
  id: number;
  tone: "ok" | "error";
  title: string;
  detail?: string;
  href?: string;
}

interface Ctx {
  state: LedgerState | null;
  error: string | null;
  persona: Persona | null;
  setPersonaKey: (k: Persona["key"]) => void;
  act: (action: string, params?: Record<string, unknown>, label?: string) => Promise<TxOutcome | null>;
  /** Ask the server to act as a named demo persona regardless of who the visitor is acting as. */
  actAs: (persona: "studio" | "acme" | "fund", action: string, params?: Record<string, unknown>, label?: string) => Promise<TxOutcome | null>;
  guest: GuestIdentity | null;
  guestBusy: boolean;
  enableGuest: () => Promise<void>;
  dropGuest: () => void;
  busy: string | null;
  waking: boolean;
  toasts: Toast[];
  dismiss: (id: number) => void;
  refresh: () => Promise<void>;
}

const LedgerCtx = createContext<Ctx | null>(null);

export function useLedger(): Ctx {
  const c = useContext(LedgerCtx);
  if (!c) throw new Error("useLedger outside provider");
  return c;
}

export function LedgerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LedgerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [personaKey, setKey] = useState<Persona["key"]>("studio");
  const [guest, setGuest] = useState<GuestIdentity | null>(null);
  const [guestUsdc, setGuestUsdc] = useState("0");
  const [guestBusy, setGuestBusy] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const saved = localStorage.getItem("thatinvoice.persona") as Persona["key"] | null;
    const g = loadGuest();
    if (g) setGuest(g);
    if (saved === "studio" || saved === "acme" || saved === "fund") setKey(saved);
    if (saved === "guest" && g) setKey("guest");
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (!r.ok) throw new Error(`state ${r.status}`);
      setState(await r.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unreachable");
    }
  }, []);

  useEffect(() => {
    refresh();
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const connect = () => {
      es = new EventSource("/api/events");
      es.addEventListener("update", () => refresh());
      es.onerror = () => {
        es?.close();
        if (!closed) timer = setTimeout(connect, 3000);
      };
    };
    connect();
    const poll = setInterval(refresh, 15000);
    return () => {
      closed = true;
      es?.close();
      clearTimeout(timer);
      clearInterval(poll);
    };
  }, [refresh]);

  // Cold start: Fly may have stopped the machine. Retry quickly until the first state arrives.
  const waking = !state && !!error;
  useEffect(() => {
    if (!waking) return;
    const t = setTimeout(refresh, 2000);
    return () => clearTimeout(t);
  }, [waking, error, refresh]);

  const refreshGuestBalance = useCallback(async (g: GuestIdentity | null) => {
    if (!g) return;
    try {
      const r = await fetch(`/api/balance/${g.account}`, { cache: "no-store" });
      if (r.ok) setGuestUsdc((await r.json()).usdc);
    } catch {}
  }, []);
  useEffect(() => { refreshGuestBalance(guest); }, [guest, state, refreshGuestBalance]);

  const persona = useMemo<Persona | null>(() => {
    if (personaKey === "guest" && guest) {
      return {
        key: "guest",
        account: guest.account,
        name: "You",
        role: "Guest account",
        blurb: "A real NEAR account whose key lives in this browser.",
        usdc: guestUsdc,
        can_sign: true,
      };
    }
    return state?.personas.find((p) => p.key === personaKey) ?? state?.personas[0] ?? null;
  }, [state, personaKey, guest, guestUsdc]);

  const setPersonaKey = useCallback((k: Persona["key"]) => {
    setKey(k);
    localStorage.setItem("thatinvoice.persona", k);
  }, []);

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = ++seq.current;
    setToasts((x) => [...x.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 9000);
  }, []);

  const dismiss = useCallback((id: number) => setToasts((x) => x.filter((y) => y.id !== id)), []);

  const runServer = useCallback(
    async (personaKey: string, action: string, params: Record<string, unknown>, label?: string) => {
      setBusy(action);
      try {
        const r = await fetch("/api/act", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ persona: personaKey, action, params }),
        });
        const body = await r.json();
        if (!r.ok) {
          push({ tone: "error", title: label ?? action, detail: body.error ?? `HTTP ${r.status}` });
          return null;
        }
        const out = body as TxOutcome;
        if (out.ok) push({ tone: "ok", title: label ?? action, detail: "Confirmed on NEAR testnet", href: out.explorer_url });
        else push({ tone: "error", title: `${label ?? action} was refused`, detail: out.error ?? "The contract rejected it", href: out.explorer_url });
        await refresh();
        return out;
      } catch (e) {
        push({ tone: "error", title: label ?? action, detail: e instanceof Error ? e.message : "request failed" });
        return null;
      } finally {
        setBusy(null);
      }
    },
    [push, refresh],
  );

  /** Sign with the visitor's own key, in the browser. */
  const runGuest = useCallback(
    async (action: string, params: Record<string, unknown>, label?: string): Promise<TxOutcome | null> => {
      if (!guest || !state) return null;
      const reg = state.registry;
      const token = state.token;
      const inv = (id: unknown) => state.invoices.find((i) => i.id === id);
      let call: Parameters<typeof guestCall>[3] | null = null;
      switch (action) {
        case "buy": {
          const i = inv(params.id);
          if (!i?.price) { push({ tone: "error", title: label ?? action, detail: "That invoice is not for sale." }); return null; }
          call = { contractId: token, methodName: "ft_transfer_call", deposit: 1n, gas: gas(90),
            args: { receiver_id: reg, amount: i.price, msg: JSON.stringify({ buy: i.id }) } };
          break;
        }
        case "pay": {
          const i = inv(params.id);
          if (!i) return null;
          call = { contractId: token, methodName: "ft_transfer", deposit: 1n, gas: gas(30), args: { receiver_id: i.id, amount: i.amount } };
          break;
        }
        case "list": call = { contractId: reg, methodName: "list", gas: gas(30), args: { id: params.id, price: toMicro(String(params.price)) } }; break;
        case "delist": call = { contractId: reg, methodName: "delist", gas: gas(30), args: { id: params.id } }; break;
        case "confirm": call = { contractId: reg, methodName: "confirm", gas: gas(30), args: { id: params.id } }; break;
        case "sync": call = { contractId: reg, methodName: "sync", gas: gas(40), args: { id: params.id } }; break;
        case "claim": call = { contractId: reg, methodName: "claim", gas: gas(80), args: { id: params.id } }; break;
        case "withdraw": call = { contractId: reg, methodName: "withdraw_proceeds", gas: gas(60), args: {} }; break;
        case "issue": {
          const debtor = state.personas.find((p) => p.key === params.debtor)?.account ?? String(params.debtor);
          call = { contractId: reg, methodName: "issue", deposit: 100_000_000_000_000_000_000_000n, gas: gas(100),
            args: { debtor, number: params.number, amount: toMicro(String(params.amount)),
              due_ms: String(params.due_ms ?? Date.now() + Number(params.due_days ?? 30) * 86_400_000), doc_hash: params.doc_hash ?? "" } };
          break;
        }
        default:
          push({ tone: "error", title: label ?? action, detail: "Unknown action" });
          return null;
      }
      setBusy(action);
      try {
        const res = await guestCall(guest, state.rpc ?? [], state.explorer, call);
        const out: TxOutcome = { ok: res.ok, hash: res.hash, explorer_url: res.explorerUrl, error: res.error, events: [], gas_tgas: 0 };
        if (res.ok) push({ tone: "ok", title: label ?? action, detail: "Signed by your account and confirmed on NEAR testnet", href: res.explorerUrl });
        else push({ tone: "error", title: `${label ?? action} was refused`, detail: res.error ?? "The contract rejected it", href: res.explorerUrl || undefined });
        // give the chain a moment, then refresh both the ledger and the guest's balance
        await new Promise((r) => setTimeout(r, 1500));
        await refresh();
        await refreshGuestBalance(guest);
        return out;
      } finally {
        setBusy(null);
      }
    },
    [guest, state, push, refresh, refreshGuestBalance],
  );

  const act = useCallback(
    async (action: string, params: Record<string, unknown> = {}, label?: string) => {
      if (personaKey === "guest") return runGuest(action, params, label);
      return runServer(personaKey, action, params, label);
    },
    [personaKey, runGuest, runServer],
  );
  const actAs = useCallback(
    async (p: "studio" | "acme" | "fund", action: string, params: Record<string, unknown> = {}, label?: string) =>
      runServer(p, action, params, label),
    [runServer],
  );

  const enableGuest = useCallback(async () => {
    setGuestBusy(true);
    try {
      const g = loadGuest() ?? createGuest();
      setGuest(g);
      await fundGuest(g);
      setKey("guest");
      localStorage.setItem("thatinvoice.persona", "guest");
      await refreshGuestBalance(g);
    } catch (e) {
      push({ tone: "error", title: "Could not create a guest account", detail: e instanceof Error ? e.message : "request failed" });
    } finally {
      setGuestBusy(false);
    }
  }, [push, refreshGuestBalance]);

  const dropGuest = useCallback(() => {
    forgetGuest();
    setGuest(null);
    setGuestUsdc("0");
    setKey("studio");
    localStorage.setItem("thatinvoice.persona", "studio");
  }, []);

  const value = useMemo(
    () => ({ state, error, persona, setPersonaKey, act, actAs, guest, guestBusy, enableGuest, dropGuest, busy, waking, toasts, dismiss, refresh }),
    [state, error, persona, setPersonaKey, act, actAs, guest, guestBusy, enableGuest, dropGuest, busy, waking, toasts, dismiss, refresh],
  );
  return <LedgerCtx.Provider value={value}>{children}</LedgerCtx.Provider>;
}
