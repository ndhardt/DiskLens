import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEvent } from "../../lib/hooks";

interface Props {
  rowHeight: number;
  total: number;
  large?: boolean;
  /** Scroll the given row into view when it changes. */
  scrollTo?: number | null;
  overscan?: number;
  onRange: (start: number, end: number) => void;
  renderRow: (index: number, top: number) => React.ReactNode;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  head: React.ReactNode;
  empty?: React.ReactNode;
  bodyRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * Windowed table body: only the rows the viewport covers exist in the DOM.
 * Rows are absolutely positioned inside a full-height spacer so the scrollbar
 * stays accurate.
 */
export function VirtualTable({
  rowHeight,
  total,
  large,
  scrollTo,
  overscan = 8,
  onRange,
  renderRow,
  onKeyDown,
  head,
  empty,
  bodyRef,
}: Props) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const ref = bodyRef ?? innerRef;
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);
  const rafRef = useRef(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, [ref]);

  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setScrollTop(ref.current?.scrollTop ?? 0);
    });
  }, [ref]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visible = Math.ceil(height / rowHeight) + overscan * 2;
  const end = Math.min(total, start + visible);

  const notify = useEvent(onRange);
  useEffect(() => {
    if (total > 0) notify(start, end);
  }, [start, end, total, notify]);

  // Keep a programmatically selected row on screen.
  const lastScrollTo = useRef<number | null>(null);
  useEffect(() => {
    if (scrollTo == null || scrollTo < 0) return;
    if (lastScrollTo.current === scrollTo) return;
    lastScrollTo.current = scrollTo;
    const el = ref.current;
    if (!el) return;
    const top = scrollTo * rowHeight;
    const bottom = top + rowHeight;
    if (top < el.scrollTop) {
      el.scrollTop = Math.max(0, top - rowHeight * 3);
    } else if (bottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = bottom - el.clientHeight + rowHeight * 3;
    }
  }, [scrollTo, rowHeight, ref]);

  const rows: React.ReactNode[] = [];
  for (let i = start; i < end; i++) rows.push(renderRow(i, i * rowHeight));

  return (
    <div className={large ? "table table--lg" : "table"}>
      {head}
      <div
        className="table__body"
        ref={ref}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        tabIndex={0}
      >
        {total === 0 ? (
          empty ?? null
        ) : (
          <div className="table__canvas" style={{ height: total * rowHeight }}>
            {rows}
          </div>
        )}
      </div>
    </div>
  );
}
