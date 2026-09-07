import { useMemo, useRef } from "react";
import { fitColumns, type ColumnDef } from "../../lib/columns";
import { bytes, CATEGORY_COLOR, categoryLabel, count, dateTime, pct } from "../../lib/format";
import { useElementSize, type PagedRows } from "../../lib/hooks";
import { useI18n, type T } from "../../lib/i18n";
import type { FileRow, SortKey, SortSpec } from "../../lib/types";
import { ScoreCell, UnusedCell } from "./Cells";
import { IconCloud, IconFile, IconFolder, IconLock } from "./Icons";
import { Th } from "./Th";
import { VirtualTable } from "./VirtualTable";

export type FileColKey =
  | "rank"
  | "name"
  | "size"
  | "alloc"
  | "diskPct"
  | "unused"
  | "lastUsed"
  | "modified"
  | "created"
  | "ext"
  | "path"
  | "kind"
  | "score";

export const FILE_LIST_COLUMNS: ColumnDef<FileColKey, SortKey>[] = [
  { key: "name", labelKey: "col.name", width: 170, flex: true, priority: 100, required: true, sortKey: "name" },
  { key: "size", labelKey: "col.size", width: 90, num: true, priority: 99, required: true, sortKey: "size" },
  { key: "alloc", labelKey: "col.allocated", width: 90, num: true, priority: 30, sortKey: "allocated" },
  { key: "unused", labelKey: "col.unusedFor", width: 105, num: true, priority: 98, required: true, sortKey: "unusedFor" },
  { key: "lastUsed", labelKey: "col.lastUsed", width: 140, num: true, priority: 70, sortKey: "lastUsed" },
  { key: "modified", labelKey: "col.modified", width: 140, num: true, priority: 50, sortKey: "modified" },
  { key: "created", labelKey: "col.created", width: 140, num: true, priority: 20, sortKey: "created" },
  { key: "ext", labelKey: "col.extension", width: 80, priority: 60, sortKey: "extension" },
  { key: "path", labelKey: "col.path", width: 120, flex: true, priority: 10, sortKey: "path" },
];

export const HOG_COLUMNS: ColumnDef<FileColKey, SortKey>[] = [
  { key: "rank", labelKey: "col.rank", width: 42, num: true, priority: 80, required: true },
  { key: "name", labelKey: "col.name", width: 200, flex: true, priority: 100, required: true, sortKey: "name" },
  { key: "size", labelKey: "col.size", width: 105, num: true, priority: 99, required: true, sortKey: "size" },
  { key: "diskPct", labelKey: "col.diskPct", width: 75, num: true, priority: 35, sortKey: "size" },
  { key: "unused", labelKey: "col.unusedFor", width: 110, num: true, priority: 98, required: true, sortKey: "unusedFor" },
  { key: "lastUsed", labelKey: "col.lastUsed", width: 145, num: true, priority: 70, sortKey: "lastUsed" },
  { key: "path", labelKey: "col.path", width: 140, flex: true, priority: 65, sortKey: "path" },
  { key: "kind", labelKey: "col.kind", width: 100, priority: 45, sortKey: "kind" },
  { key: "score", labelKey: "col.cleanupScore", width: 110, priority: 75, sortKey: "cleanupScore" },
];

interface Props {
  columns: ColumnDef<FileColKey, SortKey>[];
  rows: PagedRows<FileRow>;
  sort: SortSpec;
  onSort: (s: SortSpec) => void;
  selected: Set<number>;
  onRowMouseDown: (index: number, row: FileRow, e: React.MouseEvent) => void;
  onContext: (row: FileRow, e: React.MouseEvent) => void;
  onActivate: (row: FileRow) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  large?: boolean;
  showSizeBar?: boolean;
  now: number;
  scrollTo?: number | null;
  empty?: React.ReactNode;
  focusIndex?: number | null;
}

export function FileTable({
  columns,
  rows,
  sort,
  onSort,
  selected,
  onRowMouseDown,
  onContext,
  onActivate,
  onKeyDown,
  large,
  showSizeBar,
  now,
  scrollTo,
  empty,
  focusIndex,
}: Props) {
  const { t } = useI18n();
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const cols = useMemo(() => fitColumns(columns, size.width || 700), [columns, size.width]);
  // Disk % ranks identically to Size and shares its sort key; only the first
  // column claiming a key shows the arrow, or the header reads as two sorts.
  const sortedCol = cols.find((c) => c.sortKey === sort.key)?.key;

  const head = (
    <div className="table__head">
      {cols.map((c) => (
        <Th
          key={c.key}
          label={t(c.labelKey)}
          width={c.width}
          flex={c.flex}
          num={c.num}
          sorted={c.key === sortedCol ? (sort.desc ? "desc" : "asc") : null}
          onClick={() =>
            c.sortKey &&
            onSort(
              c.sortKey === sort.key
                ? { key: sort.key, desc: !sort.desc }
                : { key: c.sortKey, desc: c.key !== "name" && c.key !== "ext" && c.key !== "path" },
            )
          }
        />
      ))}
    </div>
  );

  return (
    <div className="pane" ref={wrapRef} style={{ flex: "1 1 auto" }}>
      <VirtualTable
        rowHeight={large ? 34 : 25}
        large={large}
        total={rows.total}
        onRange={rows.ensure}
        onKeyDown={onKeyDown}
        head={head}
        bodyRef={bodyRef}
        scrollTo={scrollTo}
        empty={empty}
        renderRow={(i, top) => {
          const r = rows.get(i);
          if (!r) return <div className="row" key={i} style={{ top }} />;
          return (
            <FileRowView
              key={`${r.id}-${i}`}
              index={i}
              row={r}
              top={top}
              cols={cols}
              selected={selected.has(r.id)}
              focused={focusIndex === i}
              barFraction={showSizeBar && rows.maxSize > 0 ? Math.max(r.alloc, r.size) / rows.maxSize : 0}
              now={now}
              t={t}
              onMouseDown={onRowMouseDown}
              onContext={onContext}
              onActivate={onActivate}
            />
          );
        }}
      />
    </div>
  );
}

