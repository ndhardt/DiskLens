import { bytes, count, pct } from "../lib/format";
import type { DriveSummary, ScanProgress, VolumeInfo } from "../lib/types";

interface Props {
  volume: VolumeInfo | null;
  summary: DriveSummary | null;
  progress: ScanProgress;
}

export function DriveOverview({ volume, summary, progress }: Props) {
  const scanning = progress.running;
  const capacity = summary?.hasIndex ? summary.capacity : volume?.total ?? 0;
  const free = summary?.hasIndex ? summary.free : volume?.free ?? 0;
  const used = capacity > 0 ? capacity - free : 0;
  const usedPct = capacity > 0 ? (used / capacity) * 100 : 0;

  // While scanning, the bar shows how much of the volume we have accounted for
  // so far — it fills as the walk progresses instead of sitting still.
  const scannedPct = capacity > 0 ? Math.min(100, (progress.alloc / capacity) * 100) : 0;
  const fill = scanning ? scannedPct : usedPct;

  return (
    <div className="drive">
      <div className="drive__id">
        <div className="drive__name">{volume?.name ?? summary?.name ?? "No volume"}</div>
        <div className="drive__sub num">
          {capacity > 0 ? `${bytes(capacity, 1)} ${volume?.fsType ?? summary?.fsType ?? ""}` : "—"}
        </div>
      </div>

      <div className="drive__stats">
        <div className="stat">
          <span className="stat__label">USED</span>
          <span className="stat__value num">{capacity > 0 ? bytes(used, 1) : "—"}</span>
        </div>
        <div className="stat">
          <span className="stat__label">FREE</span>
          <span className="stat__value stat__value--dim num">
            {capacity > 0 ? bytes(free, 1) : "—"}
          </span>
        </div>
        <div className="stat">
          <span className="stat__label">{scanning ? "SCANNED" : "ANALYZED"}</span>
          <span className="stat__value stat__value--dim num">
            {scanning ? bytes(progress.alloc, 1) : summary?.hasIndex ? bytes(summary.scannedAlloc, 1) : "—"}
          </span>
        </div>
        <div className="stat">
          <span className="stat__label">FILES</span>
          <span className="stat__value stat__value--dim num">
            {scanning
              ? count(progress.files)
              : summary?.hasIndex
                ? count(summary.files)
                : "—"}
          </span>
        </div>
      </div>

      <div className="drive__pct num">
        {capacity > 0 ? (
          <>
            {pct(usedPct, 1).replace("%", "")}
            <span>%</span>
          </>
        ) : (
          "—"
        )}
      </div>

      <div className="drive__bar">
        <div
          className={scanning ? "drive__bar-fill drive__bar-fill--scanning" : "drive__bar-fill"}
          style={{ width: `${Math.min(100, fill)}%` }}
        />
      </div>
    </div>
  );
}
