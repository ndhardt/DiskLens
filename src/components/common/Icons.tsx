/** Inline stroke icons. */

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const IconSearch = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" {...S}>
    <circle cx="5.2" cy="5.2" r="3.6" />
    <path d="M8 8l2.6 2.6" />
  </svg>
);

export const IconChevron = ({ open }: { open?: boolean }) => (
  <svg width="8" height="8" viewBox="0 0 8 8" style={{ transform: open ? "rotate(180deg)" : undefined }}>
    <path d="M0.6 2.4L4 5.8l3.4-3.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconTriangle = () => (
  <svg width="7" height="8" viewBox="0 0 7 8">
    <path d="M1 0.8L6 4L1 7.2z" fill="currentColor" />
  </svg>
);

export const IconRefresh = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" {...S}>
    <path d="M12 7a5 5 0 1 1-1.6-3.7" />
    <path d="M12.2 1.4v3h-3" />
  </svg>
);

export const IconGear = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" {...S}>
    <circle cx="7" cy="7" r="2.1" />
    <path d="M7 1.2v1.6M7 11.2v1.6M1.2 7h1.6M11.2 7h1.6M2.9 2.9l1.1 1.1M10 10l1.1 1.1M11.1 2.9L10 4M4 10l-1.1 1.1" />
  </svg>
);

export const IconFolder = ({ color = "currentColor" }: { color?: string }) => (
  <svg width="14" height="14" viewBox="0 0 14 14">
    <path
      d="M1.4 3.4c0-.6.4-1 1-1h2.5l1.1 1.3h4.6c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H2.4c-.6 0-1-.4-1-1z"
      fill={color}
      fillOpacity="0.24"
      stroke={color}
      strokeWidth="1.1"
      strokeLinejoin="round"
    />
  </svg>
);

export const IconFile = ({ color = "currentColor" }: { color?: string }) => (
  <svg width="14" height="14" viewBox="0 0 14 14">
    <path
      d="M3.3 1.6h4.4l3 3v7.8c0 .3-.2.5-.5.5H3.3a.5.5 0 0 1-.5-.5V2.1c0-.3.2-.5.5-.5z"
      fill={color}
      fillOpacity="0.2"
      stroke={color}
      strokeWidth="1.1"
      strokeLinejoin="round"
    />
    <path d="M7.6 1.7v3.1h3" fill="none" stroke={color} strokeWidth="1.1" strokeLinejoin="round" />
  </svg>
);

export const IconDrive = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" {...S}>
    <rect x="1.4" y="3.2" width="11.2" height="7.6" rx="1.6" />
    <circle cx="10.1" cy="7" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const IconCheck = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" {...S}>
    <path d="M2 6.3l2.6 2.6L10 3.4" strokeWidth="1.7" />
  </svg>
);

export const IconCloud = () => (
  <svg width="12" height="12" viewBox="0 0 14 14" {...S}>
    <path d="M4 10.6a2.6 2.6 0 0 1-.2-5.2 3.4 3.4 0 0 1 6.5-.6 2.9 2.9 0 0 1 .3 5.8z" />
  </svg>
);

export const IconLock = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" {...S}>
    <rect x="2.4" y="5.2" width="7.2" height="5.2" rx="1.1" />
    <path d="M4.2 5.2V3.9a1.8 1.8 0 0 1 3.6 0v1.3" />
  </svg>
);

export const IconStop = () => (
  <svg width="9" height="9" viewBox="0 0 9 9">
    <rect x="0.5" y="0.5" width="8" height="8" rx="1.4" fill="currentColor" />
  </svg>
);

export const IconTreemap = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" {...S}>
    <rect x="1.2" y="1.2" width="11.6" height="11.6" rx="1.2" />
    <path d="M7.6 1.2v11.6M7.6 6.4h5.2M1.2 8.6h6.4" />
  </svg>
);
