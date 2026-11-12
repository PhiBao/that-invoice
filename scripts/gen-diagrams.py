#!/usr/bin/env python3
"""Generate the README diagrams as standalone SVGs in the product's paper-and-ink style.
Usage: python3 scripts/gen-diagrams.py   (writes docs/diagrams/*.svg)"""
import os
from xml.sax.saxutils import escape

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "diagrams")
os.makedirs(OUT, exist_ok=True)

PAPER, SHEET, INK, INK2, INK3, RULE, STAMP, GREEN = "#f1ebdc", "#fbf7ec", "#15120d", "#4a443a", "#7d7464", "#d5cab3", "#c93a1e", "#1d5a3b"
SERIF = "Newsreader, 'Iowan Old Style', Georgia, serif"
MONO = "'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace"
SANS = "Geist, system-ui, -apple-system, 'Segoe UI', sans-serif"


def head(w, h, title, desc):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-labelledby="t d">'
        f"<title id='t'>{escape(title)}</title><desc id='d'>{escape(desc)}</desc>"
        f'<rect width="{w}" height="{h}" fill="{PAPER}"/>'
        f'<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" fill="{INK}"/></marker>'
        f'<marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" fill="{STAMP}"/></marker>'
        f'<marker id="ag" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" fill="{GREEN}"/></marker></defs>'
    )


def text(x, y, s, size=13, fill=INK, font=SANS, anchor="start", weight="400", style="normal", spacing="0"):
    return (
        f'<text x="{x}" y="{y}" font-family="{font}" font-size="{size}" fill="{fill}" text-anchor="{anchor}" '
        f'font-weight="{weight}" font-style="{style}" letter-spacing="{spacing}">{escape(s)}</text>'
    )


