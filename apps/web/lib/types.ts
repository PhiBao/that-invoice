export type Status = "Creating" | "Issued" | "Confirmed" | "Listed" | "Paid" | "Claiming" | "Claimed";
export type Kind = "Issued" | "Confirmed" | "Listed" | "Delisted" | "Sold" | "Transferred" | "Paid" | "ClaimFailed" | "Claimed";

export interface Endorsement {
  kind: Kind;
  by: string;
  counterparty: string | null;
  amount: string | null;
  at_ms: string;
}

export interface Invoice {
  id: string;
  seq: string;
  issuer: string;
  debtor: string;
  owner: string;
  number: string;
  amount: string; // micro-USDC
  due_ms: string;
  doc_hash: string;
  status: Status;
  price: string | null;
  received: string;
  issued_ms: string;
  paid_ms: string | null;
  log: Endorsement[];
}

export interface DebtorRecord {
  confirmed: number;
  paid: number;
  paid_on_time: number;
  paid_total: string;
  late_ms_total: string;
}

export interface Persona {
  key: "studio" | "acme" | "fund";
  account: string;
  name: string;
  role: string;
  blurb: string;
  usdc: string;
  can_sign: boolean;
}

export interface LedgerState {
  network: string;
  registry: string;
  token: string;
  explorer: string;
  stale: boolean;
  personas: Persona[];
  invoices: Invoice[];
  debtors: Record<string, DebtorRecord>;
  registry_config: { token: string; invoice_code_hash: string; invoices: string } | null;
}

export interface TxOutcome {
  ok: boolean;
  hash: string;
  explorer_url: string;
  error: string | null;
  events: unknown[];
  gas_tgas: number;
}

export interface Quote {
  chain: string;
  label: string;
  amount_in_formatted: string;
  amount_in_usd: string;
  eta_seconds: number;
}
export interface QuoteResponse {
  note: string;
  fetched_at: string;
  quotes: Quote[];
  failed: { chain: string; label: string; error: string }[];
}
