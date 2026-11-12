"use client";
import { LedgerTable } from "@/components/LedgerTable";
import { useLedger } from "@/lib/store";

export default function LedgerPage() {
  const { state, error } = useLedger();
  return (
    <div className="wrap page">
      <p className="eyebrow">Public ledger</p>
      <h1 className="h2" style={{ fontSize: 44, marginBottom: 6 }}>Every invoice on the registry</h1>
      <p className="muted" style={{ marginBottom: 28, maxWidth: "60ch" }}>
        Read live from the registry contract. Updates arrive as they land on-chain.
      </p>
      {error && !state ? <div className="empty">Could not reach the API: {error}</div> : <LedgerTable invoices={state?.invoices ?? []} />}
    </div>
  );
}