# ───────────────────────── 1. lifecycle ─────────────────────────
def lifecycle():
    lanes = [
        ("Studio Nine", "issuer", 120),
        ("Acme DAO", "Sputnik DAO", 330),
        ("Registry", "contract", 560),
        ("inv-N account", "global contract", 790),
        ("Northfield Fund", "investor", 1010),
        ("USDC", "NEP-141", 1220),
    ]
    W, H = 1340, 1010
    s = head(W, H, "Invoice lifecycle", "Sequence of an invoice being issued, confirmed, sold, paid and collected.")
    s += text(40, 52, "One invoice, from issue to collection", 30, INK, SERIF, weight="500")
    s += text(40, 78, "Every arrow is a real call on NEAR. Red dashed arrows are attacks the contract blocks.", 13.5, INK3)
    top = 118
    lane = {}
    for name, sub, x in lanes:
        lane[name] = x
        s += f'<rect x="{x-82}" y="{top-30}" width="164" height="50" fill="{SHEET}" stroke="{INK}" stroke-width="1.2"/>'
        s += text(x, top-9, name, 14.5, INK, SANS, "middle", "600")
        s += text(x, top+8, sub, 10.5, INK3, MONO, "middle", spacing="0.8")
        s += f'<line x1="{x}" y1="{top+20}" x2="{x}" y2="{H-30}" stroke="{RULE}" stroke-width="1.4" stroke-dasharray="3 5"/>'

    y = top + 56
    n = 0

    def msg(a, b, label, sub=None, color=INK, mk="a", dash=False):
        nonlocal y, n
        n += 1
        xa, xb = lane[a], lane[b]
        d = ' stroke-dasharray="5 4"' if dash else ""
        mid = (xa + xb) / 2
        out = f'<circle cx="{min(xa,xb)-0}" cy="{y}" r="0"/>'
        out += f'<line x1="{xa}" y1="{y}" x2="{xb + (-4 if xb>xa else 4)}" y2="{y}" stroke="{color}" stroke-width="1.8" marker-end="url(#{mk})"{d}/>'
        out += f'<circle cx="{xa}" cy="{y}" r="3.2" fill="{color}"/>'
        out += text(mid, y - 9, label, 12.5, color if color != INK else INK, MONO, "middle", "500")
        if sub:
            out += text(mid, y + 17, sub, 11.5, INK3, SANS, "middle")
        y += 52 if sub else 44
        return out

    def note(x, label, w=250, color=GREEN):
        nonlocal y
        out = f'<rect x="{x - w/2}" y="{y-18}" width="{w}" height="30" fill="{SHEET}" stroke="{color}" stroke-width="1.4"/>'
        out += text(x, y + 2, label, 12.5, color, SANS, "middle", "600")
        y += 40
        return out

    s += msg("Studio Nine", "Registry", "issue(acme-dao, 0042, $1,200)", "attach 0.1 NEAR")
    s += msg("Registry", "inv-N account", "create_account + use_global_contract + new()", None)
    s += msg("Registry", "USDC", "storage_deposit(inv-N)", "so the account can hold USDC")
    s += note(lane["inv-N account"], "inv-3 now exists", 190)
    s += msg("Studio Nine", "Registry", "issue(acme-dao, 0042, $1,200) again", None, STAMP, "ar", True)
    s += text(lane["Registry"] + 14, y - 22, "BLOCKED: already exists as inv-3", 12, STAMP, SANS, "start", "600")
    y += 22
    s += msg("Acme DAO", "Registry", "confirm(inv-3)  [DAO proposal, council approves]", "the DAO account is the caller")
    s += msg("Studio Nine", "Registry", "list(inv-3, $1,176)", "locks the invoice")
    s += msg("Northfield Fund", "USDC", "ft_transfer_call(registry, $1,176, {buy: inv-3})", None)
    s += msg("USDC", "Registry", "ft_on_transfer", "owner := Fund, then pay Studio, one receipt")
    s += msg("Registry", "USDC", "ft_transfer($1,176 → Studio Nine)", None, GREEN, "ag")
    s += msg("Studio Nine", "Registry", "list(inv-3, …) again", None, STAMP, "ar", True)
    s += text(lane["Registry"] + 14, y - 22, "BLOCKED: only the owner can list", 12, STAMP, SANS, "start", "600")
    y += 22
    s += msg("Acme DAO", "USDC", "ft_transfer(inv-3, $1,200)  [DAO proposal]", "paid from the treasury", GREEN, "ag")
    s += note(lane["Registry"], "a server keeper calls sync(inv-3)", 250)
    s += msg("Registry", "USDC", "ft_balance_of(inv-3) ≥ $1,200", "status := Paid")
    s += msg("Northfield Fund", "Registry", "claim(inv-3)", "owner only; token locked as Claiming")
    s += msg("Registry", "inv-N account", "release(Fund, $1,200)", None)
    s += msg("inv-N account", "USDC", "ft_transfer(Fund, $1,200)", "status := Claimed", GREEN, "ag")
    s = s.replace(f'height="{H}"', f'height="{H}"')
    return s + "</svg>"


