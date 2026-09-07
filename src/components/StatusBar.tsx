import { bytes, count, duration } from "../lib/format";
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
  const scanning = progress.running;

  return (
    <div className="status">
      <span>
        {scanning ? (
          <>
            <b className="num">{count(progress.files)}</b> files
          </>
        ) : summary?.hasIndex ? (
          <>
            <b className="num">{count(summary.files)}</b> files ·{" "}
            <b className="num">{count(summary.folders)}</b> folders
          </>
        ) : (
          "No scan yet"
        )}
      </span>

      {visibleCount > 0 && !scanning && (
        <span>
          <b className="num">{count(visibleCount)}</b> shown ·{" "}
          <b className="num">{bytes(visibleBytes, 1)}</b>
        </span>
      )}

      <span className="status__center">
        {scanning ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span className="spinner" />
            <span>
              Scanning {shorten(progress.current)} — {bytes(progress.alloc, 1)} analyzed
            </span>
          </span>
        ) : progress.done ? (
          progress.cancelled ? (
            `Scan stopped after ${duration(progress.elapsedMs)}`
          ) : (
            <>
              Scan completed in {duration(progress.elapsedMs)}
              {progress.spotlightDone
                ? ` · ${count(progress.spotlightHits)} usage dates from Spotlight`
                : progress.scanner === "macos-getattrlistbulk"
                  ? " · reading usage metadata…"
                  : ""}
            </>
          )
        ) : (
          ""
        )}
      </span>

      <span className="status__right">
        {freedBytes > 0 && !scanning && (
          <span title="These items are in the Trash. The numbers above still describe the tree as it was scanned.">
            Freed <b className="num">{bytes(freedBytes, 1)}</b> ·{" "}
            <span className="status__link" onClick={onRescan}>
              rescan to refresh
            </span>
          </span>
        )}
        {selectionCount > 0 && (
          <span>
            <b className="num">{count(selectionCount)}</b> selected ·{" "}
            <b className="num">{bytes(selectionBytes, 1)}</b>
          </span>
        )}
        {denied && denied.count > 0 && (
          <span className="status__warn" title={denied.samples.join("\n")}>
            Skipped <b className="num">{count(denied.count)}</b>
            {!denied.fullDiskAccess && (
              <>
                {" · "}
                <span className="status__link" onClick={onOpenFda}>
                  Grant Full Disk Access
                </span>
              </>
            )}
          </span>
        )}
        {scanning && progress.skipped > 0 && (
          <span className="status__warn">
            Skipped <b className="num">{count(progress.skipped)}</b>
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
