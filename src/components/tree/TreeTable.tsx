import { useMemo, useRef } from "react";
import { fitColumns, type ColumnDef } from "../../lib/columns";
import { bytes, CATEGORY_COLOR, count, dateOnly } from "../../lib/format";
import { useI18n, type T } from "../../lib/i18n";
import { useElementSize, usePagedRows } from "../../lib/hooks";
import { api } from "../../lib/api";
import type { TreeRow, TreeSort, TreeSortKey } from "../../lib/types";
import { PctCell, UnusedCell } from "../common/Cells";
import { IconFolder, IconLock, IconTriangle } from "../common/Icons";
import { Th } from "../common/Th";
import { VirtualTable } from "../common/VirtualTable";

type Key =
  | "name"
  | "pct"
  | "size"
  | "alloc"
  | "files"
  | "folders"
  | "lastUsed"
  | "unused";

const COLUMNS: ColumnDef<Key, TreeSortKey>[] = [
  { key: "name", labelKey: "col.name", width: 220, flex: true, priority: 100, required: true, sortKey: "name" },
  { key: "pct", labelKey: "col.pctParent", width: 86, num: true, priority: 60, sortKey: "pctParent" },
  { key: "size", labelKey: "col.size", width: 98, num: true, priority: 95, required: true, sortKey: "size" },
  { key: "alloc", labelKey: "col.allocated", width: 98, num: true, priority: 20, sortKey: "allocated" },
  { key: "files", labelKey: "col.files", width: 68, num: true, priority: 40, sortKey: "files" },
  { key: "folders", labelKey: "col.folders", width: 68, num: true, priority: 30, sortKey: "folders" },
  { key: "lastUsed", labelKey: "col.lastUsed", width: 126, num: true, priority: 50, sortKey: "lastUsed" },
  { key: "unused", labelKey: "col.unusedFor", width: 100, num: true, priority: 90, required: true, sortKey: "unusedFor" },
];

interface Props {
  rootName: string;
  folders: number;
  totalSize: number;
  generation: number;
  sort: TreeSort;
  onSort: (s: TreeSort) => void;
  selected: number | null;
  onSelect: (row: TreeRow) => void;
  onContext: (row: TreeRow, e: React.MouseEvent) => void;
  scrollTo: number | null;
  now: number;
  version: number;
  onToggle: (id: number, expanded: boolean) => void;
}

export function TreeTable({
  rootName,
  folders,
  totalSize,
  generation,
  sort,
  onSort,
  selected,
  onSelect,
  onContext,
  scrollTo,
  now,
  version,
  onToggle,
}: Props) {
  const { t } = useI18n();
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const key = `tree|${generation}|${version}|${sort.key}|${sort.desc}`;
  const rows = usePagedRows<TreeRow>(key, (offset, limit) =>
    api.treePage(offset, limit).then((p) => ({
      rows: p.rows,
      total: p.total,
      maxSize: 0,
      totalSize: 0,
    })),
  );

  const cols = useMemo(() => fitColumns(COLUMNS, size.width || 800), [size.width]);

  const head = (
    <div className="table__head">
      {cols.map((c) => (
        <Th
          key={c.key}
          label={t(c.labelKey)}
          width={c.width}
          flex={c.flex}
          num={c.num}
          sorted={c.sortKey === sort.key ? (sort.desc ? "desc" : "asc") : null}
          onClick={() =>
            c.sortKey &&
            onSort(
              c.sortKey === sort.key
                ? { key: sort.key, desc: !sort.desc }
                : { key: c.sortKey, desc: c.key !== "name" },
            )
          }
        />
      ))}
    </div>
  );

  return (
    <div className="pane" ref={wrapRef} style={{ flex: "1 1 auto" }}>
      {/* The file list has a caption, so this pane needs one or the two column
          headers sit at different heights. */}
      <div className="pane__caption">
        <span>{t("cap.folders")}</span>
        <span className="pane__caption-sep">·</span>
        <span title={rootName}>{rootName}</span>
        <span className="pane__caption-sep">·</span>
        <span>
          <b>{count(folders)}</b> {t("status.folders")} · <b>{bytes(totalSize, 1)}</b>
        </span>
      </div>
      <VirtualTable
        rowHeight={25}
        total={rows.total}
        scrollTo={scrollTo}
        onRange={rows.ensure}
        head={head}
        bodyRef={bodyRef}
        empty={
          <div className="empty">
            <div className="empty__title">{t("empty.noScan")}</div>
            <div>{t("empty.pressScan")}</div>
          </div>
        }
        renderRow={(i, top) => {
          const r = rows.get(i);
          if (!r) return <div className="row" key={i} style={{ top }} />;
          return (
            <TreeRowView
              key={r.id}
              row={r}
              top={top}
              cols={cols}
              selected={selected === r.id}
              now={now}
              t={t}
              onSelect={onSelect}
              onContext={onContext}
              onToggle={onToggle}
            />
          );
        }}
      />
    </div>
  );
}

