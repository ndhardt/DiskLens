import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { fitColumns, type ColumnDef } from "../../lib/columns";
import { bytes, CATEGORY_COLOR, count, pct } from "../../lib/format";
import { useElementSize } from "../../lib/hooks";
import type { ExtRow, ExtSort, ExtSortKey } from "../../lib/types";
import { Th } from "../common/Th";
import { VirtualTable } from "../common/VirtualTable";

type Key =
  | "ext"
  | "category"
  | "files"
  | "size"
  | "alloc"
  | "pctDrive"
  | "average"
  | "largest";

const COLUMNS: ColumnDef<Key, ExtSortKey>[] = [
  { key: "ext", label: "Extension", width: 130, priority: 100, required: true, sortKey: "extension" },
  { key: "category", label: "Category", width: 118, priority: 80, sortKey: "category" },
  { key: "files", label: "Files", width: 92, num: true, priority: 70, sortKey: "files" },
  { key: "size", label: "Total Size", width: 112, num: true, priority: 99, required: true, sortKey: "totalSize" },
  { key: "alloc", label: "Allocated", width: 112, num: true, priority: 40, sortKey: "allocated" },
  { key: "pctDrive", label: "% Drive", width: 84, num: true, priority: 60, sortKey: "pctDrive" },
  { key: "average", label: "Average Size", width: 116, num: true, priority: 50, sortKey: "averageSize" },
  { key: "largest", label: "Largest File", width: 200, flex: true, priority: 30, sortKey: "largestFile" },
];

interface Props {
  generation: number;
  filter: string;
  onPickExtension: (ext: string) => void;
  onCount: (n: number) => void;
}

export function FileTypes({ generation, filter, onPickExtension, onCount }: Props) {
  const [sort, setSort] = useState<ExtSort>({ key: "totalSize", desc: true });
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [wrapRef, size] = useElementSize<HTMLDivElement>();

  useEffect(() => {
    let alive = true;
    api
      .extensionTable(sort)
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [sort, generation]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase().replace(/^[*.]+/, "");
    if (!q) return rows;
    return rows.filter(
      (r) => r.ext.includes(q) || r.categoryLabel.toLowerCase().includes(q),
    );
  }, [rows, filter]);

  useEffect(() => {
    onCount(rows.length);
  }, [rows.length, onCount]);

  const cols = useMemo(() => fitColumns(COLUMNS, size.width || 1000), [size.width]);
  const totalSize = useMemo(() => shown.reduce((a, r) => a + r.size, 0), [shown]);

  const head = (
    <div className="table__head">
      {cols.map((c) => (
        <Th
          key={c.key}
          label={c.label}
          width={c.width}
          flex={c.flex}
          num={c.num}
          sorted={c.sortKey === sort.key ? (sort.desc ? "desc" : "asc") : null}
          onClick={() =>
            c.sortKey &&
            setSort(
              c.sortKey === sort.key
                ? { key: sort.key, desc: !sort.desc }
                : { key: c.sortKey, desc: c.key !== "ext" && c.key !== "category" },
            )
          }
        />
      ))}
    </div>
  );

  return (
    <div className="pane" ref={wrapRef} style={{ flex: "1 1 auto" }}>
      <div className="pane__caption">
        <span>FILE TYPES</span>
        <span className="pane__caption-sep">·</span>
        <span>
          <b>{count(shown.length)}</b> extensions
        </span>
        <span className="pane__caption-sep">·</span>
        <span>
          <b>{bytes(totalSize, 1)}</b>
        </span>
        <span className="pane__caption-sep">·</span>
        <span>click an extension to see those files</span>
      </div>
      <VirtualTable
        rowHeight={25}
        total={shown.length}
        onRange={() => {}}
        head={head}
        empty={<div className="empty">No file types to show.</div>}
        renderRow={(i, top) => {
          const r = shown[i];
          if (!r) return <div className="row" key={i} style={{ top }} />;
          const color = CATEGORY_COLOR[r.category] ?? "#8e8e98";
          return (
            <div
              className="row"
              key={r.label}
              style={{ top }}
              onClick={() => onPickExtension(r.ext)}
              title={`Show every ${r.label} file in Space Hogs`}
            >
              {cols.map((c) => {
                const w = { width: c.width, flexBasis: c.width };
                switch (c.key) {
                  case "ext":
                    return (
                      <div className="cell cell--name" key={c.key} style={w}>
                        <span className="dot" style={{ background: color }} />
                        <span className="cell__label">{r.label}</span>
                      </div>
                    );
                  case "category":
                    return (
                      <div className="cell cell--dim" key={c.key} style={w}>
                        {r.categoryLabel}
                      </div>
                    );
                  case "files":
                    return (
                      <div className="cell cell--num cell--dim num" key={c.key} style={w}>
                        {count(r.files)}
                      </div>
                    );
                  case "size":
                    return (
                      <div className="cell cell--num num" key={c.key} style={w}>
                        {bytes(r.size)}
                      </div>
                    );
                  case "alloc":
                    return (
                      <div className="cell cell--num cell--dim num" key={c.key} style={w}>
                        {bytes(r.alloc)}
                      </div>
                    );
                  case "pctDrive":
                    return (
                      <div className="cell cell--num cell--dim num" key={c.key} style={w}>
                        {r.pctDrive >= 0.01 ? pct(r.pctDrive, 2) : "—"}
                      </div>
                    );
                  case "average":
                    return (
                      <div className="cell cell--num cell--dim num" key={c.key} style={w}>
                        {bytes(r.average)}
                      </div>
                    );
                  case "largest":
                    return (
                      <div
                        className="cell cell--muted"
                        key={c.key}
                        style={{ flex: "1 1 auto", minWidth: c.width }}
                        title={r.largestName}
                      >
                        {r.largestName} <span className="num">({bytes(r.largest)})</span>
                      </div>
                    );
                  default:
                    return null;
                }
              })}
            </div>
          );
        }}
      />
    </div>
  );
}
