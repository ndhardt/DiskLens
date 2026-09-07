import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { api } from "./lib/api";
import { joinPath } from "./lib/format";
import { useDebounced, useElementSize, useEvent, usePagedRows } from "./lib/hooks";
import type {
  DeniedInfo,
  DriveSummary,
  FileRow,
  HogMode,
  ItemRef,
  Mode,
  QuickFilter,
  ScanProgress,
  Settings,
  SortSpec,
  TrashPreview,
  TreeRow,
  TreeSort,
  TreemapRect,
  VolumeInfo,
} from "./lib/types";

import { DriveOverview } from "./components/DriveOverview";
import { ModeBar } from "./components/ModeBar";
import { SettingsDialog } from "./components/SettingsDialog";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { TrashDialog } from "./components/TrashDialog";
import { ContextMenu, type MenuState } from "./components/common/ContextMenu";
import { Splitter } from "./components/common/Splitter";
import { SpaceHogs } from "./components/hogs/SpaceHogs";
import { FileList } from "./components/tree/FileList";
import { TreeTable } from "./components/tree/TreeTable";
import { Treemap } from "./components/treemap/Treemap";
import { FileTypes } from "./components/types/FileTypes";
import { IconTreemap } from "./components/common/Icons";
import { CATEGORY_COLOR, CATEGORY_LABEL } from "./lib/format";

const EMPTY_PROGRESS: ScanProgress = {
  running: false,
  files: 0,
  dirs: 0,
  bytes: 0,
  alloc: 0,
  skipped: 0,
  current: "",
  elapsedMs: 0,
  done: false,
  cancelled: false,
  error: null,
  scanner: "",
  root: "",
  spotlightDone: false,
  spotlightHits: 0,
};

interface Selection {
  ids: Set<number>;
  sizes: Map<number, number>;
  anchor: number | null;
}

const NO_SELECTION: Selection = { ids: new Set(), sizes: new Map(), anchor: null };

