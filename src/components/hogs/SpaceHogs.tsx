import { bytes, count } from "../../lib/format";
import type { PagedRows } from "../../lib/hooks";
import { useI18n, type Key } from "../../lib/i18n";
import type { FileRow, HogMode, SortSpec } from "../../lib/types";
import { FileTable, HOG_COLUMNS } from "../common/FileTable";

const MODE_TITLE: Record<HogMode, Key> = {
  largestFirst: "hog.title.largestFirst",
  longestUnused: "hog.title.longestUnused",
  largestAndUnused: "hog.title.largestAndUnused",
  recentlyUsed: "hog.title.recentlyUsed",
  recentlyModified: "hog.title.recentlyModified",
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
  const { t } = useI18n();
  return (
    <div className="pane" style={{ flex: "1 1 auto" }}>
      <div className="pane__caption">
        <span>{t(MODE_TITLE[mode])}</span>
        <span className="pane__caption-sep">·</span>
        <span>
          <b>{t("cap.items", { n: count(rows.total) })}</b>
        </span>
        <span className="pane__caption-sep">·</span>
        <span>
          <b>{bytes(rows.totalSize, 1)}</b>
        </span>
        {mode === "largestAndUnused" && (
          <>
            <span className="pane__caption-sep">·</span>
            <span>{t("hog.note")}</span>
          </>
        )}
        {query && (
          <>
            <span className="pane__caption-sep">·</span>
            <span>{t("cap.matching", { q: query })}</span>
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
              {hasIndex ? t("empty.noMatch") : t("empty.noScan")}
            </div>
            <div>{hasIndex ? t("empty.widen") : t("empty.pressScan")}</div>
          </div>
        }
      />
    </div>
  );
}
