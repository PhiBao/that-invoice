import type { Invoice, Status } from "./types";

/** micro-USDC string -> "$1,200.00" without floating point. */
export function usd(micro: string | bigint | null | undefined, opts: { cents?: boolean } = {}): string {
  if (micro === null || micro === undefined || micro === "") return "–";
  const v = typeof micro === "bigint" ? micro : BigInt(micro);
  const whole = v / 1_000_000n;
  const frac = Number(v % 1_000_000n) / 10_000; // cents
  const cents = opts.cents ?? true;
  const w = whole.toLocaleString("en-US");
  if (!cents && frac === 0) return `$${w}`;
  return `$${w}.${Math.round(frac).toString().padStart(2, "0").slice(0, 2)}`;
}

export function usdNum(micro: string): number {
  return Number(BigInt(micro)) / 1e6;
}

export function toMicro(v: number | string): string {
  const s = String(v).trim();
  const [w, f = ""] = s.split(".");
  return (BigInt(w || "0") * 1_000_000n + BigInt((f + "000000").slice(0, 6))).toString();
}

export function date(ms: string | number): string {
  return new Date(Number(ms)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
export function time(ms: string | number): string {
  return new Date(Number(ms)).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
export function ago(ms: string | number): string {
  const s = Math.max(0, Math.round((Date.now() - Number(ms)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function daysTo(ms: string | number): number {
  return Math.ceil((Number(ms) - Date.now()) / 86_400_000);
}

export function short(account: string, max = 22): string {
  return account.length <= max ? account : `${account.slice(0, max - 9)}…${account.slice(-6)}`;
}

/** Annualised yield for buying at `price` and collecting `face` in `days`. */
export function apr(face: string, price: string, days: number): number | null {
  if (days <= 0) return null;
  const f = usdNum(face), p = usdNum(price);
  if (p <= 0) return null;
  return ((f - p) / p) * (365 / days) * 100;
}
export function discountPct(face: string, price: string): number {
  return ((usdNum(face) - usdNum(price)) / usdNum(face)) * 100;
}

export const STATUS_LABEL: Record<Status, string> = {
  Creating: "Creating",
  Issued: "Issued",
  Confirmed: "Confirmed",
  Listed: "For sale",
  Paid: "Paid",
  Claiming: "Claiming",
  Claimed: "Settled",
};

export function isOpen(i: Invoice): boolean {
  return i.status === "Issued" || i.status === "Confirmed" || i.status === "Listed";
}

export function accountUrl(explorer: string, account: string): string {
  return `${explorer}/address/${account}`;
}

/** Open and past its due date: the client has not paid. */
export function isOverdue(i: { status: Status; due_ms: string }): boolean {
  return (i.status === "Issued" || i.status === "Confirmed" || i.status === "Listed") && Number(i.due_ms) < Date.now();
}
export function daysLate(ms: string | number): number {
  return Math.max(0, Math.floor((Date.now() - Number(ms)) / 86_400_000));
}

/** Invoices created by the guided demo or the e2e script (as opposed to the standing market). */
export function isDemoRun(i: { number: string }): boolean {
  return /^(DEMO|E2E|DAO)-/i.test(i.number);
}