export default function App() {
  // ---- volumes & scan ----------------------------------------------------
  const [volumes, setVolumes] = useState<VolumeInfo[]>([]);
  const [volume, setVolume] = useState<VolumeInfo | null>(null);
  const [progress, setProgress] = useState<ScanProgress>(EMPTY_PROGRESS);
  const [summary, setSummary] = useState<DriveSummary | null>(null);
  const [denied, setDenied] = useState<DeniedInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [generation, setGeneration] = useState(0);

  // ---- view state --------------------------------------------------------
  const [mode, setMode] = useState<Mode>("tree");
  const [search, setSearch] = useState("");
  const query = useDebounced(search, 130);
  const [typeCount, setTypeCount] = useState(0);

  const [treeSort, setTreeSort] = useState<TreeSort>({ key: "size", desc: true });
  const [treeVersion, setTreeVersion] = useState(0);
  const [treeScrollTo, setTreeScrollTo] = useState<number | null>(null);
  const [selectedDir, setSelectedDir] = useState<number>(0);
  const [selectedDirPath, setSelectedDirPath] = useState<string | null>(null);

  const [fileSort, setFileSort] = useState<SortSpec>({ key: "size", desc: true });
  const [hogMode, setHogMode] = useState<HogMode>("largestFirst");
  const [hogSortOverride, setHogSortOverride] = useState<SortSpec | null>(null);
  const [quick, setQuick] = useState<QuickFilter>("all");

  const [sel, setSel] = useState<Selection>(NO_SELECTION);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [scrollTo, setScrollTo] = useState<number | null>(null);

  const [menu, setMenu] = useState<MenuState | null>(null);
  /// Bytes trashed since the last scan. The index still describes the old tree,
  /// so say so rather than showing numbers that are quietly out of date.
  const [freedBytes, setFreedBytes] = useState(0);
  const [trash, setTrash] = useState<TrashPreview | null>(null);
  const [trashBusy, setTrashBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [showTreemap, setShowTreemap] = useState(true);
  const [treemapH, setTreemapH] = useState(236);
  const [treemapRoot, setTreemapRoot] = useState(0);
  const [treemapRootName, setTreemapRootName] = useState<string | null>(null);
  const [treeWidthPct, setTreeWidthPct] = useState(0.56);
  const [mainRef, mainSize] = useElementSize<HTMLDivElement>();

  const [now, setNow] = useState(() => Date.now() / 1000);
  const [winH, setWinH] = useState(() => window.innerHeight);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onResize = () => setWinH(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Never let the Treemap take more than it is worth on a short window; the
  // table is the thing being read.
  const treemapHeight = Math.max(90, Math.min(treemapH, Math.round(winH * 0.45)));

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 60_000);
    return () => clearInterval(t);
  }, []);

  // ---- bootstrap ---------------------------------------------------------
  useEffect(() => {
    api.listVolumes().then((v) => {
      setVolumes(v);
      setVolume((cur) => cur ?? v.find((x) => x.isRoot) ?? v[0] ?? null);
    });
    api.getSettings().then(setSettings);
    api.scanProgress().then((p) => {
      setProgress(p);
      if (p.done) refreshAfterScan();
    });
  }, []);

  const refreshAfterScan = useEvent(() => {
    api.driveSummary().then(setSummary);
    api.deniedReport().then(setDenied);
    api.listVolumes().then(setVolumes);
    setGeneration((g) => g + 1);
    setTreeVersion((v) => v + 1);
  });

  useEffect(() => {
    const un: Promise<() => void>[] = [
      listen<ScanProgress>("scan:progress", (e) => setProgress(e.payload)),
      listen<ScanProgress>("scan:done", (e) => {
        setProgress(e.payload);
        setSel(NO_SELECTION);
        setSelectedDir(0);
        setTreemapRoot(0);
        setTreemapRootName(null);
        refreshAfterScan();
      }),
      listen<ScanProgress>("scan:spotlight", (e) => {
        setProgress(e.payload);
        refreshAfterScan();
      }),
    ];
    return () => {
      un.forEach((p) => p.then((f) => f()));
    };
  }, [refreshAfterScan]);

  // ---- data sources ------------------------------------------------------
  const hogSort: SortSpec = useMemo(
    () => hogSortOverride ?? derivedHogSort(hogMode),
    [hogSortOverride, hogMode],
  );

  const hogEnabled = mode === "hogs" || query.trim() !== "";
  const hogKey = `hogs|${generation}|${hogMode}|${quick}|${query}|${hogSort.key}${hogSort.desc}|${settings?.groupBundles}`;
  const hogRows = usePagedRows<FileRow>(
    hogKey,
    (offset, limit) =>
      api.hogPage(hogMode, quick, query, hogSortOverride, offset, limit),
    hogEnabled,
  );

  const fileKey = `files|${generation}|${selectedDir}|${fileSort.key}${fileSort.desc}|${query}`;
  const fileRows = usePagedRows<FileRow>(
    fileKey,
    (offset, limit) => api.filePage(selectedDir, fileSort, query, offset, limit),
    mode === "tree",
  );

  const activeRows = mode === "hogs" ? hogRows : fileRows;

  // ---- selection ---------------------------------------------------------
  const clearSelection = useCallback(() => {
    setSel(NO_SELECTION);
    setFocusIndex(null);
  }, []);

  useEffect(() => {
    clearSelection();
  }, [mode, selectedDir, query, hogMode, quick, generation, clearSelection]);

  const selectRange = useEvent(async (from: number, to: number) => {
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    const page =
      mode === "hogs"
        ? await api.hogPage(hogMode, quick, query, hogSortOverride, start, end - start + 1)
        : await api.filePage(selectedDir, fileSort, query, start, end - start + 1);
    const ids = new Set<number>();
    const sizes = new Map<number, number>();
    for (const r of page.rows) {
      ids.add(r.id);
      sizes.set(r.id, Math.max(r.alloc, r.size));
    }
    setSel({ ids, sizes, anchor: from });
  });

  const onRowMouseDown = useEvent((index: number, row: FileRow, e: React.MouseEvent) => {
    if (e.button === 2 && sel.ids.has(row.id)) {
      setFocusIndex(index);
      return; // keep a multi-selection intact for a right-click
    }
    const size = Math.max(row.alloc, row.size);
    setFocusIndex(index);
    if (e.shiftKey && sel.anchor != null) {
      void selectRange(sel.anchor, index);
    } else if (e.metaKey || e.ctrlKey) {
      setSel((prev) => {
        const ids = new Set(prev.ids);
        const sizes = new Map(prev.sizes);
        if (ids.has(row.id)) {
          ids.delete(row.id);
          sizes.delete(row.id);
        } else {
          ids.add(row.id);
          sizes.set(row.id, size);
        }
        return { ids, sizes, anchor: index };
      });
    } else {
      setSel({ ids: new Set([row.id]), sizes: new Map([[row.id, size]]), anchor: index });
    }
  });

  const selectedPaths = useEvent(async (): Promise<string[]> => {
    const ids = [...sel.ids];
    if (!ids.length) return [];
    return api.itemPaths(ids, false);
  });

  const selectionBytes = useMemo(
    () => [...sel.sizes.values()].reduce((a, b) => a + b, 0),
    [sel],
  );

  // ---- actions -----------------------------------------------------------
  const doScan = useEvent(() => {
    if (!volume) return;
    setSel(NO_SELECTION);
    setSummary(null);
    setFreedBytes(0);
    api.startScan(volume.path, volume.name).catch(() => {});
  });

  const openPaths = useEvent(async (paths: string[]) => {
    for (const p of paths.slice(0, 12)) await api.openItem(p).catch(() => {});
  });

  const copyPaths = useEvent(async (paths: string[]) => {
    try {
      await navigator.clipboard.writeText(paths.join("\n"));
    } catch {
      /* the webview denied clipboard access; nothing else to do */
    }
  });

  const askTrash = useEvent(async (items: ItemRef[]) => {
    if (!items.length) return;
    const preview = await api.trashPreview(items);
    if (preview.count > 0) setTrash(preview);
  });

  const confirmTrash = useEvent(async () => {
    if (!trash) return;
    setTrashBusy(true);
    const paths = trash.items.filter((i) => !i.immutable).map((i) => i.path);
    try {
      const report = await api.trashItems(paths);
      if (report.bytesFreed > 0) setFreedBytes((b) => b + report.bytesFreed);
      const failed = report.results.filter((r) => !r.ok);
      if (failed.length) {
        setMenu(null);
        console.warn("Some items could not be moved to the Trash:", failed);
      }
    } finally {
      setTrashBusy(false);
      setTrash(null);
      clearSelection();
    }
  });

  const focusTreemapOn = useEvent(async (dirId: number, name: string) => {
    setTreemapRoot(dirId);
    setTreemapRootName(name);
    setShowTreemap(true);
  });

  // ---- context menus -----------------------------------------------------
  const fileMenu = useEvent((row: FileRow, e: React.MouseEvent) => {
    e.preventDefault();
    const multi = sel.ids.size > 1 && sel.ids.has(row.id);
    const ids: ItemRef[] = multi
      ? [...sel.ids].map((id) => ({ id, isDir: false }))
      : [{ id: row.id, isDir: false }];
    const label = multi ? `${sel.ids.size} items` : `“${row.name}”`;
    const path = joinPath(row.dirPath, row.name);

    setMenu({
      x: e.clientX,
      y: e.clientY,
      actions: [
        { label: "Open", shortcut: "⌘O", onPick: () => void openPaths([path]) },
        { label: "Quick Look", shortcut: "Space", onPick: () => void api.quickLook(path) },
        { label: "Reveal in Finder", onPick: () => void api.revealItem(path) },
        "sep",
        {
          label: "Copy Path",
          shortcut: "⌘⌥C",
          onPick: async () => copyPaths(multi ? await selectedPaths() : [path]),
        },
        {
          label: "Focus in Treemap",
          onPick: async () => {
            const dir = await api.locateFile(row.id);
            if (dir != null) focusTreemapOn(dir, row.dirPath.split("/").pop() ?? "");
          },
        },
        "sep",
        {
          label: `Move ${label} to Trash`,
          shortcut: "⌘⌫",
          danger: true,
          disabled: row.immutable,
          title: row.immutable
            ? "This belongs to macOS and cannot be moved to the Trash"
            : undefined,
          onPick: () => void askTrash(ids),
        },
      ],
    });
  });

  const treeMenu = useEvent((row: TreeRow, e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      actions: [
        { label: "Open", onPick: () => void api.openItem(row.path) },
        { label: "Reveal in Finder", onPick: () => void api.revealItem(row.path) },
        { label: "Copy Path", shortcut: "⌘⌥C", onPick: () => void copyPaths([row.path]) },
        "sep",
        { label: "Focus in Treemap", onPick: () => focusTreemapOn(row.id, row.name) },
        "sep",
        {
          label: `Move “${row.name}” to Trash`,
          danger: true,
          disabled: row.immutable,
          title: row.immutable
            ? "This belongs to macOS and cannot be moved to the Trash"
            : undefined,
          onPick: () => void askTrash([{ id: row.id, isDir: true }]),
        },
      ],
    });
  });

  const treemapMenu = useEvent((rect: TreemapRect, e: React.MouseEvent) => {
    e.preventDefault();
    api.itemDetail(rect.id, rect.isDir).then((d) => {
      if (!d) return;
      setMenu({
        x: e.clientX,
        y: e.clientY,
        actions: [
          { label: "Open", onPick: () => void api.openItem(d.path) },
          { label: "Quick Look", onPick: () => void api.quickLook(d.path) },
          { label: "Reveal in Finder", onPick: () => void api.revealItem(d.path) },
          { label: "Copy Path", onPick: () => void copyPaths([d.path]) },
          "sep",
          ...(rect.isDir
            ? [{ label: "Zoom in here", onPick: () => focusTreemapOn(rect.id, rect.name) }]
            : []),
          "sep" as const,
          {
            label: "Move to Trash",
            danger: true,
            disabled: d.immutable,
            onPick: () => void askTrash([{ id: rect.id, isDir: rect.isDir }]),
          },
        ],
      });
    });
  });

  // ---- tree <-> treemap sync --------------------------------------------
  const onTreeSelect = useEvent((row: TreeRow) => {
    setSelectedDir(row.id);
    setSelectedDirPath(row.path);
    setTreemapRoot(row.id);
    setTreemapRootName(row.id === 0 ? null : row.name);
  });

  const onTreeToggle = useEvent(async (id: number, expanded: boolean) => {
    await api.treeToggle(id, expanded);
    setTreeVersion((v) => v + 1);
  });

  const onTreemapSelect = useEvent(async (rect: TreemapRect) => {
    if (rect.isDir) {
      const row = await api.treeReveal(rect.id);
      setTreeVersion((v) => v + 1);
      if (row != null) setTreeScrollTo(row);
      setSelectedDir(rect.id);
      const d = await api.itemDetail(rect.id, true);
      setSelectedDirPath(d?.path ?? null);
      if (mode !== "tree") setMode("tree");
      return;
    }
    const detail = await api.itemDetail(rect.id, false);
    const size = detail ? Math.max(detail.alloc, detail.size) : rect.size;
    setSel({ ids: new Set([rect.id]), sizes: new Map([[rect.id, size]]), anchor: null });

    if (mode === "hogs") {
      const idx = await api.hogRowIndex(hogMode, quick, query, hogSortOverride, rect.id);
      if (idx != null) {
        setFocusIndex(idx);
        setScrollTo(idx);
      }
      return;
    }
    const dir = await api.locateFile(rect.id);
    if (dir == null) return;
    if (dir !== selectedDir) {
      const row = await api.treeReveal(dir);
      setTreeVersion((v) => v + 1);
      if (row != null) setTreeScrollTo(row);
      setSelectedDir(dir);
      const d = await api.itemDetail(dir, true);
      setSelectedDirPath(d?.path ?? null);
    }
    const idx = await api.fileRowIndex(dir, fileSort, query, rect.id);
    if (idx != null) {
      setFocusIndex(idx);
      setScrollTo(idx);
      setSel({ ids: new Set([rect.id]), sizes: new Map([[rect.id, size]]), anchor: idx });
    }
  });

  const treemapHighlight = useMemo(() => {
    if (sel.ids.size === 1) {
      const id = [...sel.ids][0];
      return { id, isDir: false };
    }
    return null;
  }, [sel]);

  // ---- keyboard ----------------------------------------------------------
  const onGlobalKey = useEvent(async (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
    const meta = e.metaKey || e.ctrlKey;

    if (meta && e.key.toLowerCase() === "f") {
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
      return;
    }
    if (meta && e.key.toLowerCase() === "r") {
      e.preventDefault();
      doScan();
      return;
    }
    if (e.key === "Escape") {
      if (menu) return setMenu(null);
      if (trash) return setTrash(null);
      if (settingsOpen) return setSettingsOpen(false);
      if (typing) {
        setSearch("");
        (target as HTMLInputElement).blur();
        return;
      }
      clearSelection();
      return;
    }
    if (typing) return;

    if (meta && ["1", "2", "3"].includes(e.key)) {
      e.preventDefault();
      setMode((["tree", "hogs", "types"] as Mode[])[Number(e.key) - 1]);
      return;
    }
    if (!sel.ids.size) return;

    if (e.key === " ") {
      e.preventDefault();
      const p = await selectedPaths();
      if (p[0]) void api.quickLook(p[0]);
      return;
    }
    if (meta && e.altKey && e.key.toLowerCase() === "c") {
      e.preventDefault();
      void copyPaths(await selectedPaths());
      return;
    }
    if (meta && e.key.toLowerCase() === "o") {
      e.preventDefault();
      void openPaths(await selectedPaths());
      return;
    }
    if (meta && (e.key === "Backspace" || e.key === "Delete")) {
      e.preventDefault();
      void askTrash([...sel.ids].map((id) => ({ id, isDir: false })));
    }
  });

  useEffect(() => {
    const h = (e: KeyboardEvent) => void onGlobalKey(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onGlobalKey]);

  const onTableKey = useEvent((e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const total = activeRows.total;
    if (!total) return;
    const next = Math.max(
      0,
      Math.min(total - 1, (focusIndex ?? -1) + (e.key === "ArrowDown" ? 1 : -1)),
    );
    setFocusIndex(next);
    setScrollTo(next);
    const row = activeRows.get(next);
    if (row) {
      if (e.shiftKey && sel.anchor != null) void selectRange(sel.anchor, next);
      else
        setSel({
          ids: new Set([row.id]),
          sizes: new Map([[row.id, Math.max(row.alloc, row.size)]]),
          anchor: next,
        });
    }
  });

  // ---- derived -----------------------------------------------------------
  const treeWidth = Math.round((mainSize.width || 1440) * treeWidthPct);
  const fileWidth = Math.max(280, (mainSize.width || 1440) - treeWidth - 4);
  const hasIndex = !!summary?.hasIndex;

  const activate = useEvent((row: FileRow) => {
    void api.revealItem(joinPath(row.dirPath, row.name));
  });

  const updateSettings = useEvent(async (s: Settings) => {
    setSettings(s);
    await api.setSettings(s);
    setGeneration((g) => g + 1);
  });

  return (
    <div className="app">
      <Toolbar
        volumes={volumes}
        volume={volume}
        onVolume={(v) => {
          setVolume(v);
          setSummary(null);
        }}
        scanning={progress.running}
        hasIndex={hasIndex}
        onScan={doScan}
        onStop={() => void api.cancelScan()}
        onRefresh={doScan}
        search={search}
        onSearch={setSearch}
        searchRef={searchRef}
        onSettings={() => setSettingsOpen(true)}
        mode={mode}
      />

      <DriveOverview volume={volume} summary={summary} progress={progress} />

      <ModeBar
        mode={mode}
        onMode={setMode}
        counts={{
          folders: summary?.folders ?? 0,
          files: summary?.files ?? 0,
          types: typeCount,
        }}
        hogMode={hogMode}
        onHogMode={(m) => {
          setHogMode(m);
          setHogSortOverride(null);
        }}
        quick={quick}
        onQuick={setQuick}
        onExpandDepth={async (d) => {
          await api.treeExpandDepth(d);
          setTreeVersion((v) => v + 1);
        }}
        onCollapseAll={async () => {
          await api.treeCollapseAll();
          setTreeVersion((v) => v + 1);
        }}
        treemapVisible={showTreemap}
        onToggleTreemap={() => setShowTreemap((s) => !s)}
      />

      <div className="app__main" ref={mainRef}>
        {mode === "tree" && (
          <>
            <TreeTable
              generation={generation}
              sort={treeSort}
              onSort={async (s) => {
                setTreeSort(s);
                await api.treeSetSort(s);
                setTreeVersion((v) => v + 1);
              }}
              selected={selectedDir}
              onSelect={onTreeSelect}
              onContext={treeMenu}
              scrollTo={treeScrollTo}
              now={now}
              version={treeVersion}
              onToggle={onTreeToggle}
            />
            <Splitter
              orientation="vertical"
              onDelta={(d) =>
                setTreeWidthPct((p) =>
                  clamp(p + d / (mainSize.width || 1440), 0.24, 0.78),
                )
              }
              onDoubleClick={() => setTreeWidthPct(0.56)}
            />
            <FileList
              folder={selectedDirPath}
              rows={fileRows}
              sort={fileSort}
              onSort={setFileSort}
              selected={sel.ids}
              onRowMouseDown={onRowMouseDown}
              onContext={fileMenu}
              onActivate={activate}
              onKeyDown={onTableKey}
              now={now}
              scrollTo={scrollTo}
              focusIndex={focusIndex}
              query={query}
              globalMatches={query ? hogRows.total : null}
              onGoGlobal={() => setMode("hogs")}
              width={fileWidth}
            />
          </>
        )}

        {mode === "hogs" && (
          <SpaceHogs
            mode={hogMode}
            rows={hogRows}
            sort={hogSort}
            onSort={setHogSortOverride}
            selected={sel.ids}
            onRowMouseDown={onRowMouseDown}
            onContext={fileMenu}
            onActivate={activate}
            onKeyDown={onTableKey}
            now={now}
            scrollTo={scrollTo}
            focusIndex={focusIndex}
            query={query}
            hasIndex={hasIndex}
          />
        )}

        {mode === "types" && (
          <FileTypes
            generation={generation}
            filter={query}
            onCount={setTypeCount}
            onPickExtension={(ext) => {
              setSearch(`extension:${ext}`);
              setMode("hogs");
              setQuick("all");
              setHogMode("largestFirst");
            }}
          />
        )}
      </div>

      {showTreemap && (
        <>
          <div className="treemap-head">
            <span
              className="treemap-head__grip"
              onPointerDown={(e) => {
                e.preventDefault();
                const el = e.currentTarget;
                el.setPointerCapture(e.pointerId);
                let last = e.clientY;
                const move = (ev: PointerEvent) => {
                  const d = last - ev.clientY;
                  last = ev.clientY;
                  setTreemapH((h) => clamp(h + d, 90, 560));
                };
                const up = () => {
                  el.removeEventListener("pointermove", move);
                  el.removeEventListener("pointerup", up);
                };
                el.addEventListener("pointermove", move);
                el.addEventListener("pointerup", up);
              }}
            />
            <span className="treemap-head__title">TREEMAP</span>
            <IconTreemap />
            <span className="treemap-head__path">
              {treemapRootName ?? volume?.name ?? "—"}
            </span>
            {treemapRoot !== 0 && (
              <button
                className="chip"
                onClick={() => {
                  setTreemapRoot(0);
                  setTreemapRootName(null);
                }}
              >
                Whole volume
              </button>
            )}
            <span className="treemap-head__spacer" />
            <div className="legend">
              {(
                ["video", "image", "audio", "archive", "aiModel", "document", "code", "system"] as const
              ).map((c) => (
                <span className="legend__item" key={c}>
                  <span className="dot" style={{ background: CATEGORY_COLOR[c] }} />
                  {CATEGORY_LABEL[c]}
                </span>
              ))}
            </div>
          </div>
          <Treemap
            generation={generation}
            rootDir={treemapRoot}
            height={treemapHeight}
            highlight={treemapHighlight}
            onSelect={(r) => void onTreemapSelect(r)}
            onActivate={(r) =>
              api.itemDetail(r.id, r.isDir).then((d) => d && api.revealItem(d.path))
            }
            onContext={treemapMenu}
            now={now}
          />
        </>
      )}

      <StatusBar
        progress={progress}
        summary={summary}
        denied={denied}
        selectionCount={sel.ids.size}
        selectionBytes={selectionBytes}
        visibleCount={mode === "types" ? 0 : activeRows.total}
        visibleBytes={mode === "types" ? 0 : activeRows.totalSize}
        freedBytes={freedBytes}
        onRescan={doScan}
        onOpenFda={() => void api.openFullDiskAccess()}
      />

      {menu && <ContextMenu state={menu} onClose={() => setMenu(null)} />}
      {trash && (
        <TrashDialog
          preview={trash}
          now={now}
          busy={trashBusy}
          onCancel={() => setTrash(null)}
          onConfirm={() => void confirmTrash()}
        />
      )}
      {settingsOpen && settings && (
        <SettingsDialog
          settings={settings}
          onChange={(s) => void updateSettings(s)}
          denied={denied}
          progress={progress}
          onOpenFda={() => void api.openFullDiskAccess()}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

function derivedHogSort(mode: HogMode): SortSpec {
  switch (mode) {
    case "largestFirst":
      return { key: "size", desc: true };
    case "longestUnused":
      return { key: "unusedFor", desc: true };
    case "largestAndUnused":
      return { key: "cleanupScore", desc: true };
    case "recentlyUsed":
      return { key: "lastUsed", desc: true };
    case "recentlyModified":
      return { key: "modified", desc: true };
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
