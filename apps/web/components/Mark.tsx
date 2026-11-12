export function Mark({ title }: { title?: string }) {
  return (
    <svg viewBox="0 0 32 32" role={title ? "img" : "presentation"} aria-label={title} aria-hidden={title ? undefined : true}>
      <g transform="rotate(-8 16 16)">
        <rect x="3.5" y="7.5" width="25" height="17" fill="none" stroke="#c93a1e" strokeWidth="2.6" />
        <path d="M10 12l5 4-5 4M17 12l5 4-5 4" fill="none" stroke="#c93a1e" strokeWidth="2.6" strokeLinecap="square" />
      </g>
    </svg>
  );
}
