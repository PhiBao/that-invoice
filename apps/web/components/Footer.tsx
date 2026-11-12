"use client";
import { useLedger } from "@/lib/store";

export function Footer() {
  const { state } = useLedger();
  const x = state?.explorer ?? "https://testnet.nearblocks.io";
  return (
    <footer className="foot">
      <div className="wrap">
        <span>Endorse · built at NEAR HACKATHON · MIT licensed</span>
        <span className="mono">
          {state ? (
            <>
              registry <a href={`${x}/address/${state.registry}`} target="_blank" rel="noreferrer">{state.registry}</a> · token{" "}
              <a href={`${x}/address/${state.token}`} target="_blank" rel="noreferrer">{state.token}</a>
            </>
          ) : (
            "connecting to NEAR…"
          )}
        </span>
      </div>
    </footer>
  );
}
