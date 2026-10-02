// Small inline SVG icons (decorative: the words next to them carry the meaning).
const PATHS = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5.2M12 16.3v.1" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6 18L18 6" />
    </>
  ),
  x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  back: <path d="M15 6l-6 6 6 6" />,
  out: <path d="M7 17L17 7M9 7h8v8" />,
  in: <path d="M17 7L7 17M15 17H7V9" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="10" height="11" rx="2" />
      <path d="M15.5 8.5v-1.5a2 2 0 0 0-2-2h-6a2 2 0 0 0-2 2v8.5a2 2 0 0 0 2 2h1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 7.7v.1" />
    </>
  ),
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  lock: (
    <>
      <rect x="5.5" y="10.5" width="13" height="9" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  receipt: <path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2zM9.5 8.5h5M9.5 12h5" />,
};

export function Icon({ name, size = 16, className }) {
  return (
    <svg
      className={`icon${className ? " " + className : ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

// The Tally mark: four strokes and the one across them.
export function TallyMark({ size = 28 }) {
  return (
    <svg className="tally-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
        <path d="M9 8v16M14 8v16M19 8v16M24 8v16" />
      </g>
      <path className="tally-slash" d="M5 22L27 10" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Initial({ name, className = "" }) {
  const ch = (name || "?").trim().charAt(0).toUpperCase();
  return (
    <span className={`avatar ${className}`} aria-hidden="true">
      {ch}
    </span>
  );
}
