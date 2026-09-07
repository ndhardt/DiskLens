import { count } from "../lib/format";
import type { HogMode, Mode, QuickFilter } from "../lib/types";

const TABS: { id: Mode; label: string }[] = [
  { id: "tree", label: "Tree" },
  { id: "hogs", label: "Space Hogs" },
  { id: "types", label: "File Types" },
];

const HOG_MODES: { id: HogMode; label: string }[] = [
  { id: "largestFirst", label: "Largest First" },
  { id: "longestUnused", label: "Longest Unused" },
  { id: "largestAndUnused", label: "Largest + Unused" },
  { id: "recentlyUsed", label: "Recently Used" },
  { id: "recentlyModified", label: "Recently Modified" },
];

const QUICK: { id: QuickFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "size1G", label: "> 1 GB" },
  { id: "size5G", label: "> 5 GB" },
  { id: "size10G", label: "> 10 GB" },
  { id: "unused3m", label: "Unused 3m+" },
  { id: "unused6m", label: "Unused 6m+" },
  { id: "unused1y", label: "Unused 1y+" },
  { id: "unused2y", label: "Unused 2y+" },
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
  return (
    <div className="modes">
      {TABS.map((t) => (
        <button
          key={t.id}
          className={t.id === mode ? "tab tab--active" : "tab"}
          onClick={() => onMode(t.id)}
        >
          {t.label}
          {t.id === "tree" && counts.folders > 0 && (
            <span className="tab__count">{count(counts.folders)}</span>
          )}
          {t.id === "hogs" && counts.files > 0 && (
            <span className="tab__count">{count(counts.files)}</span>
          )}
          {t.id === "types" && counts.types > 0 && (
            <span className="tab__count">{count(counts.types)}</span>
          )}
        </button>
      ))}

      <div className="modes__tools">
        {mode === "tree" && (
          <>
            <button className="chip" onClick={() => onExpandDepth(3)} title="Expand three levels">
              Expand 3
            </button>
            <button className="chip" onClick={() => onExpandDepth(5)} title="Expand five levels">
              Expand 5
            </button>
            <button className="chip" onClick={onCollapseAll} title="Collapse everything">
              Collapse
            </button>
          </>
        )}

        {mode === "hogs" && (
          <>
            <select
              className="select"
              value={hogMode}
              onChange={(e) => onHogMode(e.target.value as HogMode)}
              title="Ranking"
            >
              {HOG_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
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
                  {q.label}
                </button>
              ))}
            </div>
          </>
        )}

        <button
          className={treemapVisible ? "chip chip--on" : "chip"}
          onClick={onToggleTreemap}
          title="Show or hide the Treemap"
        >
          Treemap
        </button>
      </div>
    </div>
  );
}
