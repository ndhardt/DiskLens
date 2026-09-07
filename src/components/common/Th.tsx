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
      {num && sorted ? <span className="th__arrow">{sorted === "desc" ? "▼" : "▲"}</span> : null}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      {!num && sorted ? <span className="th__arrow">{sorted === "desc" ? "▼" : "▲"}</span> : null}
    </div>
  );
}
