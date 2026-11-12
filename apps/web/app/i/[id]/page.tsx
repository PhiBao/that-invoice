"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { InvoiceDoc } from "@/components/InvoiceDoc";
import { QuotePanel } from "@/components/QuotePanel";
import { useLedger } from "@/lib/store";
import { accountUrl, apr, date, daysLate, daysTo, discountPct, isOverdue, short, toMicro, usd } from "@/lib/format";
import type { DebtorRecord, Invoice } from "@/lib/types";

interface Detail { invoice: Invoice; held: string; debtor_record: DebtorRecord | null }

export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = use(params);
  const id = decodeURIComponent(rawId);
  const { state, persona, act, actAs, busy } = useLedger();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [price, setPrice] = useState("");

  const fingerprint = useMemo(() => JSON.stringify(state?.invoices.find((i) => i.id === id) ?? null), [state, id]);
  useEffect(() => {
    fetch(`/api/invoices/${encodeURIComponent(id)}`)
      .then(async (r) => {
        if (r.status === 404) return setMissing(true);
        setDetail(await r.json());
      })
      .catch(() => {});
  }, [id, fingerprint]);

  // While an invoice is unpaid, keep watching its account so a payment shows up without a reload.
  const unpaid = detail ? ["Issued", "Confirmed", "Listed", "Paid", "Claiming"].includes(detail.invoice.status) : false;
  useEffect(() => {
    if (!unpaid) return;
    const t = setInterval(() => {
      fetch(`/api/invoices/${encodeURIComponent(id)}`).then(async (r) => r.ok && setDetail(await r.json())).catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, [id, unpaid]);

  const inv = detail?.invoice;
  useEffect(() => {
    if (inv && !price) setPrice((Number(BigInt(inv.amount)) / 1e6 * 0.98).toFixed(2));
  }, [inv, price]);

  if (missing) return <div className="wrap page"><div className="empty">No invoice called {id}. <Link href="/ledger">Back to the ledger</Link></div></div>;
  if (!inv || !detail) return <div className="wrap page"><div className="empty">Loading invoice…</div></div>;

  const explorer = state?.explorer ?? "https://testnet.nearblocks.io";
  const me = persona?.account;
  const isOwner = me === inv.owner;
  const isDebtor = me === inv.debtor;
  const held = BigInt(detail.held || "0");
  const covered = held >= BigInt(inv.amount);
  const open = inv.status === "Issued" || inv.status === "Confirmed" || inv.status === "Listed";
  const days = daysTo(inv.due_ms);
  const askMicro = (() => { try { return toMicro(price || "0"); } catch { return "0"; } })();
  const askOk = BigInt(askMicro) > 0n && BigInt(askMicro) <= BigInt(inv.amount);
  const debtorRec = detail.debtor_record;

  return (
    <div className="wrap page">
      <p className="eyebrow"><Link href="/ledger">Ledger</Link> / {inv.number}</p>
      <div className="cols" style={{ marginTop: 14 }}>
        <div>
          <InvoiceDoc invoice={inv} held={detail.held} flipped={flipped} onFlip={setFlipped} />
          <dl className="kv" style={{ marginTop: 28 }}>
            <dt>Invoice account</dt><dd><a href={accountUrl(explorer, inv.id)} target="_blank" rel="noreferrer">{inv.id} ↗</a></dd>
            <dt>Money held at that address</dt><dd>{usd(detail.held)}</dd>
            <dt>Issuer</dt><dd>{inv.issuer}</dd>
            <dt>Billed to</dt><dd><Link href={`/debtor/${inv.debtor}`}>{inv.debtor}</Link></dd>
            <dt>Current owner</dt><dd>{persona?.key === "guest" && inv.owner === persona.account ? `You (${inv.owner.slice(0, 8)}…${inv.owner.slice(-6)})` : inv.owner}</dd>
            <dt>Document hash</dt><dd>{inv.doc_hash ? <a href={`/api/docs/${inv.doc_hash}`} target="_blank" rel="noreferrer">{short(inv.doc_hash, 28)}</a> : "none attached"}</dd>
          </dl>
        </div>

        <div style={{ display: "grid", gap: 20 }}>
          <section className="panel">
            <header>
              <b>{persona ? `As ${persona.name}` : "Actions"}</b>
              <span className="eyebrow">{persona?.role}</span>
            </header>
            <div className="body actions">
              {isOverdue(inv) && (
                <div className="note">
                  <b>{daysLate(inv.due_ms)} days past due.</b> {inv.debtor} has not paid. Buyers price this as a distressed receivable. It can still be paid at any time, and the owner collects whenever it is.
                </div>
              )}
              {inv.status === "Issued" && isDebtor && (
                <>
                  <p style={{ margin: 0 }}>{inv.issuer} says you owe <b>{usd(inv.amount)}</b>. Confirming records that on-chain and lets the issuer sell the invoice.</p>
                  <button className="btn" disabled={!!busy} onClick={() => act("confirm", { id }, "Confirm invoice")}>{busy === "confirm" ? <span className="spin" /> : "Confirm this invoice"}</button>
                </>
              )}

              {inv.status === "Confirmed" && isOwner && (
                <>
                  <p style={{ margin: 0 }}>Sell this invoice now and get cash today. The buyer collects when {inv.debtor} pays.</p>
                  <label className="field" style={{ margin: 0 }}>
                    <span className="eyebrow">Asking price (USDC)</span>
                    <input className="input num" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} />
                    <div className="hint">
                      {askOk ? <>{discountPct(inv.amount, askMicro).toFixed(2)}% discount{days > 0 && apr(inv.amount, askMicro, days) !== null ? <> · buyer earns about {apr(inv.amount, askMicro, days)!.toFixed(1)}% a year</> : null}</> : "Price must be between $0.01 and the face value."}
                    </div>
                  </label>
                  <button className="btn stamp" disabled={!!busy || !askOk} onClick={() => act("list", { id, price })}>{busy === "list" ? <span className="spin" /> : `List for ${usd(askMicro)}`}</button>
                </>
              )}

              {inv.status === "Listed" && isOwner && (
                <>
                  <p style={{ margin: 0 }}>Listed at <b>{usd(inv.price)}</b>. While it is listed it cannot be transferred or claimed.</p>
                  <button className="btn ghost" disabled={!!busy} onClick={() => act("delist", { id })}>{busy === "delist" ? <span className="spin" /> : "Withdraw from sale"}</button>
                </>
              )}

              {inv.status === "Listed" && !isOwner && inv.price && (
                <>
                  <p style={{ margin: 0 }}>
                    Pay <b>{usd(inv.price)}</b> now. When {inv.debtor} pays {usd(inv.amount)}, you collect it
                    {days > 0 ? <> ({discountPct(inv.amount, inv.price).toFixed(2)}% off, about {apr(inv.amount, inv.price, days)?.toFixed(1)}% a year, due {date(inv.due_ms)})</> : null}.
                  </p>
                  {debtorRec && (
                    <p className="hint" style={{ margin: 0 }}>
                      {inv.debtor} has paid {debtorRec.paid_on_time} of {debtorRec.paid} confirmed invoices on time.
                    </p>
                  )}
                  <button className="btn stamp" disabled={!!busy} onClick={() => act("buy", { id }, "Buy invoice")}>{busy === "buy" ? <span className="spin" /> : `Buy for ${usd(inv.price)}`}</button>
                </>
              )}

              {open && !covered && persona && (
                <>
                  <hr className="rule soft" />
                  <p style={{ margin: 0, fontSize: 13.5 }}>Anyone can pay this account. As {persona.name} you hold <span className="mono">{usd(persona.usdc)}</span> of test USDC.</p>
                  <button className="btn ghost" disabled={!!busy || BigInt(persona.usdc) < BigInt(inv.amount)} onClick={() => act("pay", { id }, "Pay invoice")}>{busy === "pay" ? <span className="spin" /> : `Pay ${usd(inv.amount)} to the invoice account`}</button>
                </>
              )}

              {open && covered && (
                <div className="note green">
                  <span className="spin" style={{ marginRight: 8 }} />
                  <b>Payment received.</b> The invoice account holds {usd(detail.held)}; the server is recording it on the registry. This takes a few seconds.
                  <div style={{ marginTop: 8 }}>
                    <button className="btn small ghost" disabled={!!busy} onClick={() => act("sync", { id }, "Record payment")}>Record it myself</button>
                  </div>
                </div>
              )}

              {inv.status === "Paid" && isOwner && (
                <>
                  <div className="note green">Paid in full. {usd(inv.received)} is waiting at {short(inv.id, 24)}.</div>
                  <button className="btn stamp" disabled={!!busy} onClick={() => act("claim", { id }, "Claim payment")}>{busy === "claim" ? <span className="spin" /> : `Claim ${usd(inv.received)}`}</button>
                </>
              )}

              {inv.status === "Paid" && !isOwner && (
                <div className="note green">Paid in full. Only the current owner, {short(inv.owner, 26)}, can collect.</div>
              )}
              {inv.status === "Claimed" && <div className="note green">Settled. {usd(inv.received)} went to {short(inv.owner, 26)}.</div>}
              {inv.status === "Claiming" && <div className="note">A payout is in flight. The invoice is locked until it settles.</div>}

              {persona?.key === "guest" && open && !covered && (
                <div className="note">
                  <b>Demo helper.</b> In real life {short(inv.debtor, 26)} pays on its own schedule. To finish the loop now, make the client pay this invoice, then collect it with your own account.
                  <div style={{ marginTop: 10 }}>
                    <button className="btn small ghost" disabled={!!busy} onClick={() => actAs("acme", "pay", { id }, "Client pays (demo helper)")}>
                      {busy === "pay" ? <span className="spin" /> : "Make the client pay now"}
                    </button>
                  </div>
                </div>
              )}
              {!persona && <p className="muted" style={{ margin: 0 }}>Choose a persona in the header to act.</p>}
              {persona && inv.status === "Issued" && !isDebtor && !isOwner && <p className="hint" style={{ margin: 0 }}>Waiting for {inv.debtor} to confirm. Switch persona to act as them.</p>}
              {persona && inv.status === "Confirmed" && !isOwner && <p className="hint" style={{ margin: 0 }}>Only the owner, {short(inv.owner, 24)}, can list it for sale.</p>}
            </div>
          </section>

          {open && <QuotePanel amountMicro={inv.amount} />}
        </div>
      </div>
    </div>
  );
}
