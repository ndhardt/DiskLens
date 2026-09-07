import { useState } from "react";
import { bytes } from "../lib/format";
import { useDismiss } from "../lib/hooks";
import { useI18n } from "../lib/i18n";
import type { Mode, VolumeInfo } from "../lib/types";
import {
  IconCheck,
  IconChevron,
  IconDrive,
  IconGear,
  IconRefresh,
  IconSearch,
  IconStop,
} from "./common/Icons";

interface Props {
  volumes: VolumeInfo[];
  volume: VolumeInfo | null;
  onVolume: (v: VolumeInfo) => void;
  scanning: boolean;
  hasIndex: boolean;
  onScan: () => void;
  onStop: () => void;
  onRefresh: () => void;
  search: string;
  onSearch: (s: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onSettings: () => void;
  mode: Mode;
}

export function Toolbar({
  volumes,
  volume,
  onVolume,
  scanning,
  hasIndex,
  onScan,
  onStop,
  onRefresh,
  search,
  onSearch,
  searchRef,
  onSettings,
  mode,
}: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const popRef = useDismiss(open, () => setOpen(false));
  const placeholder = mode === "types" ? t("search.types") : t("search.files");

  return (
    <div className="toolbar">
      <div className="toolbar__gutter" />

      <div className="volume-select" ref={popRef}>
        <button
          className="ctl volume-select__button"
          onClick={() => setOpen((o) => !o)}
          title={t("vol.pick")}
        >
          <IconDrive />
          <span className="volume-select__name">{volume?.name ?? t("vol.select")}</span>
          <span className="volume-select__meta num">
            {volume ? bytes(volume.total, 0) : ""}
          </span>
          <IconChevron open={open} />
        </button>
        {open && (
          <div
            className="popover"
            style={{ marginTop: 4, minWidth: 260 }}
            role="listbox"
          >
            {volumes.map((v) => (
              <button
                key={v.path}
                className="vol-item"
                onClick={() => {
                  onVolume(v);
                  setOpen(false);
                }}
              >
                <IconDrive />
                <span className="vol-item__main">
                  <span className="vol-item__name">{v.name}</span>
                  <span className="vol-item__sub">
                    {bytes(v.total, 1)} {v.fsType} · {bytes(v.free, 1)} {t("vol.free")}
                    {v.readOnly ? ` · ${t("vol.readonly")}` : ""}
                  </span>
                </span>
                {volume?.path === v.path ? (
                  <span className="vol-item__check">
                    <IconCheck />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        className="ctl ctl--primary"
        onClick={onScan}
        disabled={scanning || !volume}
        title={`${t("app.scan")} (⌘R)`}
      >
        {t("app.scan")}
      </button>
      {scanning && (
        <button className="ctl ctl--danger" onClick={onStop} title={t("app.stop")}>
          <IconStop />
          {t("app.stop")}
        </button>
      )}

      <div className="toolbar__spacer" />

      <div className="search">
        <span className="search__icon">
          <IconSearch />
        </span>
        <input
          ref={searchRef}
          value={search}
          spellCheck={false}
          placeholder={placeholder}
          onChange={(e) => onSearch(e.target.value)}
          aria-label={t("search.files")}
        />
        {search && (
          <button className="search__clear" onClick={() => onSearch("")} title={`${t("app.clear")} (Esc)`}>
            ×
          </button>
        )}
      </div>

      <button
        className="ctl ctl--icon"
        onClick={onRefresh}
        disabled={scanning || !hasIndex}
        title={`${t("app.rescan")} (⌘R)`}
      >
        <IconRefresh />
      </button>
      <button className="ctl ctl--icon" onClick={onSettings} title={t("app.settings")}>
        <IconGear />
      </button>
    </div>
  );
}
