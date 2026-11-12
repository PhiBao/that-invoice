"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLedger } from "@/lib/store";

export default function NewInvoice() {
  const { state, persona, act, busy, refresh } = useLedger();
  const router = useRouter();
  const [debtor, setDebtor] = useState("acme");
  const [custom, setCustom] = useState("");
  const [number, setNumber] = useState(() => String(1000 + Math.floor(Math.random() * 9000)));
  const [amount, setAmount] = useState("1200");
  const [days, setDays] = useState("30");
  const [memo, setMemo] = useState("Brand identity, phase 2 (design + handoff)");
  const [err, setErr] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const debtorChoice = debtor === "custom" ? custom.trim() : debtor;
  const valid = /^\d+(\.\d{1,6})?$/.test(amount) && Number(amount) > 0 && number.trim().length > 0 && debtorChoice.length > 1;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!persona) return;
    setErr(null);
    setWorking(true);
    try {
      // 1. store the document off-chain; only its hash goes on-chain
      const doc = { number, from: persona.account, to: debtorChoice, amount, currency: "USDC", memo, created: new Date().toISOString() };
      const d = await fetch("/api/docs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(doc) });
      const dj = await d.json();
      if (!d.ok) throw new Error(dj.error ?? "could not store the document");
      // 2. issue on-chain
      const out = await act("issue", { debtor: debtorChoice, number: number.trim(), amount, due_days: Number(days), doc_hash: dj.doc_hash }, "Issue invoice");
      if (!out?.ok) { setErr(out?.error ?? "The invoice was not issued."); return; }
      // 3. find the new account and go there
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 900));
        const s = await (await fetch("/api/state", { cache: "no-store" })).json();
        const found = s.invoices.find((x: any) => x.number === number.trim() && x.issuer === persona.account);
        if (found) { await refresh(); router.push(`/i/${found.id}`); return; }
      }
      setErr("Issued, but the account is still being created. Check the ledger in a moment.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="wrap page">
      <p className="eyebrow">New invoice</p>
      <h1 className="h2" style={{ fontSize: 44, marginBottom: 6 }}>Bill someone. Get an address.</h1>
      <p className="muted" style={{ marginBottom: 28, maxWidth: "60ch" }}>
        Issuing creates a NEAR account for this invoice. Line items stay off-chain; only their hash is recorded.
      </p>
      <div className="cols">
        <form onSubmit={submit} className="panel">
          <header><b>Invoice details</b><span className="eyebrow">{persona ? `from ${persona.name}` : ""}</span></header>
          <div className="body">
            <label className="field"><span className="eyebrow">Bill to</span>
              <select className="input" value={debtor} onChange={(e) => setDebtor(e.target.value)}>
                {(state?.personas ?? []).filter((p) => p.account !== persona?.account).map((p) => <option key={p.key} value={p.key}>{p.name} ({p.account})</option>)}
                <option value="custom">Another NEAR account…</option>
              </select>
            </label>
            {debtor === "custom" && (
              <label className="field"><span className="eyebrow">Client account</span>
                <input className="input num" placeholder="client.testnet" value={custom} onChange={(e) => setCustom(e.target.value)} />
                <div className="hint">A DAO account works: it confirms through a normal proposal.</div>
              </label>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
              <label className="field"><span className="eyebrow">Invoice no.</span><input className="input num" value={number} maxLength={40} onChange={(e) => setNumber(e.target.value)} /></label>
              <label className="field"><span className="eyebrow">Amount (USDC)</span><input className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
              <label className="field"><span className="eyebrow">Due in (days)</span><input className="input num" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} /></label>
            </div>
            <label className="field"><span className="eyebrow">Line items (off-chain)</span><textarea className="input" rows={3} value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
            {err && <div className="note" style={{ marginBottom: 16 }}>{err}</div>}
            <button className="btn stamp" disabled={!valid || !persona || working || !!busy}>{working || busy === "issue" ? <><span className="spin" /> Creating the account…</> : "Issue invoice"}</button>
            <p className="hint">Needs 0.1 testnet NEAR from the issuer, which funds the invoice account and its storage.</p>
          </div>
        </form>
        <aside className="note">
          <b>What happens</b>
          <ol style={{ margin: "8px 0 0 18px", padding: 0 }}>
            <li>The document is stored and hashed (SHA-256).</li>
            <li>The registry creates <span className="mono">inv-N.{state?.registry ?? "registry"}</span>, running one shared immutable contract.</li>
            <li>The account is registered on the token so it can receive USDC.</li>
            <li>The invoice is minted to you as an NFT. You can sell it once the client confirms.</li>
          </ol>
          <p className="hint" style={{ marginTop: 12 }}>Submitting the same number to the same client twice is refused by the contract.</p>
        </aside>
      </div>
    </div>
  );
}
