import { bytes, count } from "../../lib/format";
import type { PagedRows } from "../../lib/hooks";
import type { FileRow, SortSpec } from "../../lib/types";
import { FileTable, FILE_LIST_COLUMNS } from "../common/FileTable";

interface Props {
  folder: string | null;
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
  globalMatches: number | null;
  onGoGlobal: () => void;
  width: number;
}

export function FileList({
  folder,
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
  globalMatches,
  onGoGlobal,
  width,
}: Props) {
  return (
    <div className="pane" style={{ flex: `0 0 ${width}px`, width }}>
      <div className="pane__caption">
        <span>FILES</span>
        <span className="pane__caption-sep">·</span>
        <span title={folder ?? ""}>{folder ? shorten(folder) : "—"}</span>
        <span className="pane__caption-sep">·</span>
        <span>
          <b>{count(rows.total)}</b> · <b>{bytes(rows.totalSize, 1)}</b>
        </span>
        {query && globalMatches != null && globalMatches > rows.total && (
          <>
            <span className="pane__caption-sep">·</span>
            <span className="status__link" onClick={onGoGlobal}>
              {count(globalMatches)} drive-wide
            </span>
          </>
        )}
      </div>
      <FileTable
        columns={FILE_LIST_COLUMNS}
        rows={rows}
        sort={sort}
        onSort={onSort}
        selected={selected}
        onRowMouseDown={onRowMouseDown}
        onContext={onContext}
        onActivate={onActivate}
        onKeyDown={onKeyDown}
        now={now}
        scrollTo={scrollTo}
        focusIndex={focusIndex}
        empty={
          <div className="empty">
            <div className="empty__title">
              {query ? "No matches in this folder" : "This folder holds no files directly"}
            </div>
            <div>
              {query
                ? "Clear the search or look drive-wide in Space Hogs."
                : "Open a subfolder on the left to see its contents."}
            </div>
          </div>
        }
      />
    </div>
  );
}

function shorten(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-2).join("/")}` : p;
}
