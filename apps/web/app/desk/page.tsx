"use client";

import Link from "next/link";
import { useLedger } from "@/lib/store";
import { apr, date, daysLate, daysTo, discountPct, friendly, isOverdue, short, usd } from "@/lib/format";

export default function DeskPage() {
  const { state, persona, act, busy } = useLedger();
  const listed = (state?.invoices ?? []).filter((i) => i.status === "Listed" && i.price);
  const mine = (state?.invoices ?? []).filter((i) => persona && i.owner === persona.account && i.issuer !== persona.account);
  const mineIssued = (state?.invoices ?? []).filter((i) => persona && i.owner === persona.account && i.issuer === persona.account);

  return (
    <div className="wrap page">
      <p className="eyebrow">Buyer desk</p>
      <h1 className="h2" style={{ fontSize: 44, marginBottom: 6 }}>Confirmed invoices, for sale</h1>
      <p className="muted" style={{ marginBottom: 28, maxWidth: "62ch" }}>
        Each invoice below has been acknowledged by the client on-chain. You pay the asking price, the invoice
        becomes yours in the same receipt, and you collect the face value when the client pays.
      </p>

      {listed.length === 0 ? (
        <div className="empty">Nothing is for sale right now. Run the <Link href="/demo">live demo</Link>, or list a confirmed invoice as Studio Nine.</div>
      ) : (
        <div className="table-scroll">
          <table className="ledger">
            <thead>
              <tr>
                <th>Invoice</th><th>Client record</th><th className="num">Face</th><th className="num">Ask</th>
                <th className="num">Discount</th><th className="num">Due in</th><th className="num">Yield / yr</th><th />
              </tr>
            </thead>
            <tbody>
              {listed.map((i) => {
                const rec = state?.debtors[i.debtor];
                const days = daysTo(i.due_ms);
                const y = days > 0 ? apr(i.amount, i.price!, days) : null;
                const own = persona?.account === i.owner;
                return (
                  <tr key={i.id} className="row">
                    <td><Link className="id" href={`/i/${i.id}`}>{i.number}</Link><div className="sub">from {friendly(i.issuer) ?? short(i.issuer, 22)}</div></td>
                    <td className="mono" style={{ fontSize: 13 }}>
                      <Link href={`/debtor/${i.debtor}`}>{friendly(i.debtor) ?? short(i.debtor, 22)}</Link>
                      <div className="sub">{rec ? `${rec.paid_on_time}/${rec.paid} paid on time · ${rec.confirmed} confirmed` : "no history"}</div>
                    </td>
                    <td className="num">{usd(i.amount)}</td>
                    <td className="num"><b>{usd(i.price)}</b></td>
                    <td className="num">{discountPct(i.amount, i.price!).toFixed(2)}%</td>
                    <td className="num">{isOverdue(i) ? <span style={{ color: "var(--stamp-ink)" }}>{daysLate(i.due_ms)}d late</span> : days > 0 ? `${days}d` : "due"}<div className="sub">{date(i.due_ms)}</div></td>
                    <td className="num">{isOverdue(i) ? <span title="Past due: priced for the risk the client does not pay on time" style={{ color: "var(--stamp-ink)" }}>distressed</span> : y === null ? "–" : `${y.toFixed(1)}%`}</td>
                    <td style={{ textAlign: "right" }}>
                      {(() => {
                        const short = !!persona && BigInt(persona.usdc || "0") < BigInt(i.price!);
                        return (
                          <button className="btn small stamp" disabled={!!busy || own || !persona || short}
                            title={own ? "You cannot buy your own invoice" : short ? "Not enough USDC in this account" : undefined}
                            onClick={() => act("buy", { id: i.id }, "Buy invoice")}>
                            {busy === "buy" ? <span className="spin" /> : own ? "Yours" : short ? "Needs USDC" : "Buy"}
                          </button>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {persona && (
        <section style={{ marginTop: 56 }}>
          <div className="section-head">
            <h2 className="h2">Held by {persona.name}</h2>
            <span className="eyebrow mono">{usd(persona.usdc, { cents: false })} test USDC</span>
          </div>
          {[...mine, ...mineIssued].length === 0 ? (
            <div className="empty">{persona.name} owns no invoices yet.</div>
          ) : (
            <table className="ledger">
              <thead><tr><th>Invoice</th><th>Billed to</th><th className="num">Face</th><th>Status</th><th /></tr></thead>
              <tbody>
                {[...mine, ...mineIssued].map((i) => (
                  <tr key={i.id} className="row">
                    <td><Link className="id" href={`/i/${i.id}`}>{i.number}</Link><div className="sub">{i.id}</div></td>
                    <td className="mono" style={{ fontSize: 13 }}>{short(i.debtor, 24)}</td>
                    <td className="num">{usd(i.amount)}</td>
                    <td className="mono" style={{ fontSize: 13 }}>{i.status}</td>
                    <td style={{ textAlign: "right" }}>
                      {i.status === "Paid" && <button className="btn small" disabled={!!busy} onClick={() => act("claim", { id: i.id }, "Claim payment")}>{busy === "claim" ? <span className="spin" /> : `Claim ${usd(i.received, { cents: false })}`}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
