"use client";
import Link from "next/link";
import type { Invoice } from "@/lib/types";
import { date, short, usd } from "@/lib/format";
import { StatusStamp } from "./StatusStamp";

export function LedgerTable({ invoices, limit }: { invoices: Invoice[]; limit?: number }) {
  const rows = limit ? invoices.slice(0, limit) : invoices;
  if (!rows.length) return <div className="empty">No invoices yet. Run the live demo to create one on-chain.</div>;
  return (
    <div className="table-scroll">
      <table className="ledger">
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Billed to</th>
            <th>Owned by</th>
            <th className="num">Face value</th>
            <th>Due</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id} className="row">
              <td>
                <Link className="id" href={`/i/${i.id}`}>{i.number}</Link>
                <div className="sub">{i.id}</div>
              </td>
              <td className="mono" style={{ fontSize: 13 }}>{short(i.debtor, 24)}</td>
              <td className="mono" style={{ fontSize: 13 }}>
                {short(i.owner, 24)}
                {i.owner !== i.issuer && <div className="sub">sold by {short(i.issuer, 20)}</div>}
              </td>
              <td className="num">{usd(i.amount)}</td>
              <td className="mono" style={{ fontSize: 13 }}>{date(i.due_ms)}</td>
              <td><StatusStamp status={i.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
