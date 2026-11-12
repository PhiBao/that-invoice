//! On-chain invoice art. Produces the SVG that `nft_token` returns as `media`.
//! Everything is computed from contract state at view time, so it changes when the invoice does.

use crate::{Invoice, Status};

const PAPER: &str = "#f1ebdc";
const SHEET: &str = "#fbf7ec";
const INK: &str = "#15120d";
const INK2: &str = "#4a443a";
const STAMP: &str = "#c93a1e";
const GREEN: &str = "#1d5a3b";

/// XML-escape text that came from users (invoice numbers are free text).
pub fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            '\'' => o.push_str("&apos;"),
            c => o.push(c),
        }
    }
    o
}

/// Percent-encode the characters that break a `data:` URI. Quotes are never used in the SVG attributes.
pub fn data_uri(svg: &str) -> String {
    let mut o = String::from("data:image/svg+xml;utf8,");
    for c in svg.chars() {
        match c {
            '<' => o.push_str("%3C"),
            '>' => o.push_str("%3E"),
            '#' => o.push_str("%23"),
            '%' => o.push_str("%25"),
            '"' => o.push_str("%22"),
            '\n' | '\r' => {}
            c => o.push(c),
        }
    }
    o
}

/// `1_234_567_890` micro-USDC -> `1,234.56` (cents dropped when zero).
pub fn dollars(micro: u128) -> String {
    let whole = micro / 1_000_000;
    let cents = (micro % 1_000_000) / 10_000;
    let digits = whole.to_string();
    let mut out = String::new();
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(ch);
    }
    if cents == 0 { out } else { format!("{out}.{cents:02}") }
}

/// Civil date (UTC) from unix milliseconds.
pub fn ymd(ms: u64) -> String {
    let days = (ms / 86_400_000) as i64;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

/// What the stamp says right now, and its colour.
pub fn stamp_for(inv: &Invoice, now_ms: u64) -> (&'static str, &'static str) {
    let open = matches!(inv.status, Status::Issued | Status::Confirmed | Status::Listed);
    if open && now_ms > inv.due_ms.0 {
        return ("OVERDUE", STAMP);
    }
    match inv.status {
        Status::Creating => ("CREATING", INK2),
        Status::Issued => ("ISSUED", INK2),
        Status::Confirmed => ("CONFIRMED", INK2),
        Status::Listed => ("FOR SALE", STAMP),
        Status::Paid => ("PAID", GREEN),
        Status::Claiming => ("CLAIMING", GREEN),
        Status::Claimed => ("SETTLED", GREEN),
    }
}

fn clip(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        let head: String = s.chars().take(n.saturating_sub(1)).collect();
        format!("{head}…")
    }
}

pub fn invoice_svg(inv: &Invoice, now_ms: u64) -> String {
    let (label, color) = stamp_for(inv, now_ms);
    let amount = dollars(inv.amount.0);
    let size = if amount.len() > 9 { 56 } else { 72 };
    format!(
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 420' width='600' height='420'>\
<rect width='600' height='420' fill='{PAPER}'/>\
<rect x='24' y='24' width='552' height='372' fill='{SHEET}' stroke='{INK}' stroke-width='2'/>\
<text x='52' y='68' font-family='Georgia,serif' font-size='15' letter-spacing='7' font-weight='700' fill='{INK}'>INVOICE</text>\
<text x='52' y='94' font-family='monospace' font-size='15' fill='{INK2}'>No. {no}</text>\
<text x='52' y='190' font-family='Georgia,serif' font-size='{size}' fill='{INK}'>${amount}</text>\
<text x='52' y='216' font-family='monospace' font-size='14' fill='{INK2}'>USDC  ·  due {due}</text>\
<g transform='rotate(-7 470 118)'><rect x='372' y='88' width='182' height='54' fill='none' stroke='{color}' stroke-width='4'/>\
<text x='463' y='124' text-anchor='middle' font-family='monospace' font-size='22' font-weight='700' letter-spacing='4' fill='{color}'>{label}</text></g>\
<line x1='52' y1='246' x2='548' y2='246' stroke='{INK}' stroke-width='1' stroke-dasharray='4 4'/>\
<text x='52' y='276' font-family='monospace' font-size='11' letter-spacing='2' fill='{INK2}'>FROM</text>\
<text x='52' y='296' font-family='monospace' font-size='14' fill='{INK}'>{from}</text>\
<text x='310' y='276' font-family='monospace' font-size='11' letter-spacing='2' fill='{INK2}'>BILL TO</text>\
<text x='310' y='296' font-family='monospace' font-size='14' fill='{INK}'>{to}</text>\
<text x='52' y='330' font-family='monospace' font-size='11' letter-spacing='2' fill='{INK2}'>PAY TO THE ORDER OF</text>\
<text x='52' y='352' font-family='Georgia,serif' font-style='italic' font-size='20' fill='{INK}'>{owner}</text>\
<text x='52' y='382' font-family='monospace' font-size='11' fill='{INK2}'>{id}</text>\
</svg>",
        no = esc(&clip(&inv.number, 28)),
        due = ymd(inv.due_ms.0),
        from = esc(&clip(inv.issuer.as_str(), 26)),
        to = esc(&clip(inv.debtor.as_str(), 26)),
        owner = esc(&clip(inv.owner.as_str(), 40)),
        id = esc(inv.id.as_str()),
    )
}

/// The collection icon: the product mark.
pub fn brand_icon() -> String {
    data_uri(&format!(
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='{PAPER}'/>\
<g transform='rotate(-8 16 16)'><rect x='3.5' y='7.5' width='25' height='17' fill='none' stroke='{STAMP}' stroke-width='2.6'/>\
<path d='M10 12l5 4-5 4M17 12l5 4-5 4' fill='none' stroke='{STAMP}' stroke-width='2.6' stroke-linecap='square'/></g></svg>"
    ))
}
