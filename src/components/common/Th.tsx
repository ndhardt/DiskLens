function Arrow({ dir }: { dir: "asc" | "desc" }) {
  return (
    <svg width="7" height="4" viewBox="0 0 7 4" className="th__arrow" aria-hidden>
      <path d={dir === "desc" ? "M0 0h7L3.5 4z" : "M0 4h7L3.5 0z"} fill="currentColor" />
    </svg>
  );
}

interface Props {
  label: string;
  width?: number;
  flex?: boolean;
  num?: boolean;
  sorted?: "asc" | "desc" | null;
  onClick?: () => void;
  title?: string;
}

export function Th({ label, width, flex, num, sorted, onClick, title }: Props) {
  const cls = [
    "th",
    num ? "th--num" : "",
    flex ? "th--flex" : "",
    sorted ? "th--sorted" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={cls}
      style={flex ? undefined : { width, flexBasis: width }}
      onClick={onClick}
      title={title ?? label}
      role="columnheader"
    >
      {num && sorted ? <Arrow dir={sorted} /> : null}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      {!num && sorted ? <Arrow dir={sorted} /> : null}
    </div>
  );
}
