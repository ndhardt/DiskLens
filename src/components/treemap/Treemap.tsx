import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { bytes, CATEGORY_BY_INDEX, CATEGORY_COLOR, categoryLabel, unusedFor } from "../../lib/format";
import { useElementSize, useEvent } from "../../lib/hooks";
import { useI18n, type T } from "../../lib/i18n";
import type { ItemDetail, TreemapLayout, TreemapRect } from "../../lib/types";

interface Props {
  generation: number;
  rootDir: number;
  height: number;
  highlight: { id: number; isDir: boolean } | null;
  onSelect: (rect: TreemapRect) => void;
  onActivate: (rect: TreemapRect) => void;
  onContext: (rect: TreemapRect, e: React.MouseEvent) => void;
  now: number;
}

/**
 * Treemap renderer. Layout arrives from Rust as a flat rectangle list.
 *
 * The map is drawn once into an offscreen canvas, so a hover costs one
 * `drawImage` plus an outline rather than a few thousand fills.
 */
export function Treemap({
  generation,
  rootDir,
  height,
  highlight,
  onSelect,
  onActivate,
  onContext,
  now,
}: Props) {
  const { t } = useI18n();
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreen = useRef<HTMLCanvasElement | null>(null);
  const [layout, setLayout] = useState<TreemapLayout | null>(null);
  const [hover, setHover] = useState<{ rect: TreemapRect; x: number; y: number } | null>(null);
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const detailCache = useRef(new Map<string, ItemDetail>());

  // ---- layout ------------------------------------------------------------
  useEffect(() => {
    if (size.width < 8 || height < 8) return;
    let alive = true;
    const t = setTimeout(() => {
      const budget = Math.round(
        Math.min(14_000, Math.max(600, (size.width * height) / 46)),
      );
      api
        .treemap(rootDir, size.width, height, budget)
        .then((l) => alive && setLayout(l))
        .catch(() => alive && setLayout(null));
    }, 60);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [size.width, height, rootDir, generation]);

  // ---- offscreen render --------------------------------------------------
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let alive = true;
    document.fonts.ready.then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  useLayoutEffect(() => {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(size.width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (!offscreen.current) offscreen.current = document.createElement("canvas");
    const off = offscreen.current;
    off.width = w;
    off.height = h;
    const ctx = off.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    paint(ctx, layout, size.width, height);
    blit();
  }, [layout, size.width, height, fontsReady]);

  const blit = useEvent(() => {
    const canvas = canvasRef.current;
    const off = offscreen.current;
    if (!canvas || !off) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = off.width;
    canvas.height = off.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(off, 0, 0);
    ctx.scale(dpr, dpr);

    const outline = (r: TreemapRect, color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.strokeRect(r.x + width / 2, r.y + width / 2, Math.max(0, r.w - width), Math.max(0, r.h - width));
    };

    if (highlight && layout) {
      for (const r of layout.rects) {
        if (r.id === highlight.id && r.isDir === highlight.isDir) {
          outline(r, "rgba(255,255,255,0.92)", 2);
          break;
        }
      }
    }
    if (hover) outline(hover.rect, "rgba(255,255,255,0.65)", 1.5);
  });

  useEffect(() => {
    blit();
  }, [highlight, hover, blit]);

  // ---- hit testing -------------------------------------------------------
  const hitTest = useCallback(
    (px: number, py: number): TreemapRect | null => {
      if (!layout) return null;
      // Later rectangles draw on top, so the deepest match wins.
      for (let i = layout.rects.length - 1; i >= 0; i--) {
        const r = layout.rects[i];
        if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) {
          if (r.isDir && !r.collapsed) continue; // see-through container
          return r;
        }
      }
      for (let i = layout.rects.length - 1; i >= 0; i--) {
        const r = layout.rects[i];
        if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) return r;
      }
      return null;
    },
    [layout],
  );

  const localPoint = (e: React.MouseEvent) => {
    const box = canvasRef.current?.getBoundingClientRect();
    if (!box) return null;
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };

  const onMove = (e: React.MouseEvent) => {
    const p = localPoint(e);
    if (!p) return;
    const r = hitTest(p.x, p.y);
    if (!r) {
      if (hover) setHover(null);
      return;
    }
    if (hover?.rect !== r) setHover({ rect: r, x: e.clientX, y: e.clientY });
    else setHover({ rect: r, x: e.clientX, y: e.clientY });
  };

  // Details are fetched lazily and cached, so hovering never blocks.
  useEffect(() => {
    if (!hover) {
      setDetail(null);
      return;
    }
    const key = `${hover.rect.isDir ? "d" : "f"}${hover.rect.id}`;
    const cached = detailCache.current.get(key);
    if (cached) {
      setDetail(cached);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      api.itemDetail(hover.rect.id, hover.rect.isDir).then((d) => {
        if (!alive || !d) return;
        detailCache.current.set(key, d);
        setDetail(d);
      });
    }, 40);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [hover]);

  useEffect(() => {
    detailCache.current.clear();
  }, [generation]);

  return (
    <div className="treemap" ref={wrapRef} style={{ height }}>
      <canvas
        ref={canvasRef}
        style={{ width: size.width, height }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onMouseDown={(e) => {
          const p = localPoint(e);
          const r = p && hitTest(p.x, p.y);
          if (r && e.button === 0) onSelect(r);
        }}
        onDoubleClick={(e) => {
          const p = localPoint(e);
          const r = p && hitTest(p.x, p.y);
          if (r) onActivate(r);
        }}
        onContextMenu={(e) => {
          const p = localPoint(e);
          const r = p && hitTest(p.x, p.y);
          if (r) {
            onSelect(r);
            onContext(r, e);
          }
        }}
      />
      {hover && (
        <Tooltip
          rect={hover.rect}
          x={hover.x}
          y={hover.y}
          detail={detail?.id === hover.rect.id && detail.isDir === hover.rect.isDir ? detail : null}
          now={now}
          t={t}
        />
      )}
      {!layout?.rects.length && (
        <div className="empty" style={{ position: "absolute", inset: 0 }}>
          {generation === 0 ? t("treemap.afterScan") : t("treemap.empty")}
        </div>
      )}
    </div>
  );
}

function Tooltip({
  rect,
  x,
  y,
  detail,
  now,
  t,
}: {
  rect: TreemapRect;
  x: number;
  y: number;
  detail: ItemDetail | null;
  now: number;
  t: T;
}) {
  const w = 300;
  const left = Math.min(x + 14, window.innerWidth - w - 12);
  const flipUp = y > window.innerHeight - 150;
  return (
    <div
      className="tm-tip"
      style={{ left, top: flipUp ? undefined : y + 16, bottom: flipUp ? window.innerHeight - y + 14 : undefined }}
    >
      <div className="tm-tip__name">{rect.name}</div>
      <div className="tm-tip__size num">{bytes(detail ? Math.max(detail.alloc, detail.size) : rect.size)}</div>
      {detail && <div className="tm-tip__path">{parentOf(detail.path)}</div>}
      {detail && (
        <div className="tm-tip__row">
          {t("treemap.lastUsed", {
            v: detail.lastUsed
              ? t("treemap.ago", { v: unusedFor(detail.lastUsed, now, t) })
              : t("treemap.unknown"),
          })}
        </div>
      )}
      <div className="tm-tip__row" style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span
          className="dot"
          style={{ background: CATEGORY_COLOR[CATEGORY_BY_INDEX[rect.cat] ?? "other"] }}
        />
        {rect.isDir
          ? t("treemap.folder")
          : categoryLabel(CATEGORY_BY_INDEX[rect.cat] ?? "other", t)}
        {detail?.isDir ? ` · ${t("treemap.nFiles", { n: detail.files.toLocaleString() })}` : ""}
      </div>
    </div>
  );
}

function parentOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

// ---------------------------------------------------------------- painting

function paint(
  ctx: CanvasRenderingContext2D,
  layout: TreemapLayout | null,
  width: number,
  height: number,
) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0b0d13";
  ctx.fillRect(0, 0, width, height);
  if (!layout) return;

  ctx.textBaseline = "middle";
  ctx.font = '10px "Monaspace Neon", "Hiragino Sans", sans-serif';

  for (const r of layout.rects) {
    if (r.w < 1 || r.h < 1) continue;
    const base = CATEGORY_COLOR[CATEGORY_BY_INDEX[r.cat] ?? "other"] ?? "#8e8e98";

    if (r.isDir && !r.collapsed) {
      // Containers are a faint frame; their children carry the colour.
      ctx.fillStyle = "rgba(255,255,255,0.035)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      continue;
    }

    // Flat fill, stepped darker with depth so nesting reads.
    const fill = r.depth > 0 ? shade(base, -0.06 * Math.min(r.depth, 4)) : base;
    ctx.fillStyle = fill;
    ctx.fillRect(r.x, r.y, r.w, r.h);

    // A one-pixel edge to separate neighbours.
    if (r.w > 2 && r.h > 2) {
      ctx.fillStyle = "rgba(255,255,255,0.13)";
      ctx.fillRect(r.x, r.y, r.w, 1);
      ctx.fillStyle = "rgba(0,0,0,0.30)";
      ctx.fillRect(r.x, r.y + r.h - 1, r.w, 1);
      ctx.fillRect(r.x + r.w - 1, r.y, 1, r.h);
    }

    if (r.w > 46 && r.h > 15) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x + 3, r.y + 1, r.w - 6, r.h - 2);
      ctx.clip();
      ctx.fillStyle = isLight(fill) ? "rgba(0,0,0,0.78)" : "rgba(255,255,255,0.95)";
      ctx.fillText(r.name, r.x + 5, r.y + r.h / 2);
      ctx.restore();
    }
  }
}

/** Whether black text reads on this fill (Rec. 709 luma). */
function isLight(color: string): boolean {
  const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(color);
  const [r, g, b] = m
    ? [Number(m[1]), Number(m[2]), Number(m[3])]
    : [
        parseInt(color.slice(1, 3), 16),
        parseInt(color.slice(3, 5), 16),
        parseInt(color.slice(5, 7), 16),
      ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
}

/** Lighten (`amount > 0`) or darken a hex colour. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (c: number) =>
    Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}