# ───────────────────────── 2. trust model ─────────────────────────
def trust():
    W, H = 1280, 640
    s = head(W, H, "Where the money can go", "The invoice account has one exit, and four checks stand in front of it.")
    s += text(40, 52, "The money has one way out", 30, INK, SERIF, weight="500")
    s += text(40, 78, "Anyone can pay an invoice. Only the current owner can collect it. No key anywhere can do anything else.", 13.5, INK3)

    # payer
    s += f'<rect x="40" y="250" width="200" height="110" fill="{SHEET}" stroke="{INK}" stroke-width="1.2"/>'
    s += text(140, 285, "Any payer", 16, INK, SANS, "middle", "600")
    s += text(140, 308, "any chain, any wallet", 12.5, INK2, SANS, "middle")
    s += text(140, 330, "NEAR Intents on mainnet", 11.5, INK3, MONO, "middle")
    s += f'<line x1="240" y1="305" x2="332" y2="305" stroke="{GREEN}" stroke-width="2.2" marker-end="url(#ag)"/>'
    s += text(286, 292, "USDC", 12, GREEN, MONO, "middle", "600")

    # invoice account
    s += f'<rect x="340" y="190" width="290" height="230" fill="{SHEET}" stroke="{INK}" stroke-width="1.6"/>'
    s += text(485, 224, "inv-3.registry", 17, INK, MONO, "middle", "600")
    s += text(485, 246, "holds the invoice's USDC", 13, INK2, SANS, "middle")
    for i, t in enumerate(["no access keys", "immutable code, by hash", "one method moves funds: release()", "only the registry may call it"]):
        s += f'<rect x="364" y="{268+i*34}" width="242" height="26" fill="{PAPER}" stroke="{RULE}"/>'
        s += text(485, 286 + i * 34, t, 12, INK, SANS, "middle")

    # gates (in the order the chain evaluates them)
    gx = [700, 860, 1020]
    gates = [
        ("registry.claim()", "caller must be the\ncurrent owner"),
        ("registry.claim()", "status must be Paid\n(not Listed, Claiming,\nor Claimed)"),
        ("invoice account", "release() runs only\nwhen the registry\ncalls it"),
    ]
    s += f'<line x1="630" y1="305" x2="{gx[0]-6}" y2="305" stroke="{INK}" stroke-width="2" marker-end="url(#a)"/>'
    for i, (k, t) in enumerate(gates):
        x = gx[i]
        s += f'<rect x="{x}" y="250" width="140" height="110" fill="{SHEET}" stroke="{STAMP}" stroke-width="1.6"/>'
        s += text(x + 70, 274, f"CHECK {i+1}", 10.5, STAMP, MONO, "middle", "600", spacing="1")
        s += text(x + 70, 290, k, 10.5, INK3, MONO, "middle")
        for j, line in enumerate(t.split("\n")):
            s += text(x + 70, 314 + j * 18, line, 12, INK, SANS, "middle")
        if i < 2:
            s += f'<line x1="{x+140}" y1="305" x2="{gx[i+1]-6}" y2="305" stroke="{INK}" stroke-width="2" marker-end="url(#a)"/>'
    s += f'<line x1="{gx[2]+140}" y1="305" x2="1186" y2="305" stroke="{GREEN}" stroke-width="2.4" marker-end="url(#ag)"/>'
    s += text(1222, 296, "current", 13, GREEN, SANS, "middle", "600")
    s += text(1222, 314, "owner", 13, GREEN, SANS, "middle", "600")

    # below: what can't happen
    s += f'<line x1="40" y1="470" x2="{W-40}" y2="470" stroke="{INK}" stroke-width="1.2"/>'
    s += text(40, 504, "What this rules out", 20, INK, SERIF, weight="500")
    items = [
        ("Selling twice", "issue() refuses a repeated (issuer, debtor, number). After a sale the old owner fails the owner check."),
        ("Paying the wrong person", "The payee is read at claim time, so a sale moves the right to the money without moving the address."),
        ("Racing a sale against a payout", "Listed and Claiming lock the token. A payout in flight blocks transfer, listing and a second claim."),
        ("Nobody can change the rules", "The invoice contract is immutable by hash, and the registry's access keys are deleted. Anyone can verify both with scripts/verify-deployment.mjs."),
    ]
    for i, (h, b) in enumerate(items):
        x = 40 + i * 300
        s += text(x, 540, h, 14, STAMP, SANS, "start", "600")
        words, line, ln = b.split(), "", 0
        for w in words:
            if len(line) + len(w) > 38:
                s += text(x, 562 + ln * 19, line.strip(), 12.5, INK2); line = ""; ln += 1
            line += w + " "
        s += text(x, 562 + ln * 19, line.strip(), 12.5, INK2)
    return s + "</svg>"


