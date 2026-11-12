import type { Status } from "@/lib/types";
import { STATUS_LABEL } from "@/lib/format";

const TONE: Record<Status, string> = {
  Creating: "",
  Issued: "",
  Confirmed: "",
  Listed: "red",
  Paid: "green",
  Claiming: "green",
  Claimed: "green",
};

/** Pass `dueMs` and an open invoice that is past due is stamped OVERDUE instead of its status. */
export function StatusStamp({ status, big, dueMs }: { status: Status; big?: boolean; dueMs?: string }) {
  const open = status === "Issued" || status === "Confirmed" || status === "Listed";
  const overdue = open && dueMs !== undefined && Number(dueMs) < Date.now();
  const label = overdue ? "Overdue" : STATUS_LABEL[status];
  const tone = overdue ? "red" : TONE[status];
  // key forces the thud animation to replay whenever the stamp changes
  return (
    <span key={label} className={`stamp-tag ${tone} ${big ? "big" : ""}`}>
      {label}
    </span>
  );
}
