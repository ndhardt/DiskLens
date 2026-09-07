import { bytes, count } from "../../lib/format";
import type { PagedRows } from "../../lib/hooks";
import type { FileRow, HogMode, SortSpec } from "../../lib/types";
import { FileTable, HOG_COLUMNS } from "../common/FileTable";

const MODE_LABEL: Record<HogMode, string> = {
  largestFirst: "BIGGEST ITEMS",
  longestUnused: "LONGEST UNUSED",
  largestAndUnused: "LARGEST + UNUSED",
  recentlyUsed: "RECENTLY USED",
  recentlyModified: "RECENTLY MODIFIED",
};

interface Props {
  mode: HogMode;
  rows: PagedRows<FileRow>;
  sort: SortSpec;
  onSort: (s: SortSpec) => void;
  selected: Set<number>;
  onRowMouseDown: (index: number, row: FileRow, e: React.MouseEvent) => void;
  onContext: (row: FileRow, e: React.MouseEvent) => void;
  onActivate: (row: FileRow) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  now: number;
  scrollTo: number | null;
  focusIndex: number | null;
  query: string;
  hasIndex: boolean;
}

export function SpaceHogs({
  mode,
  rows,
  sort,
  onSort,
  selected,
  onRowMouseDown,
  onContext,
  onActivate,
  onKeyDown,
  now,
  scrollTo,
  focusIndex,
  query,
  hasIndex,
}: Props) {
  return (
    <div className="pane" style={{ flex: "1 1 auto" }}>
      <div className="pane__caption">
        <span>{MODE_LABEL[mode]}</span>
        <span className="pane__caption-sep">·</span>
        <span>
          <b>{count(rows.total)}</b> items
        </span>
        <span className="pane__caption-sep">·</span>
        <span>
          <b>{bytes(rows.totalSize, 1)}</b>
        </span>
        {mode === "largestAndUnused" && (
          <>
            <span className="pane__caption-sep">·</span>
            <span>ranked by review priority — size weighted by how long untouched</span>
          </>
        )}
        {query && (
          <>
            <span className="pane__caption-sep">·</span>
            <span>matching “{query}”</span>
          </>
        )}
      </div>
      <FileTable
        columns={HOG_COLUMNS}
        rows={rows}
        sort={sort}
        onSort={onSort}
        selected={selected}
        onRowMouseDown={onRowMouseDown}
        onContext={onContext}
        onActivate={onActivate}
        onKeyDown={onKeyDown}
        large
        showSizeBar
        now={now}
        scrollTo={scrollTo}
        focusIndex={focusIndex}
        empty={
          <div className="empty">
            <div className="empty__title">
              {hasIndex ? "Nothing matches" : "Nothing scanned yet"}
            </div>
            <div>
              {hasIndex
                ? "Try a wider filter, or clear the search."
                : "Pick a volume and press Scan."}
            </div>
          </div>
        }
      />
    </div>
  );
}
