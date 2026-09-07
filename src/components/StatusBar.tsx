import { bytes, count, duration } from "../lib/format";
import { useI18n } from "../lib/i18n";
import type { DeniedInfo, DriveSummary, ScanProgress } from "../lib/types";

interface Props {
  progress: ScanProgress;
  summary: DriveSummary | null;
  denied: DeniedInfo | null;
  selectionCount: number;
  selectionBytes: number;
  visibleCount: number;
  visibleBytes: number;
  /// Bytes trashed since the scan, which the index does not know about yet.
  freedBytes: number;
  onRescan: () => void;
  onOpenFda: () => void;
}

export function StatusBar({
  progress,
  summary,
  denied,
  selectionCount,
  selectionBytes,
  visibleCount,
  visibleBytes,
  freedBytes,
  onRescan,
  onOpenFda,
}: Props) {
  const { t } = useI18n();
  const scanning = progress.running;

  return (
    <div className="status">
      <span>
        {scanning ? (
          <>
            <b className="num">{count(progress.files)}</b> {t("status.files")}
          </>
        ) : summary?.hasIndex ? (
          <>
            <b className="num">{count(summary.files)}</b> {t("status.files")} ·{" "}
            <b className="num">{count(summary.folders)}</b> {t("status.folders")}
          </>
        ) : (
          t("status.noScan")
        )}
      </span>

      {visibleCount > 0 && !scanning && (
        <span>
          <b className="num">{count(visibleCount)}</b> {t("status.shown")} ·{" "}
          <b className="num">{bytes(visibleBytes, 1)}</b>
        </span>
      )}

      <span className="status__center">
        {scanning ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span className="spinner" />
            <span>
              {t("status.scanning", {
                path: shorten(progress.current),
                size: bytes(progress.alloc, 1),
              })}
            </span>
          </span>
        ) : progress.done ? (
          progress.cancelled ? (
            t("status.stopped", { t: duration(progress.elapsedMs) })
          ) : (
            <>
              {t("status.completed", { t: duration(progress.elapsedMs) })}
              {progress.spotlightDone
                ? ` · ${t("status.spotlight", { n: count(progress.spotlightHits) })}`
                : progress.scanner === "macos-getattrlistbulk"
                  ? ` · ${t("status.reading")}`
                  : ""}
            </>
          )
        ) : (
          ""
        )}
      </span>

      <span className="status__right">
        {freedBytes > 0 && !scanning && (
          <span title={t("status.staleHint")}>
            {t("status.freed", { size: bytes(freedBytes, 1) })} ·{" "}
            <span className="status__link" onClick={onRescan}>
              {t("status.rescanRefresh")}
            </span>
          </span>
        )}
        {selectionCount > 0 && (
          <span>
            <b className="num">{count(selectionCount)}</b> {t("status.selected")} ·{" "}
            <b className="num">{bytes(selectionBytes, 1)}</b>
          </span>
        )}
        {denied && denied.count > 0 && (
          <span className="status__warn" title={denied.samples.join("\n")}>
            {t("status.skipped")} <b className="num">{count(denied.count)}</b>
            {!denied.fullDiskAccess && (
              <>
                {" · "}
                <span className="status__link" onClick={onOpenFda}>
                  {t("status.grantFda")}
                </span>
              </>
            )}
          </span>
        )}
        {scanning && progress.skipped > 0 && (
          <span className="status__warn">
            {t("status.skipped")} <b className="num">{count(progress.skipped)}</b>
          </span>
        )}
      </span>
    </div>
  );
}

function shorten(p: string): string {
  if (!p) return "…";
  if (p.length <= 58) return p;
  const parts = p.split("/");
  return parts.length > 4 ? `…/${parts.slice(-3).join("/")}` : `…${p.slice(-55)}`;
}
