"use client";
import { useLedger } from "@/lib/store";

export function Toasts() {
  const { toasts, dismiss } = useLedger();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`} role={t.tone === "error" ? "alert" : "status"}>
          <b>{t.title}</b>
          {t.detail && <p>{t.detail}</p>}
          <p style={{ display: "flex", gap: 14, marginTop: 6 }}>
            {t.href && (
              <a href={t.href} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 12 }}>
                view transaction ↗
              </a>
            )}
            <button onClick={() => dismiss(t.id)} style={{ background: "none", border: 0, cursor: "pointer", color: "var(--ink-3)", font: "inherit", fontSize: 12, padding: 0 }}>
              dismiss
            </button>
          </p>
        </div>
      ))}
    </div>
  );
}
