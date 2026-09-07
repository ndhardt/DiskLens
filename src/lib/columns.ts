/**
 * Column fitting.
 *
 * The recommended widths assume a 1440-wide window, but the tables live inside
 * draggable panes. Rather than let columns overflow or crush the Name column,
 * lower-priority columns drop out as the pane narrows — Name, Size and Unused
 * For always survive, because they are the three the app exists to show.
 */
export interface ColumnDef<K extends string, S extends string = string> {
  key: K;
  label: string;
  /** Fixed width, or the minimum width when `flex` is set. */
  width: number;
  flex?: boolean;
  num?: boolean;
  /** Higher priority columns survive longer as the pane narrows. */
  priority: number;
  required?: boolean;
  sortKey?: S;
  title?: string;
}

export function fitColumns<K extends string, S extends string>(
  cols: ColumnDef<K, S>[],
  available: number,
): ColumnDef<K, S>[] {
  if (available <= 0) return cols;

  const keep = new Set<K>();
  let used = 0;
  for (const c of cols) {
    if (c.required) {
      keep.add(c.key);
      used += c.width;
    }
  }
  const optional = cols
    .filter((c) => !c.required)
    .sort((a, b) => b.priority - a.priority);
  for (const c of optional) {
    if (used + c.width <= available) {
      keep.add(c.key);
      used += c.width;
    }
  }
  return cols.filter((c) => keep.has(c.key));
}
