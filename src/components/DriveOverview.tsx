import { bytes, count, pct } from "../lib/format";
import { useI18n } from "../lib/i18n";
import type { DriveSummary, ScanProgress, VolumeInfo } from "../lib/types";

interface Props {
  volume: VolumeInfo | null;
  summary: DriveSummary | null;
  progress: ScanProgress;
}

export function DriveOverview({ volume, summary, progress }: Props) {
  const { t } = useI18n();
  const scanning = progress.running;
  const capacity = summary?.hasIndex ? summary.capacity : volume?.total ?? 0;
  const free = summary?.hasIndex ? summary.free : volume?.free ?? 0;
  const used = capacity > 0 ? capacity - free : 0;
  const usedPct = capacity > 0 ? (used / capacity) * 100 : 0;

  // While scanning the bar shows how much of the volume is accounted for, so
  // it fills as the walk progresses instead of sitting still.
  const scannedPct = capacity > 0 ? Math.min(100, (progress.alloc / capacity) * 100) : 0;
  const fill = scanning ? scannedPct : usedPct;

  return (
    <div className="drive">
      <div className="drive__id">
        <div className="drive__name">{volume?.name ?? summary?.name ?? t("vol.none")}</div>
        <div className="drive__sub num">
          {capacity > 0 ? `${bytes(capacity, 1)} ${volume?.fsType ?? summary?.fsType ?? ""}` : "—"}
        </div>
      </div>

      <div className="drive__stats">
        <div className="stat">
          <span className="stat__label">{t("drive.used")}</span>
          <span className="stat__value num">{capacity > 0 ? bytes(used, 1) : "—"}</span>
        </div>
        <div className="stat">
          <span className="stat__label">{t("drive.free")}</span>
          <span className="stat__value stat__value--dim num">
            {capacity > 0 ? bytes(free, 1) : "—"}
          </span>
        </div>
        <div className="stat">
          <span className="stat__label">
            {scanning ? t("drive.scanned") : t("drive.analyzed")}
          </span>
          <span className="stat__value stat__value--dim num">
            {scanning ? bytes(progress.alloc, 1) : summary?.hasIndex ? bytes(summary.scannedAlloc, 1) : "—"}
          </span>
        </div>
        <div className="stat">
          <span className="stat__label">{t("drive.files")}</span>
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
