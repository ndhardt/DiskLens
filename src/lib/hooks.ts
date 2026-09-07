import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Stable callback identity that always sees fresh state. */
export function useEvent<A extends unknown[], R>(fn: (...a: A) => R) {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...a: A) => ref.current(...a), []);
}

export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize((prev) =>
        Math.abs(prev.width - r.width) < 0.5 && Math.abs(prev.height - r.height) < 0.5
          ? prev
          : { width: r.width, height: r.height },
      );
    });
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  return [ref, size] as const;
}

export interface PageLike<T> {
  rows: T[];
  total: number;
  maxSize: number;
  totalSize: number;
}

export interface PagedRows<T> {
  get(index: number): T | undefined;
  total: number;
  maxSize: number;
  totalSize: number;
  loaded: boolean;
  ensure(start: number, end: number): void;
  reload(): void;
}

const PAGE = 200;

/**
 * Windowed access to a result set held in Rust. Only the pages the viewport
 * touches are fetched. `key` identifies the selection; changing it drops the
 * cache.
 */
export function usePagedRows<T>(
  key: string,
  fetchPage: (offset: number, limit: number) => Promise<PageLike<T>>,
  enabled = true,
): PagedRows<T> {
  const pages = useRef(new Map<number, T[]>());
  const pending = useRef(new Set<number>());
  const meta = useRef({ total: 0, maxSize: 0, totalSize: 0, loaded: false });
  const activeKey = useRef(key);
  const [, bump] = useState(0);
  const fetcher = useEvent(fetchPage);

  useEffect(() => {
    activeKey.current = key;
    pages.current.clear();
    pending.current.clear();
    meta.current = { total: 0, maxSize: 0, totalSize: 0, loaded: false };
    bump((n) => n + 1);
  }, [key]);

  const loadPage = useEvent((page: number) => {
    if (!enabled) return;
    if (pages.current.has(page) || pending.current.has(page)) return;
    pending.current.add(page);
    const forKey = activeKey.current;
    fetcher(page * PAGE, PAGE)
      .then((res) => {
        // A newer selection landed mid-flight.
        if (activeKey.current !== forKey) return;
        pages.current.set(page, res.rows);
        meta.current = {
          total: res.total,
          maxSize: res.maxSize,
          totalSize: res.totalSize,
          loaded: true,
        };
        bump((n) => n + 1);
      })
      .catch(() => {
        // A failed page stays blank and is retried on the next scroll.
      })
      .finally(() => {
        pending.current.delete(page);
      });
  });

  const ensure = useEvent((start: number, end: number) => {
    const first = Math.max(0, Math.floor(start / PAGE));
    const last = Math.floor(Math.max(start, end - 1) / PAGE);
    for (let p = first; p <= last; p++) loadPage(p);
    // Prefetch either side so fast scrolling stays filled.
    if (first > 0) loadPage(first - 1);
    loadPage(last + 1);
  });

  const reload = useEvent(() => {
    pages.current.clear();
    pending.current.clear();
    bump((n) => n + 1);
    loadPage(0);
  });

  useEffect(() => {
    if (enabled) loadPage(0);
  }, [key, enabled, loadPage]);

  return {
    get(index: number) {
      const page = pages.current.get(Math.floor(index / PAGE));
      return page?.[index % PAGE];
    },
    total: meta.current.total,
    maxSize: meta.current.maxSize,
    totalSize: meta.current.totalSize,
    loaded: meta.current.loaded,
    ensure,
    reload,
  };
}

/** Debounce a fast-changing value (the search box). */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Dismiss a popover on outside click or Escape. */
export function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const close = useEvent(onClose);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    // Capture phase, so a click inside another popover still dismisses this.
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, close]);
  return ref;
}
