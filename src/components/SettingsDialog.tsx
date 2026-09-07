import { count } from "../lib/format";
import { useI18n } from "../lib/i18n";
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
  const { t } = useI18n();
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    onChange({ ...settings, [k]: v });

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--wide" role="dialog" aria-modal="true">
        <div className="modal__body">
          <h2 className="modal__title" style={{ marginBottom: 4 }}>
            {t("app.settings")}
          </h2>

          <Row label={t("set.language")} hint={t("set.languageHint")}>
            <select
              className="select"
              value={settings.language}
              onChange={(e) => set("language", e.target.value as Settings["language"])}
            >
              <option value="auto">{t("set.auto")}</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
            </select>
          </Row>

          <Toggle
            label={t("set.groupBundles")}
            hint={t("set.groupBundlesHint")}
            on={settings.groupBundles}
            onToggle={() => set("groupBundles", !settings.groupBundles)}
          />

          <Row label={t("set.sizeBasis")} hint={t("set.sizeBasisHint")}>
            <select
              className="select"
              value={settings.sizeBasis}
              onChange={(e) => set("sizeBasis", e.target.value as Settings["sizeBasis"])}
            >
              <option value="allocated">{t("set.allocated")}</option>
              <option value="logical">{t("set.logical")}</option>
            </select>
          </Row>

          <Toggle
            label={t("set.spotlight")}
            hint={t("set.spotlightHint", { n: count(settings.spotlightBudget) })}
            on={settings.spotlightEnrichment}
            onToggle={() => set("spotlightEnrichment", !settings.spotlightEnrichment)}
          />

          <Toggle
            label={t("set.fastScanner")}
            hint={t("set.fastScannerHint")}
            on={settings.fastScanner}
            onToggle={() => set("fastScanner", !settings.fastScanner)}
          />

          <Toggle
            label={t("set.symlinks")}
            hint={t("set.symlinksHint")}
            on={settings.followSymlinks}
            onToggle={() => set("followSymlinks", !settings.followSymlinks)}
          />

          <Toggle
            label={t("set.crossVolumes")}
            hint={t("set.crossVolumesHint")}
            on={settings.crossVolumes}
            onToggle={() => set("crossVolumes", !settings.crossVolumes)}
          />

          <Row
            label={t("set.fda")}
            hint={
              denied?.fullDiskAccess
                ? t("set.fdaGranted")
                : denied?.count
                  ? t("set.fdaMissingN", { n: count(denied.count) })
                  : t("set.fdaMissing")
            }
          >
            <button className="ctl" onClick={onOpenFda}>
              {t("set.openSettings")}
            </button>
          </Row>

          {progress.scanner && (
            <div
              className="modal__text"
              style={{ marginTop: 12, color: "var(--text-muted)", fontSize: 11 }}
            >
              {t("set.scannerUsed", { name: progress.scanner })}
            </div>
          )}
        </div>
        <div className="modal__actions">
          <button className="ctl" onClick={onClose}>
            {t("app.done")}
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
