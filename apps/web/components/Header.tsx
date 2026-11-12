"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Mark } from "./Mark";
import { useLedger } from "@/lib/store";
import { usd } from "@/lib/format";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/demo", label: "Live demo" },
  { href: "/ledger", label: "Ledger" },
  { href: "/desk", label: "Buyer desk" },
  { href: "/new", label: "New invoice" },
];

export function Header() {
  const path = usePathname();
  const { state, persona, setPersonaKey, error, guest, guestBusy, enableGuest, dropGuest } = useLedger();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  const stale = !!error || state?.stale;
  return (
    <header className="top">
      <div className="wrap">
        <Link href="/" className="brand" aria-label="That Invoice home">
          <Mark />
          <b>That Invoice</b>
        </Link>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={path === n.href || (n.href !== "/" && path.startsWith(n.href)) ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="right">
          <span className={`net ${stale ? "stale" : ""}`} title={stale ? "Chain data may be stale" : "Reading live from NEAR"}>
            {state?.network ?? "testnet"}
          </span>
          <div className="persona" ref={ref}>
            <button className="persona-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              <span>
                <small>Acting as</small>
                <strong>{persona ? `${persona.name} · ${persona.role}` : "Loading…"}</strong>
              </span>
              <span aria-hidden>▾</span>
            </button>
            {open && state && (
              <div className="persona-menu" role="menu">
                {state.personas.map((p) => (
                  <button
                    key={p.key}
                    role="menuitemradio"
                    aria-checked={persona?.key === p.key}
                    onClick={() => {
                      setPersonaKey(p.key);
                      setOpen(false);
                    }}
                  >
                    <strong>{p.name}</strong>
                    <span className="role">{p.role}</span>
                    <span className="bio">{p.blurb}</span>
                    <span className="mono muted" style={{ fontSize: 12 }}>{p.account}</span>
                    <span className="mono" style={{ fontSize: 12 }}>{usd(p.usdc, { cents: false })}</span>
                  </button>
                ))}
                <button
                  role="menuitemradio"
                  aria-checked={persona?.key === "guest"}
                  disabled={guestBusy}
                  onClick={async () => {
                    if (guest) setPersonaKey("guest");
                    else await enableGuest();
                    setOpen(false);
                  }}
                  style={{ background: persona?.key === "guest" ? "var(--paper)" : "var(--green-wash)" }}
                >
                  <strong>{guest ? "You" : "Use your own account"}</strong>
                  <span className="role" style={{ color: "var(--green)" }}>{guestBusy ? "creating, ~10 s…" : "Real account"}</span>
                  <span className="bio">
                    {guest
                      ? "A real NEAR account whose key lives in this browser. You sign your own transactions."
                      : "Creates a real NEAR testnet account in your browser and funds it with demo USDC. You sign your own transactions."}
                  </span>
                  {guest && <span className="mono muted" style={{ fontSize: 12 }}>{guest.account.slice(0, 8)}…{guest.account.slice(-6)}</span>}
                </button>
                {guest && persona?.key === "guest" && (
                  <button onClick={() => { dropGuest(); setOpen(false); }} style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                    <span>Forget this account and its key</span>
                  </button>
                )}
                <div className="foot">Server personas sign with testnet keys held on the server. A guest account signs in your browser. All of it is test money.</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