function TreeRowView({
  row,
  top,
  cols,
  selected,
  now,
  t,
  onSelect,
  onContext,
  onToggle,
}: {
  row: TreeRow;
  top: number;
  cols: ColumnDef<Key, TreeSortKey>[];
  selected: boolean;
  now: number;
  t: T;
  onSelect: (r: TreeRow) => void;
  onContext: (r: TreeRow, e: React.MouseEvent) => void;
  onToggle: (id: number, expanded: boolean) => void;
}) {
  const color = CATEGORY_COLOR[row.category] ?? "#8e8e98";
  return (
    <div
      className={`row${selected ? " row--selected" : ""}${row.denied ? " row--dim" : ""}`}
      style={{ top }}
      onMouseDown={() => onSelect(row)}
      onContextMenu={(e) => {
        onSelect(row);
        onContext(row, e);
      }}
      onDoubleClick={() => onToggle(row.id, !row.expanded)}
    >
      {cols.map((c) => {
        switch (c.key) {
          case "name":
            return (
              <div
                className="cell cell--name"
                key={c.key}
                style={{ flex: "1 1 auto", minWidth: c.width, paddingLeft: 6 + row.depth * 16 }}
                title={row.path}
              >
                <span
                  className={`twisty${row.expanded ? " twisty--open" : ""}${
                    row.hasChildren ? "" : " twisty--leaf"
                  }`}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (row.hasChildren) onToggle(row.id, !row.expanded);
                  }}
                >
                  <IconTriangle />
                </span>
                <span className="ficon">
                  <IconFolder color={color} />
                </span>
                <span className="cell__label">{row.name}</span>
                {row.denied && (
                  <span className="badge badge--lock" title={t("tip.denied")}>
                    <IconLock />
                  </span>
                )}
                {row.package && <span className="badge">{t("tip.bundle")}</span>}
              </div>
            );
          case "pct":
            return <PctCell key={c.key} value={row.pctParent} width={c.width} />;
          case "size":
            return (
              <div className="cell cell--num num" key={c.key} style={{ width: c.width, flexBasis: c.width }}>
                {bytes(row.size)}
              </div>
            );
          case "alloc":
            return (
              <div
                className="cell cell--num cell--dim num"
                key={c.key}
                style={{ width: c.width, flexBasis: c.width }}
              >
                {bytes(row.alloc)}
              </div>
            );
          case "files":
            return (
              <div
                className="cell cell--num cell--dim num"
                key={c.key}
                style={{ width: c.width, flexBasis: c.width }}
              >
                {count(row.files)}
              </div>
            );
          case "folders":
            return (
              <div
                className="cell cell--num cell--dim num"
                key={c.key}
                style={{ width: c.width, flexBasis: c.width }}
              >
                {count(row.folders)}
              </div>
            );
          case "lastUsed":
            return (
              <div
                className="cell cell--num cell--dim num"
                key={c.key}
                style={{ width: c.width, flexBasis: c.width }}
              >
                {dateOnly(row.lastUsed)}
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
          default:
            return null;
        }
      })}
    </div>
  );
}
