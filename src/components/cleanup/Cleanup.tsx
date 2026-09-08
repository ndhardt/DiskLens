import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { bytes, count } from "../../lib/format";
import { usePagedRows, type PagedRows } from "../../lib/hooks";
import { useI18n, type Key } from "../../lib/i18n";
import type { CleanupGroup, FileRow, SortKey } from "../../lib/types";
import { FileTable } from "../common/FileTable";
import type { ColumnDef } from "../../lib/columns";
import type { FileColKey } from "../common/FileTable";
import { IconCheck } from "../common/Icons";

/** Columns for the item list on the right. A cache folder has no useful kind. */
const ITEM_COLUMNS: ColumnDef<FileColKey, SortKey>[] = [
  { key: "rank", labelKey: "col.rank", width: 42, num: true, priority: 40, required: true },
  { key: "name", labelKey: "col.name", width: 180, flex: true, priority: 100, required: true },
  { key: "size", labelKey: "col.size", width: 100, num: true, priority: 99, required: true },
  { key: "unused", labelKey: "col.unusedFor", width: 105, num: true, priority: 98, required: true },
  { key: "lastUsed", labelKey: "col.lastUsed", width: 140, num: true, priority: 60 },
  { key: "path", labelKey: "col.path", width: 140, flex: true, priority: 70 },
];

interface Props {
  groups: CleanupGroup[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  active: string | null;
  onActive: (id: string) => void;
  rows: PagedRows<FileRow>;
  onContext: (row: FileRow, e: React.MouseEvent) => void;
  onReveal: (row: FileRow) => void;
  now: number;
  width: number;
}

export function Cleanup({
  groups,
  selected,
  onToggle,
  active,
  onActive,
  rows,
  onContext,
  onReveal,
  now,
  width,
}: Props) {
  const { t } = useI18n();
  const safeTotal = useMemo(
    () => groups.filter((g) => g.safety === "safe").reduce((a, g) => a + g.size, 0),
    [groups],
  );

  if (!groups.length) {
    return (
      <div className="pane" style={{ flex: "1 1 auto" }}>
        <div className="pane__caption">
          <span>{t("clean.caption")}</span>
        </div>
        <div className="empty">
          <div className="empty__title">{t("clean.nothing")}</div>
          <div>{t("clean.nothingHint")}</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="pane" style={{ flex: "1 1 auto" }}>
        <div className="pane__caption">
          <span>{t("clean.caption")}</span>
          <span className="pane__caption-sep">·</span>
          <span>{t("clean.safeTotal", { size: bytes(safeTotal, 1) })}</span>
        </div>

        <div className="table">
          <div className="table__head">
            <div className="th" style={{ width: 30, flexBasis: 30 }} />
            <div className="th th--flex">{t("clean.col.group")}</div>
            <div className="th" style={{ width: 110, flexBasis: 110 }}>
              {t("clean.col.kind")}
            </div>
            <div className="th th--num" style={{ width: 78, flexBasis: 78 }}>
              {t("clean.col.entries")}
            </div>
            <div className="th th--num" style={{ width: 92, flexBasis: 92 }}>
              {t("clean.col.files")}
            </div>
            <div className="th th--num" style={{ width: 100, flexBasis: 100 }}>
              {t("clean.col.size")}
            </div>
          </div>

          <div className="table__body">
            {groups.map((g) => {
              const on = selected.has(g.id);
              return (
                <div
                  key={g.id}
                  className={`row row--group${active === g.id ? " row--selected" : ""}`}
                  onMouseDown={() => onActive(g.id)}
                >
                  <div
                    className="cell"
                    style={{ width: 30, flexBasis: 30, padding: "0 0 0 9px" }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onToggle(g.id);
                    }}
                  >
                    <span className={on ? "check check--on" : "check"}>
                      {on && <IconCheck />}
                    </span>
                  </div>

                  <div className="cell cell--group">
                    <span className="cell__label">{t(`clean.${g.id}` as Key)}</span>
                    <span className="cell__sub">{t(`clean.${g.id}.desc` as Key)}</span>
                  </div>

                  <div className="cell" style={{ width: 110, flexBasis: 110 }}>
                    <span className={g.safety === "safe" ? "tagline" : "tagline tagline--review"}>
                      {g.safety === "safe" ? t("clean.safe") : t("clean.review")}
                    </span>
                  </div>
                  <div className="cell cell--num cell--dim num" style={{ width: 78, flexBasis: 78 }}>
                    {count(g.items)}
                    {g.truncated ? "+" : ""}
                  </div>
                  <div className="cell cell--num cell--dim num" style={{ width: 92, flexBasis: 92 }}>
                    {count(g.files)}
                  </div>
                  <div className="cell cell--num num" style={{ width: 100, flexBasis: 100 }}>
                    {bytes(g.size, 1)}
                  </div>
                </div>
              );
            })}
            <div className="clean-legend">
              <div>
                <b>{t("clean.safe")}</b> — {t("clean.safeHint")}
              </div>
              <div>
                <b>{t("clean.review")}</b> — {t("clean.reviewHint")}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="pane" style={{ flex: `0 0 ${width}px`, width }}>
        <div className="pane__caption">
          <span>{active ? t(`clean.${active}` as Key) : t("clean.pickGroup")}</span>
          {active && (
            <>
              <span className="pane__caption-sep">·</span>
              <span>
                <b>{t("cap.items", { n: count(rows.total) })}</b> ·{" "}
                <b>{bytes(rows.totalSize, 1)}</b>
              </span>
            </>
          )}
        </div>
        <FileTable
          columns={ITEM_COLUMNS}
          rows={rows}
          sort={{ key: "size", desc: true }}
          onSort={() => {}}
          selected={EMPTY}
          onRowMouseDown={() => {}}
          onContext={onContext}
          onActivate={onReveal}
          showSizeBar
          now={now}
          empty={<div className="empty">{t("clean.pickGroup")}</div>}
        />
      </div>
    </>
  );
}

const EMPTY = new Set<number>();

/** Windowed rows for the group currently open on the right. */
export function useCleanupRows(generation: number, group: string | null) {
  return usePagedRows<FileRow>(
    `cleanup|${generation}|${group ?? ""}`,
    (offset, limit) =>
      group
        ? api.cleanupGroupPage(group, offset, limit)
        : Promise.resolve({ rows: [], total: 0, maxSize: 0, totalSize: 0 }),
    group != null,
  );
}

/** Groups for the current scan, refetched whenever the index changes. */
export function useCleanupGroups(generation: number, hasIndex: boolean) {
  const [groups, setGroups] = useState<CleanupGroup[]>([]);
  useEffect(() => {
    if (!hasIndex) {
      setGroups([]);
      return;
    }
    let alive = true;
    api
      .cleanupGroups()
      .then((g) => alive && setGroups(g))
      .catch(() => alive && setGroups([]));
    return () => {
      alive = false;
    };
  }, [generation, hasIndex]);
  return groups;
}
