import { count } from "../lib/format";
import { useI18n, type Key } from "../lib/i18n";
import type { HogMode, Mode, QuickFilter } from "../lib/types";

const TABS: { id: Mode; key: Key }[] = [
  { id: "tree", key: "mode.tree" },
  { id: "hogs", key: "mode.hogs" },
  { id: "types", key: "mode.types" },
];

export const HOG_MODES: { id: HogMode; key: Key }[] = [
  { id: "largestFirst", key: "hog.largestFirst" },
  { id: "longestUnused", key: "hog.longestUnused" },
  { id: "largestAndUnused", key: "hog.largestAndUnused" },
  { id: "recentlyUsed", key: "hog.recentlyUsed" },
  { id: "recentlyModified", key: "hog.recentlyModified" },
];

const QUICK: { id: QuickFilter; key: Key }[] = [
  { id: "all", key: "filter.all" },
  { id: "size1G", key: "filter.size1G" },
  { id: "size5G", key: "filter.size5G" },
  { id: "size10G", key: "filter.size10G" },
  { id: "unused3m", key: "filter.unused3m" },
  { id: "unused6m", key: "filter.unused6m" },
  { id: "unused1y", key: "filter.unused1y" },
  { id: "unused2y", key: "filter.unused2y" },
];

interface Props {
  mode: Mode;
  onMode: (m: Mode) => void;
  counts: { folders: number; files: number; types: number };
  hogMode: HogMode;
  onHogMode: (m: HogMode) => void;
  quick: QuickFilter;
  onQuick: (q: QuickFilter) => void;
  onExpandDepth: (d: number) => void;
  onCollapseAll: () => void;
  treemapVisible: boolean;
  onToggleTreemap: () => void;
}

export function ModeBar({
  mode,
  onMode,
  counts,
  hogMode,
  onHogMode,
  quick,
  onQuick,
  onExpandDepth,
  onCollapseAll,
  treemapVisible,
  onToggleTreemap,
}: Props) {
  const { t } = useI18n();
  return (
    <div className="modes">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={tab.id === mode ? "tab tab--active" : "tab"}
          onClick={() => onMode(tab.id)}
        >
          {t(tab.key)}
          {tab.id === "tree" && counts.folders > 0 && (
            <span className="tab__count">{count(counts.folders)}</span>
          )}
          {tab.id === "hogs" && counts.files > 0 && (
            <span className="tab__count">{count(counts.files)}</span>
          )}
          {tab.id === "types" && counts.types > 0 && (
            <span className="tab__count">{count(counts.types)}</span>
          )}
        </button>
      ))}

      <div className="modes__tools">
        {mode === "tree" && (
          <>
            <button className="chip" onClick={() => onExpandDepth(3)}>
              {t("tree.expand", { n: 3 })}
            </button>
            <button className="chip" onClick={() => onExpandDepth(5)}>
              {t("tree.expand", { n: 5 })}
            </button>
            <button className="chip" onClick={onCollapseAll}>
              {t("tree.collapse")}
            </button>
          </>
        )}

        {mode === "hogs" && (
          <>
            <select
              className="select"
              value={hogMode}
              onChange={(e) => onHogMode(e.target.value as HogMode)}
            >
              {HOG_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {t(m.key)}
                </option>
              ))}
            </select>
            <div className="chips">
              {QUICK.map((q) => (
                <button
                  key={q.id}
                  className={q.id === quick ? "chip chip--on" : "chip"}
                  onClick={() => onQuick(q.id)}
                >
                  {t(q.key)}
                </button>
              ))}
            </div>
          </>
        )}

        <button
          className={treemapVisible ? "chip chip--on" : "chip"}
          onClick={onToggleTreemap}
        >
          {t("treemap.show")}
        </button>
      </div>
    </div>
  );
}
