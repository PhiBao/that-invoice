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

export function StatusStamp({ status, big }: { status: Status; big?: boolean }) {
  // key forces the thud animation to replay whenever the status changes
  return (
    <span key={status} className={`stamp-tag ${TONE[status]} ${big ? "big" : ""}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