function FileRowView({
  index,
  row,
  top,
  cols,
  selected,
  focused,
  barFraction,
  now,
  t,
  onMouseDown,
  onContext,
  onActivate,
}: {
  index: number;
  row: FileRow;
  top: number;
  cols: ColumnDef<FileColKey, SortKey>[];
  selected: boolean;
  focused: boolean;
  barFraction: number;
  now: number;
  t: T;
  onMouseDown: (index: number, row: FileRow, e: React.MouseEvent) => void;
  onContext: (row: FileRow, e: React.MouseEvent) => void;
  onActivate: (row: FileRow) => void;
}) {
  const color = CATEGORY_COLOR[row.category] ?? "#8e8e98";
  return (
    <div
      className={`row${selected ? " row--selected" : ""}${focused ? " row--focus" : ""}`}
      style={{ top }}
      onMouseDown={(e) => onMouseDown(index, row, e)}
      onContextMenu={(e) => onContext(row, e)}
      onDoubleClick={() => onActivate(row)}
    >
      {barFraction > 0 && (
        <div className="row__bar" style={{ width: `${Math.min(100, barFraction * 100)}%` }} />
      )}
      {cols.map((c) => {
        const w = { width: c.width, flexBasis: c.width };
        switch (c.key) {
          case "rank":
            return (
              <div className="cell cell--num cell--muted num" key={c.key} style={w}>
                {count(row.rank)}
              </div>
            );
          case "name":
            return (
              <div
                className="cell cell--name"
                key={c.key}
                style={{ flex: "1 1 auto", minWidth: c.width }}
                title={`${row.dirPath}/${row.name}`}
              >
                <span className="ficon">
                  {row.isPackage ? <IconFolder color={color} /> : <IconFile color={color} />}
                </span>
                <span className="cell__label">{row.name}</span>
                {row.cloud && (
                  <span className="badge badge--cloud" title={t("tip.cloud")}>
                    <IconCloud />
                  </span>
                )}
                {row.protected && (
                  <span className="badge badge--lock" title={t("tip.protected")}>
                    <IconLock />
                  </span>
                )}
              </div>
            );
          case "size":
            return (
              <div className="cell cell--num num" key={c.key} style={w}>
                {bytes(Math.max(row.alloc, row.size))}
              </div>
            );
          case "alloc":
            return (
              <div className="cell cell--num cell--dim num" key={c.key} style={w}>
                {bytes(row.alloc)}
              </div>
            );
          case "diskPct":
            return (
              <div className="cell cell--num cell--dim num" key={c.key} style={w}>
                {row.diskPct >= 0.01 ? pct(row.diskPct, 2) : "—"}
              </div>
            );
          case "unused":
            return (
              <UnusedCell
                key={c.key}
                lastUsed={row.lastUsed}
                source={row.lastUsedSource}
                width={c.width}
                now={now}
              />
            );
          case "lastUsed":
            return (
              <div className="cell cell--num cell--dim num" key={c.key} style={w}>
                {dateTime(row.lastUsed)}
              </div>
            );
          case "modified":
            return (
              <div className="cell cell--num cell--dim num" key={c.key} style={w}>
                {dateTime(row.modified)}
              </div>
            );
          case "created":
            return (
              <div className="cell cell--num cell--dim num" key={c.key} style={w}>
                {dateTime(row.created)}
              </div>
            );
          case "ext":
            return (
              <div className="cell cell--dim" key={c.key} style={w}>
                {row.ext ? `.${row.ext}` : "—"}
              </div>
            );
          case "kind":
            return (
              <div className="cell cell--dim" key={c.key} style={w}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span className="dot" style={{ background: color }} />
                  {categoryLabel(row.category, t)}
                </span>
              </div>
            );
          case "path":
            return (
              <div
                className="cell cell--flex cell--muted"
                key={c.key}
                style={{ flex: "1 1 auto", minWidth: c.width }}
                title={row.dirPath}
              >
                <span>{row.dirPath}</span>
              </div>
            );
          case "score":
            return <ScoreCell key={c.key} value={row.cleanupScore} width={c.width} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
