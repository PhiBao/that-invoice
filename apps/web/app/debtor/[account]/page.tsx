"use client";

import { use, useEffect, useState } from "react";
import { LedgerTable } from "@/components/LedgerTable";
import type { DebtorRecord, Invoice } from "@/lib/types";
import { usd } from "@/lib/format";
import { useLedger } from "@/lib/store";

export default function DebtorPage({ params }: { params: Promise<{ account: string }> }) {
  const { account: raw } = use(params);
  const account = decodeURIComponent(raw);
  const { state } = useLedger();
  const [data, setData] = useState<{ record: DebtorRecord; invoices: Invoice[] } | null>(null);
  const fp = state?.invoices.length ?? 0;

  useEffect(() => {
    fetch(`/api/debtors/${encodeURIComponent(account)}`).then((r) => r.json()).then(setData).catch(() => {});
  }, [account, fp]);

  const r = data?.record;
  const lateDays = r ? Math.round(Number(r.late_ms_total) / 864e5) : 0;
  return (
    <div className="wrap page">
      <p className="eyebrow">Client record</p>
      <h1 className="h2 mono" style={{ fontSize: 34, marginBottom: 24, wordBreak: "break-all" }}>{account}</h1>
      <div className="facts" style={{ marginBottom: 40 }}>
        <div className="fact"><span className="eyebrow">Confirmed invoices</span><b className="mono">{r?.confirmed ?? "–"}</b></div>
        <div className="fact"><span className="eyebrow">Paid on time</span><b className="mono">{r ? `${r.paid_on_time} of ${r.paid}` : "–"}</b></div>
        <div className="fact"><span className="eyebrow">Total paid</span><b className="mono">{r ? usd(r.paid_total, { cents: false }) : "–"}</b>{lateDays > 0 && <span className="muted" style={{ fontSize: 12.5 }}>{lateDays} days late in total</span>}</div>
      </div>
      <p className="muted" style={{ maxWidth: "62ch", marginBottom: 24 }}>
        Computed by the registry contract from invoices this account confirmed and paid. Invoices that were never
        confirmed do not count, so nobody can damage a record by billing an account.
      </p>
      <LedgerTable invoices={data?.invoices ?? []} />
    </div>
  );
}
