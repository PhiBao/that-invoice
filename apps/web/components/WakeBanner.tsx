"use client";
import { useEffect, useState } from "react";
import { useLedger } from "@/lib/store";

/** Shown while the first request after a scale-to-zero cold start is still waiting for the API. */
export function WakeBanner() {
  const { waking, state } = useLedger();
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!waking) { setSecs(0); return; }
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [waking]);
  if (state || !waking) return null;
  return (
    <div role="status" style={{ background: "var(--ink)", color: "var(--sheet)", fontSize: 13.5 }}>
      <div className="wrap" style={{ padding: "10px var(--edge)", display: "flex", gap: 12, alignItems: "center" }}>
        <span className="spin" />
        <span>
          Waking the demo server{secs > 4 ? ` (${secs}s)` : ""}. It sleeps when idle to save cost and takes up to 20 seconds to start.
        </span>
      </div>
    </div>
  );
}