# ───────────────────────── 3. architecture ─────────────────────────
def architecture():
    W, H = 1280, 620
    s = head(W, H, "Architecture", "Browser, Rust API, NEAR contracts and NEAR Intents.")
    s += text(40, 52, "Architecture", 30, INK, SERIF, weight="500")
    s += text(40, 78, "The chain is the source of truth. The API reads it, signs for the demo personas, and proxies quotes.", 13.5, INK3)

    def box(x, y, w, h, title, lines, stroke=INK, fill=SHEET, tag=None):
        o = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}" stroke="{stroke}" stroke-width="1.4"/>'
        o += text(x + 16, y + 28, title, 15, INK, SANS, "start", "600")
        if tag:
            o += text(x + w - 14, y + 26, tag, 10.5, STAMP, MONO, "end", "600", spacing="1")
        for i, l in enumerate(lines):
            o += text(x + 16, y + 52 + i * 19, l, 12.2, INK2, SANS if not l.startswith(("GET", "POST", "inv", "ft_", "issue")) else MONO)
        return o

    s += box(40, 120, 270, 190, "Browser", ["Next.js 16 · React 19", "invoice document with a back side", "ledger, buyer desk, live demo", "SSE keeps it in sync", "persona switcher"], tag="TYPESCRIPT")
    s += box(380, 120, 330, 190, "Rust API (Axum, Tokio)", ["read model: polls registry, caches, SSE", "act: signs txs for demo personas", "demo + keeper + market maker", "quote: 1Click dry-run proxy", "docs: SHA-256 content store", "rate limits; keys only in env/secrets"], tag="RUST")
    s += box(780, 120, 460, 190, "NEAR testnet", ["registry.testnet   NEP-171 + market + records", "inv-N.registry     one account per invoice,", "                   shared immutable global contract", "usdc.testnet       NEP-141 (demo USDC)", "public RPC (fastnear)"], tag="CONTRACTS")
    s += box(380, 380, 330, 130, "NEAR Intents · 1Click API", ["dry quotes: what a Base, Arbitrum,", "Ethereum or Solana payer would send", "mainnet liquidity; no testnet exists"], tag="EXTERNAL")
    s += box(40, 380, 270, 130, "Document store", ["invoice line items stay off-chain", "only the hash is on-chain", "GET re-verifies the hash"], tag="FILES")
    s += box(780, 380, 460, 130, "Explorer", ["every demo step links to its tx", "invoice accounts are viewable on nearblocks", "events: NEP-171 + thatinvoice/1.0.0 (NEP-297)"], tag="PROOF")

    def arrow(x1, y1, x2, y2, label=None, color=INK, mk="a", lx=None, ly=None):
        o = f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="1.7" marker-end="url(#{mk})"/>'
        if label:
            o += text(lx if lx is not None else (x1 + x2) / 2, ly if ly is not None else (y1 + y2) / 2 - 8, label, 11.5, color, MONO, "middle")
        return o

    s += arrow(310, 200, 372, 200, "/api", INK, "a", 341, 190)
    s += arrow(372, 245, 310, 245, "SSE", INK, "a", 341, 262)
    s += arrow(710, 190, 772, 190, "views", INK, "a", 741, 180)
    s += arrow(710, 250, 772, 250, "txs", STAMP, "ar", 741, 268)
    s += arrow(545, 310, 545, 372, "quote", INK, "a", 575, 345)
    s += arrow(420, 310, 300, 392, "docs", INK, "a", 330, 348)
    s += text(40, 570, "Contracts: Rust + near-sdk 5.30 (wasm, wasm-opt). Server: Rust. UI: TypeScript. The browser never holds a key: demo personas are signed for server-side.", 12.5, INK3)
    return s + "</svg>"


for name, fn in [("lifecycle", lifecycle), ("trust-model", trust), ("architecture", architecture)]:
    path = os.path.join(OUT, f"{name}.svg")
    open(path, "w").write(fn())
    print("wrote", os.path.normpath(path))
