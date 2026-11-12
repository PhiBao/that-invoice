"use client";
import { useState } from "react";
import { LedgerTable } from "@/components/LedgerTable";
import { useLedger } from "@/lib/store";
import { isDemoRun } from "@/lib/format";

export default function LedgerPage() {
  const { state, error } = useLedger();
  const [showRuns, setShowRuns] = useState(false);
  const all = state?.invoices ?? [];
  const market = all.filter((i) => !isDemoRun(i));
  const runs = all.filter(isDemoRun);
  return (
    <div className="wrap page">
      <p className="eyebrow">Public ledger</p>
      <h1 className="h2" style={{ fontSize: 44, marginBottom: 6 }}>Every invoice on the registry</h1>
      <p className="muted" style={{ marginBottom: 28, maxWidth: "60ch" }}>
        Read live from the registry contract. Updates arrive as they land on-chain.
      </p>
      {error && !state ? (
        <div className="empty">Could not reach the API: {error}</div>
      ) : (
        <>
          <LedgerTable invoices={market} />
          {runs.length > 0 && (
            <div style={{ marginTop: 40 }}>
              <div className="section-head">
                <h2 className="h2" style={{ fontSize: 24 }}>Invoices from live demo runs</h2>
                <button className="btn ghost small" onClick={() => setShowRuns((s) => !s)}>
                  {showRuns ? "Hide" : `Show ${runs.length}`}
                </button>
              </div>
              {showRuns && <LedgerTable invoices={runs} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}
