"use client";

import Link from "next/link";
import { InvoiceDoc } from "@/components/InvoiceDoc";
import { LedgerTable } from "@/components/LedgerTable";
import { useLedger } from "@/lib/store";
import { isDemoRun, short, usd } from "@/lib/format";
import type { Invoice } from "@/lib/types";

const SAMPLE: Invoice = {
  id: "inv-1.registry.testnet",
  seq: "1",
  issuer: "studio-nine.testnet",
  debtor: "acme-dao.testnet",
  owner: "studio-nine.testnet",
  number: "0042",
  amount: "1200000000",
  due_ms: String(Date.now() + 30 * 864e5),
  doc_hash: "",
  status: "Confirmed",
  price: null,
  received: "0",
  issued_ms: String(Date.now()),
  paid_ms: null,
  log: [],
};

export default function Home() {
  const { state } = useLedger();
  const invoices = state?.invoices ?? [];
  const market = invoices.filter((i) => !isDemoRun(i));
  // Show the most instructive invoice: one that has changed hands.
  const showcase = invoices.find((i) => i.log.some((l) => l.kind === "Sold") && i.status === "Claimed") ?? invoices[0] ?? SAMPLE;
  const settled = invoices.filter((i) => i.status === "Claimed");
  const settledTotal = settled.reduce((a, i) => a + BigInt(i.amount), 0n);
  const codeHash = state?.registry_config?.invoice_code_hash;

  return (
    <div className="wrap">
      <section className="hero">
        <div>
          <p className="eyebrow" style={{ marginBottom: 18 }}>Receivables on NEAR · built for NEAR HACKATHON</p>
          <h1 className="h1">The invoice <em>is</em> the account.</h1>
          <p className="lede" style={{ marginTop: 22 }}>
            When the auto-parts supplier First Brands collapsed owing about $2.3 billion in factoring alone,
            investigators asked whether the same invoices had been financed more than once. Here an invoice can
            exist once, and the money it earns goes to whoever owns it when it is paid.
          </p>
          <p className="lede" style={{ marginTop: 14, fontSize: 16 }}>
            Every invoice is its own NEAR account. Sell it for cash today, and the client keeps paying the same
            address. Nothing is forwarded, and the old owner cannot redirect it.
          </p>
          <div className="cta">
            <Link href="/demo" className="btn stamp">Watch it run, live</Link>
            <Link href="/desk" className="btn ghost">Try it with your own account</Link>
          </div>
          <p className="hero-note">
            Every step is a real transaction on NEAR testnet with an explorer link. The only simulated thing is
            the money: invoices settle in a test USDC token.
          </p>
        </div>
        <InvoiceDoc invoice={showcase} />
      </section>

      <section style={{ marginBottom: 56 }}>
        <div className="section-head">
          <h2 className="h2">How a payment follows the owner</h2>
          <span className="eyebrow">three steps</span>
        </div>
        <div className="steps3">
          <div><div className="n">1</div><h3>Issue</h3><p>The registry creates <span className="mono">inv-N.registry</span> as a real NEAR account and mints the invoice as an NFT. The client confirms it on-chain. When the client is a DAO, that means a proposal that its council approves.</p></div>
          <div><div className="n">2</div><h3>Sell</h3><p>List the confirmed invoice at a discount. A buyer pays, and in one receipt the NFT moves and the seller is paid. The pay-to address stays put.</p></div>
          <div><div className="n">3</div><h3>Get paid</h3><p>The client pays the invoice account in USDC. The server notices, the registry marks it paid, and the <em>current</em> owner collects. On mainnet, NEAR Intents routes USDC from other chains into the account.</p></div>
        </div>
      </section>

      <section style={{ marginBottom: 56 }}>
        <div className="facts">
          <div className="fact"><span className="eyebrow">Invoices on the registry</span><b className="mono">{state?.registry_config?.invoices ?? "–"}</b></div>
          <div className="fact"><span className="eyebrow">Settled to the right owner</span><b className="mono">{usd(settledTotal, { cents: false })}</b></div>
          <div className="fact">
            <span className="eyebrow">Invoice contract, immutable</span>
            <b className="mono" style={{ fontSize: 20, paddingTop: 7 }}>{codeHash ? short(codeHash, 20) : "–"}</b>
            <span className="muted" style={{ fontSize: 12.5 }}>Global contract by hash. No keys, no upgrades.</span>
          </div>
        </div>
      </section>

      <section style={{ paddingBottom: 40 }}>
        <div className="section-head">
          <h2 className="h2">Latest on the ledger</h2>
          <Link href="/ledger" className="eyebrow">all invoices →</Link>
        </div>
        <LedgerTable invoices={market} limit={6} />
      </section>
    </div>
  );
}
