import { count } from "../lib/format";
import type { DeniedInfo, ScanProgress, Settings } from "../lib/types";

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  denied: DeniedInfo | null;
  progress: ScanProgress;
  onOpenFda: () => void;
  onClose: () => void;
}

export function SettingsDialog({
  settings,
  onChange,
  denied,
  progress,
  onOpenFda,
  onClose,
}: Props) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    onChange({ ...settings, [k]: v });

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--wide" role="dialog" aria-modal="true">
        <div className="modal__body">
          <h2 className="modal__title" style={{ marginBottom: 4 }}>
            Settings
          </h2>

          <Toggle
            label="Group bundle contents"
            hint="Show Thing.app or a Photos library as one item in Space Hogs instead of thousands of pieces."
            on={settings.groupBundles}
            onToggle={() => set("groupBundles", !settings.groupBundles)}
          />

          <Row
            label="Size basis"
            hint="Allocated is what the file actually occupies on disk. Logical is its length, which is larger for sparse, compressed and cloud-only files."
          >
            <select
              className="select"
              value={settings.sizeBasis}
              onChange={(e) => set("sizeBasis", e.target.value as Settings["sizeBasis"])}
            >
              <option value="allocated">Allocated (on disk)</option>
              <option value="logical">Logical</option>
            </select>
          </Row>

          <Toggle
            label="Read usage dates from Spotlight"
            hint={`Asks Spotlight for kMDItemLastUsedDate on the largest ${count(
              settings.spotlightBudget,
            )} files after a scan. Without it, Unused For falls back to filesystem access time.`}
            on={settings.spotlightEnrichment}
            onToggle={() => set("spotlightEnrichment", !settings.spotlightEnrichment)}
          />

          <Toggle
            label="Fast macOS scanner"
            hint="Reads a whole directory's metadata in one syscall (getattrlistbulk). Falls back automatically if it ever disagrees with the portable scanner."
            on={settings.fastScanner}
            onToggle={() => set("fastScanner", !settings.fastScanner)}
          />

          <Toggle
            label="Follow symbolic links"
            hint="Off by default. Following links double-counts space and can loop."
            on={settings.followSymlinks}
            onToggle={() => set("followSymlinks", !settings.followSymlinks)}
          />

          <Toggle
            label="Cross into other volumes"
            hint="Off by default. When off, a scan stays inside the selected volume group and skips other mounted disks."
            on={settings.crossVolumes}
            onToggle={() => set("crossVolumes", !settings.crossVolumes)}
          />

          <Row
            label="Full Disk Access"
            hint={
              denied?.fullDiskAccess
                ? "Granted. Every readable folder is being scanned."
                : `Not granted. ${
                    denied?.count
                      ? `${count(denied.count)} folders were skipped in the last scan.`
                      : "Some folders will be skipped."
                  }`
            }
          >
            <button className="ctl" onClick={onOpenFda}>
              Open Settings
            </button>
          </Row>

          {progress.scanner && (
            <div
              className="modal__text"
              style={{ marginTop: 12, color: "var(--text-muted)", fontSize: 11 }}
            >
              Last scan used the {progress.scanner} scanner.
            </div>
          )}
        </div>
        <div className="modal__actions">
          <button className="ctl" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="setting-row__main">
        <div className="setting-row__label">{label}</div>
        <div className="setting-row__hint">{hint}</div>
      </div>
      {children}
    </div>
  );
}

function Toggle({
  label,
  hint,
  on,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <Row label={label} hint={hint}>
      <button
        className={on ? "switch switch--on" : "switch"}
        onClick={onToggle}
        role="switch"
        aria-checked={on}
        aria-label={label}
      />
    </Row>
  );
}
