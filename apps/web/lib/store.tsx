"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { LedgerState, Persona, TxOutcome } from "./types";

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
  busy: string | null;
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
  const [busy, setBusy] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const saved = localStorage.getItem("endorse.persona") as Persona["key"] | null;
    if (saved === "studio" || saved === "acme" || saved === "fund") setKey(saved);
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

  const persona = useMemo(
    () => state?.personas.find((p) => p.key === personaKey) ?? null,
    [state, personaKey],
  );

  const setPersonaKey = useCallback((k: Persona["key"]) => {
    setKey(k);
    localStorage.setItem("endorse.persona", k);
  }, []);

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = ++seq.current;
    setToasts((x) => [...x.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 9000);
  }, []);

  const dismiss = useCallback((id: number) => setToasts((x) => x.filter((y) => y.id !== id)), []);

  const act = useCallback(
    async (action: string, params: Record<string, unknown> = {}, label?: string) => {
      if (!personaKey) return null;
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
    [personaKey, push, refresh],
  );

  const value = useMemo(
    () => ({ state, error, persona, setPersonaKey, act, busy, toasts, dismiss, refresh }),
    [state, error, persona, setPersonaKey, act, busy, toasts, dismiss, refresh],
  );
  return <LedgerCtx.Provider value={value}>{children}</LedgerCtx.Provider>;
}
