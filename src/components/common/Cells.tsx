import {
  AGE_COLOR,
  ageBucket,
  ageFraction,
  bytes,
  CATEGORY_COLOR,
  dateTimeLong,
  pct,
  sourceLabel,
  unusedFor,
  unusedLong,
} from "../../lib/format";
import type { LastUsedSource } from "../../lib/types";

export function SizeCell({ value, width }: { value: number; width: number }) {
  return (
    <div className="cell cell--num num" style={{ width, flexBasis: width }}>
      {bytes(value)}
    </div>
  );
}

/** Percentage of the parent folder, with the bar drawn behind the number. */
export function PctCell({ value, width }: { value: number; width: number }) {
  return (
    <div className="cell cell--num" style={{ width, flexBasis: width }}>
      <div className="pct">
        <div className="pct__bar" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
        <span className="pct__num">{pct(value)}</span>
      </div>
    </div>
  );
}

/**
 * Idle age with a small desaturated bar. Deliberately not alarming: this is a
 * "look here first" hint, not a warning.
 */
export function UnusedCell({
  lastUsed,
  source,
  width,
  now,
}: {
  lastUsed: number | null;
  source?: LastUsedSource;
  width: number;
  now: number;
}) {
  const bucket = ageBucket(lastUsed, now);
  const color = AGE_COLOR[bucket];
  const frac = ageFraction(lastUsed, now);
  const title =
    lastUsed == null
      ? "Last used: Unknown"
      : `Last used:\n${dateTimeLong(lastUsed)}\n\nUnused:\n${unusedLong(lastUsed, now)}${
          source ? `\n\nSource:\n${sourceLabel(source)}` : ""
        }`;
  return (
    <div className="cell cell--num" style={{ width, flexBasis: width }} title={title}>
      <div className="age">
        <span className="age__text" style={{ color: lastUsed == null ? undefined : color }}>
          {unusedFor(lastUsed, now)}
        </span>
        <div className="age__bar">
          <div
            className="age__fill"
            style={{ width: `${frac * 100}%`, background: color }}
          />
        </div>
      </div>
    </div>
  );
}

export function ScoreCell({ value, width }: { value: number; width: number }) {
  return (
    <div
      className="cell"
      style={{ width, flexBasis: width }}
      title={`Review priority ${value} of 100 — large and long untouched. Not a deletion recommendation.`}
    >
      <div className="score">
        <div className="score__track">
          <div className="score__fill" style={{ width: `${value}%` }} />
        </div>
        <span className="score__num num">{value}</span>
      </div>
    </div>
  );
}

export function CategoryDot({ category }: { category: string }) {
  return <span className="dot" style={{ background: CATEGORY_COLOR[category] ?? "#8e8e98" }} />;
}
