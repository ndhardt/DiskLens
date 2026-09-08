/**
 * Browser development harness.
 *
 * Outside the Tauri shell there is no Rust side, so the app talks to this: a
 * small in-memory index over a fixture tree covering the awkward cases (long
 * names, Japanese, emoji, empty and unreadable folders, iCloud placeholders,
 * bundles, hard links). Only reachable when `window.__TAURI_INTERNALS__` is
 * absent.
 */
import type {
  DeniedInfo,
  DriveSummary,
  ExtRow,
  ExtSort,
  FileRow,
  HogMode,
  ItemRef,
  Page,
  QuickFilter,
  ScanProgress,
  Settings,
  SortSpec,
  TrashPreview,
  TreePage,
  TreeRow,
  TreeSort,
  TreemapLayout,
  TreemapRect,
  VolumeInfo,
} from "./types";
import { CATEGORY_BY_INDEX } from "./format";

const DAY = 86_400;
const NOW = Math.floor(Date.now() / 1000);
const GB = 1024 ** 3;
const MB = 1024 ** 2;

interface MFile {
  id: number;
  name: string;
  parent: number;
  size: number;
  alloc: number;
  lastUsed: number | null;
  spotlight: boolean;
  modified: number;
  created: number;
  cloud: boolean;
}

interface MDir {
  id: number;
  name: string;
  parent: number;
  depth: number;
  children: number[];
  files: number[];
  denied: boolean;
  pkg: boolean;
  aggSize: number;
  aggAlloc: number;
  aggFiles: number;
  aggDirs: number;
  aggLastUsed: number | null;
}

const dirs: MDir[] = [];
const files: MFile[] = [];
const expanded = new Set<number>();

function mkdir(name: string, parent: number, opts: Partial<MDir> = {}): number {
  const id = dirs.length;
  dirs.push({
    id,
    name,
    parent,
    depth: parent < 0 ? 0 : dirs[parent].depth + 1,
    children: [],
    files: [],
    denied: false,
    pkg: false,
    aggSize: 0,
    aggAlloc: 0,
    aggFiles: 0,
    aggDirs: 0,
    aggLastUsed: null,
    ...opts,
  });
  if (parent >= 0) dirs[parent].children.push(id);
  return id;
}

function mkfile(name: string, parent: number, sizeMB: number, unusedDays: number | null, o: Partial<MFile> = {}) {
  const size = Math.round(sizeMB * MB);
  const id = files.length;
  files.push({
    id,
    name,
    parent,
    size,
    alloc: o.cloud ? 0 : Math.ceil(size / 4096) * 4096,
    lastUsed: unusedDays == null ? null : NOW - Math.round(unusedDays * DAY),
    spotlight: unusedDays != null && unusedDays % 3 !== 0,
    modified: NOW - Math.round((unusedDays ?? 400) * DAY * 1.2),
    created: NOW - Math.round((unusedDays ?? 500) * DAY * 1.6),
    cloud: false,
    ...o,
  });
  dirs[parent].files.push(id);
  return id;
}

// ---------------------------------------------------------------- fixture
const root = mkdir("/", -1);
const users = mkdir("Users", root);
const home = mkdir("user", users);
const movies = mkdir("Movies", home);
const downloads = mkdir("Downloads", home);
const library = mkdir("Library", home);
const documents = mkdir("Documents", home);
const pictures = mkdir("Pictures", home);
const dev = mkdir("Developer", home);
const models = mkdir("AI Models", home);
const apps = mkdir("Applications", root);
const system = mkdir("System", root);
mkdir("空のフォルダ", home);
mkdir("Private Data", library, { denied: true });

mkfile("flux1-dev.safetensors", models, 42.8 * 1024, 334);
mkfile("sdxl_base_1.0.safetensors", models, 25.6 * 1024, 512);
mkfile("llama-3-70b-instruct.Q5_K_M.gguf", models, 48.2 * 1024, 96);
mkfile("wan2.1-i2v-14b-720p.safetensors", models, 31.4 * 1024, 620);
mkfile("clip_vision_g.safetensors", models, 3.6 * 1024, 210);

mkfile("final_prores_master_v14_color_graded.mov", movies, 31.2 * 1024, 243);
mkfile("インタビュー素材_2024年12月_カメラA.mov", movies, 18.7 * 1024, 410);
mkfile("🎬 birthday party 🎂 4k.mov", movies, 9.4 * 1024, 22);
mkfile("timelapse_raw_sequence.braw", movies, 22.1 * 1024, 780);
mkfile("rough_cut_v2.mp4", movies, 2.4 * 1024, 3);
mkfile("a-really-quite-unreasonably-long-export-filename-that-someone-actually-typed-2025-final-FINAL-v7.mov", movies, 6.2 * 1024, 155);
mkfile("iCloud archive 2019.mov", movies, 14.3 * 1024, 1600, { cloud: true });

mkfile("Xcode_16.2.xip", downloads, 7.8 * 1024, 470);
mkfile("archive.zip", downloads, 18.3 * 1024, 766);
mkfile("dataset-imagenet-subset.tar.gz", downloads, 11.9 * 1024, 900);
mkfile("installer.dmg", downloads, 1.4 * 1024, 40);
mkfile("報告書_最終版_修正済み.pdf", downloads, 12, 88);

const cache = mkdir("Caches", library);
const containers = mkdir("Containers", library);
mkfile("blender_cache.blend1", cache, 24.7 * 1024, 511);
mkfile("com.apple.metal.shadercache", cache, 840, 12);
mkfile("Chromium Cache_Data", cache, 3.2 * 1024, 1);
mkfile("group.container.db", containers, 620, 30);

mkfile("thesis_draft.pages", documents, 34, 620);
mkfile("家計簿2024.numbers", documents, 8, 190);
mkfile("notes.md", documents, 0.3, 0);

mkfile("shoot_2021_raw.psb", pictures, 4.8 * 1024, 1240);
mkfile("Lightroom Catalog.lrcat", pictures, 2.1 * 1024, 60);
mkfile("スクリーンショット 2025-03-14 15.42.19.png", pictures, 3.4, 200);

const proj = mkdir("disklens", dev);
const node = mkdir("node_modules", proj);
const target = mkdir("target", proj);
mkfile("libdisklens.rlib", target, 320, 0);
mkfile("index.tsx", proj, 0.04, 0);
for (let i = 0; i < 140; i++) {
  mkfile(`package-${i}.tgz`, node, 0.4 + (i % 17) * 0.9, i % 90);
}

const xcodeApp = mkdir("Xcode.app", apps, { pkg: true });
const xcodeContents = mkdir("Contents", xcodeApp);
mkfile("Xcode", xcodeContents, 9.6 * 1024, 5);
const photosLib = mkdir("Photos Library.photoslibrary", pictures, { pkg: true });
mkfile("originals.db", photosLib, 118 * 1024, 2);

const sysLib = mkdir("Library", system);
mkfile("dyld_shared_cache_arm64e", sysLib, 4.2 * 1024, 0);
mkfile("CoreServices.framework", sysLib, 1.8 * 1024, 0);

// A wide folder, to exercise virtualization.
const bulk = mkdir("Bulk", home);
for (let i = 0; i < 1500; i++) {
  mkfile(`clip_${String(i).padStart(4, "0")}.mp4`, bulk, 4 + (i % 200) * 1.1, (i * 7) % 1100);
}

// --------------------------------------------------------------- aggregate
for (let i = dirs.length - 1; i >= 0; i--) {
  const d = dirs[i];
  let size = 0;
  let alloc = 0;
  let n = 0;
  let last: number | null = null;
  for (const fid of d.files) {
    const f = files[fid];
    size += f.size;
    alloc += f.alloc;
    n++;
    if (f.lastUsed != null) last = last == null ? f.lastUsed : Math.max(last, f.lastUsed);
  }
  let nd = 0;
  for (const cid of d.children) {
    const c = dirs[cid];
    size += c.aggSize;
    alloc += c.aggAlloc;
    n += c.aggFiles;
    nd += c.aggDirs + 1;
    if (c.aggLastUsed != null) last = last == null ? c.aggLastUsed : Math.max(last, c.aggLastUsed);
  }
  d.aggSize = size;
  d.aggAlloc = alloc;
  d.aggFiles = n;
  d.aggDirs = nd;
  d.aggLastUsed = last;
}
const key = (a: number) => Math.max(dirs[a].aggAlloc, dirs[a].aggSize);
for (const d of dirs) {
  d.children.sort((a, b) => key(b) - key(a));
  d.files.sort((a, b) => files[b].alloc - files[a].alloc);
}
expanded.add(root);
expanded.add(users);

const CAPACITY = 994.7 * GB;
const FREE = 282.3 * GB;

function dirPath(id: number): string {
  const parts: string[] = [];
  let cur = id;
  while (cur >= 0) {
    parts.unshift(dirs[cur].name);
    cur = dirs[cur].parent;
  }
  return ("/" + parts.join("/")).replace(/\/+/g, "/");
}
const filePath = (id: number) => {
  const p = dirPath(files[id].parent);
  return p.endsWith("/") ? p + files[id].name : `${p}/${files[id].name}`;
};

const extOf = (n: string) => {
  const i = n.lastIndexOf(".");
  return i <= 0 ? "" : n.slice(i + 1).toLowerCase();
};
const CAT: Record<string, string> = {
  mov: "video", mp4: "video", braw: "video",
  png: "image", psb: "image", lrcat: "image",
  safetensors: "aiModel", gguf: "aiModel", db: "aiModel",
  zip: "archive", gz: "archive", tgz: "archive", dmg: "archive", xip: "archive",
  pdf: "document", pages: "document", numbers: "document", md: "document",
  tsx: "code", rlib: "system", blend1: "other",
};
const catOf = (name: string, sys: boolean) =>
  sys ? "system" : (CAT[extOf(name)] ?? "other");
const KIND: Record<string, string> = {
  video: "Video", image: "Images", audio: "Audio", archive: "Archive",
  aiModel: "AI Model", document: "Documents", code: "Code", system: "System", other: "Other",
};
const isSystem = (p: string) => /^\/(System|usr|bin|sbin|private)(\/|$)/.test(p);

function fileRow(id: number, rank: number): FileRow {
  const f = files[id];
  const dir = dirPath(f.parent);
  const full = filePath(id);
  const sys = isSystem(full);
  const cat = catOf(f.name, sys);
  const size = Math.max(f.alloc, f.size);
  const unusedDays = f.lastUsed == null ? null : (NOW - f.lastUsed) / DAY;
  const sizeScore = Math.log2(size / MB + 1);
  const unusedScore = Math.log2((unusedDays ?? 30 * 0.6) + 2);
  return {
    id,
    rank,
    name: f.name,
    size: f.size,
    alloc: f.alloc,
    lastUsed: f.lastUsed,
    lastUsedSource: f.lastUsed == null ? "unknown" : f.spotlight ? "spotlight" : "fileSystemAccessTime",
    accessed: f.lastUsed,
    modified: f.modified,
    created: f.created,
    ext: extOf(f.name),
    dirPath: dir,
    kind: KIND[cat],
    category: cat as FileRow["category"],
    cleanupScore: Math.round(Math.min(100, (sizeScore * unusedScore) / 1.65)),
    diskPct: (size / CAPACITY) * 100,
    cloud: f.cloud,
    protected: sys || /^\/Library|\/System/.test(full),
    immutable: isSystem(full),
    isDir: false,
    isPackage: false,
  };
}

// ------------------------------------------------------------------ paging
function pageOf(ids: number[], offset: number, limit: number): Page<FileRow> {
  let max = 0;
  let total = 0;
  for (const id of ids) {
    const s = Math.max(files[id].alloc, files[id].size);
    total += s;
    if (s > max) max = s;
  }
  return {
    rows: ids.slice(offset, offset + limit).map((id, i) => fileRow(id, offset + i + 1)),
    total: ids.length,
    offset,
    maxSize: max,
    totalSize: total,
  };
}

function matches(id: number, q: string): boolean {
  if (!q.trim()) return true;
  const f = files[id];
  const row = () => fileRow(id, 0);
  for (const term of q.trim().split(/\s+/)) {
    const [k, v] = term.includes(":") ? term.split(":") : ["", term];
    const lower = f.name.toLowerCase();
    let ok: boolean;
    switch (k.toLowerCase()) {
      case "size": {
        const m = /([<>]=?)?\s*([\d.]+)\s*([kmgt]?b?)/i.exec(v) ?? [];
        const mult = { k: 1024, m: MB, g: GB, t: GB * 1024 }[(m[3] ?? "")[0]?.toLowerCase() ?? ""] ?? 1;
        const n = parseFloat(m[2] ?? "0") * mult;
        const s = Math.max(f.alloc, f.size);
        ok = m[1] === "<" ? s < n : m[1] === "<=" ? s <= n : m[1] === ">" ? s > n : s >= n;
        break;
      }
      case "unused": {
        const m = /([<>]=?)?\s*([\d.]+)\s*([dwmy])?/i.exec(v) ?? [];
        const mult = { d: 1, w: 7, m: 30.4375, y: 365.25 }[(m[3] ?? "d").toLowerCase()] ?? 1;
        const days = parseFloat(m[2] ?? "0") * mult;
        if (f.lastUsed == null) ok = false;
        else {
          const d = (NOW - f.lastUsed) / DAY;
          ok = m[1] === "<" ? d < days : m[1] === ">" ? d > days : d >= days;
        }
        break;
      }
      case "ext":
      case "extension":
        ok = extOf(f.name) === v.replace(/^\./, "").toLowerCase();
        break;
      case "kind":
        ok = row().category.toLowerCase() === v.toLowerCase();
        break;
      case "path":
        ok = dirPath(f.parent).toLowerCase().includes(v.toLowerCase());
        break;
      default:
        ok = term.includes("*")
          ? new RegExp("^" + term.toLowerCase().replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$").test(lower)
          : lower.includes(term.toLowerCase());
    }
    if (!ok) return false;
  }
  return true;
}

function quickOk(id: number, q: QuickFilter): boolean {
  const f = files[id];
  const s = Math.max(f.alloc, f.size);
  const d = f.lastUsed == null ? null : (NOW - f.lastUsed) / DAY;
  switch (q) {
    case "all": return true;
    case "size1G": return s >= GB;
    case "size5G": return s >= 5 * GB;
    case "size10G": return s >= 10 * GB;
    case "unused3m": return d != null && d >= 90;
    case "unused6m": return d != null && d >= 182;
    case "unused1y": return d != null && d >= 365;
    case "unused2y": return d != null && d >= 730;
  }
}

function sortIds(ids: number[], spec: SortSpec): number[] {
  const dir = spec.desc ? -1 : 1;
  const t = (v: number | null, invert: boolean) =>
    v == null ? (invert ? -Infinity : Infinity) * -dir : v;
  return [...ids].sort((a, b) => {
    const fa = files[a];
    const fb = files[b];
    let d = 0;
    switch (spec.key) {
      case "name": d = fa.name.localeCompare(fb.name); break;
      case "size": d = Math.max(fa.alloc, fa.size) - Math.max(fb.alloc, fb.size); break;
      case "allocated": d = fa.alloc - fb.alloc; break;
      case "lastUsed": d = t(fa.lastUsed, false) - t(fb.lastUsed, false); break;
      case "unusedFor": d = t(fb.lastUsed, true) - t(fa.lastUsed, true); break;
      case "modified": d = fa.modified - fb.modified; break;
      case "created": d = fa.created - fb.created; break;
      case "extension": d = extOf(fa.name).localeCompare(extOf(fb.name)); break;
      case "path": d = dirPath(fa.parent).localeCompare(dirPath(fb.parent)); break;
      case "kind": d = fileRow(a, 0).kind.localeCompare(fileRow(b, 0).kind); break;
      case "cleanupScore": d = fileRow(a, 0).cleanupScore - fileRow(b, 0).cleanupScore; break;
    }
    return d * dir || a - b;
  });
}

// Outermost bundles get a stand-in row, exactly as the Rust index does, so the
// harness ranks "Photos Library.photoslibrary" rather than the database inside.
const inPackage = new Set<number>();
const syntheticOfDir = new Map<number, number>();
{
  const markSubtree = (id: number) => {
    for (const f of dirs[id].files) inPackage.add(f);
    for (const c of dirs[id].children) markSubtree(c);
  };
  const outermost: number[] = [];
  const walk = (id: number, insidePkg: boolean) => {
    const d = dirs[id];
    if (d.pkg && !insidePkg) outermost.push(id);
    for (const c of d.children) walk(c, insidePkg || d.pkg);
  };
  walk(root, false);
  for (const id of outermost) {
    markSubtree(id);
    const d = dirs[id];
    const fid = files.length;
    files.push({
      id: fid, name: d.name, parent: d.parent,
      size: d.aggSize, alloc: d.aggAlloc,
      lastUsed: d.aggLastUsed, spotlight: true,
      modified: d.aggLastUsed ?? NOW, created: d.aggLastUsed ?? NOW, cloud: false,
    });
    syntheticOfDir.set(id, fid);
  }
}
const syntheticIds = new Set(syntheticOfDir.values());
const allFileIds = files.filter((f) => !syntheticIds.has(f.id)).map((f) => f.id);
const groupedItemIds = files
  .filter((f) => syntheticIds.has(f.id) || !inPackage.has(f.id))
  .map((f) => f.id);

// --------------------------------------------------------------- tree rows
function treeIds(): number[] {
  const out: number[] = [];
  const walk = (id: number) => {
    out.push(id);
    if (expanded.has(id)) for (const c of dirs[id].children) walk(c);
  };
  walk(root);
  return out;
}

function treeRow(id: number): TreeRow {
  const d = dirs[id];
  const parentSize = d.parent < 0 ? d.aggSize : dirs[d.parent].aggSize;
  const path = dirPath(id);
  return {
    id,
    name: d.name === "/" ? "Macintosh HD" : d.name,
    depth: d.depth,
    expanded: expanded.has(id),
    hasChildren: d.children.length > 0,
    pctParent: parentSize > 0 ? (d.aggSize / parentSize) * 100 : 0,
    size: d.aggSize,
    alloc: d.aggAlloc,
    files: d.aggFiles,
    folders: d.aggDirs,
    lastUsed: d.aggLastUsed,
    lastUsedSource: d.aggLastUsed == null ? "unknown" : "fileSystemAccessTime",
    modified: d.aggLastUsed,
    path,
    protected: isSystem(path) || path.startsWith("/System"),
    immutable: isSystem(path),
    denied: d.denied,
    package: d.pkg,
    category: (d.pkg ? "other" : isSystem(path) ? "system" : "other") as TreeRow["category"],
  };
}

// ----------------------------------------------------------------- treemap
interface Item { id: number; isDir: boolean; value: number }

function squarify(items: Item[], rect: { x: number; y: number; w: number; h: number }, total: number, out: [Item, typeof rect][]) {
  let areaLeft = rect.w * rect.h;
  let valueLeft = total;
  let cur = { ...rect };
  let i = 0;
  const worst = (max: number, min: number, sum: number, short: number, scale: number) => {
    const s = sum * scale;
    if (s <= 0 || short <= 0) return Infinity;
    return Math.max((short * short * max * scale) / (s * s), (s * s) / (short * short * min * scale));
  };
  while (i < items.length) {
    if (cur.w <= 0 || cur.h <= 0 || valueLeft <= 0) break;
    const scale = areaLeft / valueLeft;
    const short = Math.min(cur.w, cur.h);
    let end = i + 1;
    let rowValue = items[i].value;
    let best = worst(items[i].value, items[i].value, rowValue, short, scale);
    while (end < items.length) {
      const nv = rowValue + items[end].value;
      const r = worst(items[i].value, items[end].value, nv, short, scale);
      if (r > best) break;
      best = r;
      rowValue = nv;
      end++;
    }
    const rowArea = rowValue * scale;
    const thick = short > 0 ? rowArea / short : 0;
    const horiz = cur.w <= cur.h;
    let off = 0;
    for (const it of items.slice(i, end)) {
      const along = short * (rowValue > 0 ? it.value / rowValue : 0);
      out.push([
        it,
        horiz
          ? { x: cur.x + off, y: cur.y, w: along, h: thick }
          : { x: cur.x, y: cur.y + off, w: thick, h: along },
      ]);
      off += along;
    }
    cur = horiz
      ? { x: cur.x, y: cur.y + thick, w: cur.w, h: Math.max(0, cur.h - thick) }
      : { x: cur.x + thick, y: cur.y, w: Math.max(0, cur.w - thick), h: cur.h };
    areaLeft = Math.max(0, areaLeft - rowArea);
    valueLeft = Math.max(0, valueLeft - rowValue);
    i = end;
  }
}

function buildTreemap(dirId: number, w: number, h: number, budget: number): TreemapRect[] {
  const out: TreemapRect[] = [];
  const catIndex = (c: string) => Math.max(0, CATEGORY_BY_INDEX.indexOf(c as never));
  const place = (id: number, rect: { x: number; y: number; w: number; h: number }, depth: number) => {
    if (out.length >= budget || rect.w < 1 || rect.h < 1) return;
    const d = dirs[id];
    const items: Item[] = [
      ...d.children.filter((c) => dirs[c].aggAlloc > 0).map((c) => ({ id: c, isDir: true, value: dirs[c].aggAlloc })),
      ...d.files.filter((f) => files[f].alloc > 0).map((f) => ({ id: f, isDir: false, value: files[f].alloc })),
    ].sort((a, b) => b.value - a.value);
    if (!items.length) return;
    const total = items.reduce((a, b) => a + b.value, 0);
    const placed: [Item, typeof rect][] = [];
    squarify(items, rect, total, placed);
    for (const [it, r] of placed) {
      if (out.length >= budget || r.w * r.h < 6) continue;
      const name = it.isDir ? dirs[it.id].name : files[it.id].name;
      const open = it.isDir && depth < 12 && r.w * r.h >= 900 && r.w > 4 && r.h > 4;
      out.push({
        x: r.x, y: r.y, w: r.w, h: r.h,
        id: it.id, isDir: it.isDir, depth,
        cat: catIndex(it.isDir ? "other" : catOf(name, isSystem(filePath(it.id)))),
        size: it.value, name, collapsed: it.isDir && !open,
      });
      if (open) place(it.id, { x: r.x + 1, y: r.y + 1, w: Math.max(0, r.w - 2), h: Math.max(0, r.h - 2) }, depth + 1);
    }
  };
  place(dirId, { x: 0, y: 0, w, h }, 0);
  return out;
}

// ------------------------------------------------------------------ facade
let settings: Settings = {
  language: "en",
  sizeBasis: "allocated",
  groupBundles: true,
  followSymlinks: false,
  crossVolumes: false,
  fastScanner: true,
  spotlightEnrichment: true,
  spotlightBudget: 30000,
  showTreemap: true,
};

const scanned: ScanProgress = {
  running: false,
  files: files.length,
  dirs: dirs.length - 1,
  bytes: dirs[root].aggSize,
  alloc: dirs[root].aggAlloc,
  skipped: 142,
  current: "",
  elapsedMs: 4820,
  done: true,
  cancelled: false,
  error: null,
  scanner: "macos-getattrlistbulk",
  root: "/",
  spotlightDone: true,
  spotlightHits: 1284,
};

const volume: VolumeInfo = {
  name: "Macintosh HD",
  path: "/",
  fsType: "APFS",
  total: CAPACITY,
  free: FREE,
  used: CAPACITY - FREE,
  isRoot: true,
  readOnly: false,
  removable: false,
};

const ok = <T,>(v: T) => Promise.resolve(v);

export const mockApi = {
  listVolumes: () =>
    ok<VolumeInfo[]>([
      volume,
      { name: "Samsung T7 Shield", path: "/Volumes/Samsung T7 Shield", fsType: "APFS", total: 2 * 1024 * GB, free: 431 * GB, used: 2 * 1024 * GB - 431 * GB, isRoot: false, readOnly: false, removable: true },
      { name: "TimeMachine", path: "/Volumes/TimeMachine", fsType: "HFS", total: 4 * 1024 * GB, free: 120 * GB, used: 4 * 1024 * GB - 120 * GB, isRoot: false, readOnly: true, removable: true },
    ]),
  startScan: () => ok(undefined),
  cancelScan: () => ok(undefined),
  scanProgress: () => ok(scanned),
  driveSummary: () =>
    ok<DriveSummary>({
      name: "Macintosh HD", path: "/", fsType: "APFS",
      capacity: CAPACITY, used: CAPACITY - FREE, free: FREE,
      usedPct: ((CAPACITY - FREE) / CAPACITY) * 100,
      scannedBytes: dirs[root].aggSize, scannedAlloc: dirs[root].aggAlloc,
      files: files.length, folders: dirs.length - 1, skipped: 142,
      durationMs: 4820, hasIndex: true, categoryBytes: {},
    }),

  treePage: (offset: number, limit: number) => {
    const ids = treeIds();
    return ok<TreePage>({
      rows: ids.slice(offset, offset + limit).map(treeRow),
      total: ids.length,
      offset,
      rootId: root,
    });
  },
  treeToggle: (id: number, on: boolean) => {
    if (on) expanded.add(id);
    else expanded.delete(id);
    return ok(undefined);
  },
  treeSetSort: (_s: TreeSort) => ok(undefined),
  treeExpandDepth: (depth: number) => {
    expanded.clear();
    for (const d of dirs) if (d.depth < depth) expanded.add(d.id);
    return ok(undefined);
  },
  treeCollapseAll: () => {
    expanded.clear();
    expanded.add(root);
    return ok(undefined);
  },
  treeReveal: (dirId: number) => {
    let cur = dirs[dirId].parent;
    while (cur >= 0) {
      expanded.add(cur);
      cur = dirs[cur].parent;
    }
    return ok(treeIds().indexOf(dirId));
  },

  filePage: (dirId: number, sort: SortSpec, query: string, offset: number, limit: number) =>
    ok(pageOf(sortIds(dirs[dirId].files.filter((f) => matches(f, query)), sort), offset, limit)),

  hogPage: (mode: HogMode, quick: QuickFilter, query: string, sort: SortSpec | null, offset: number, limit: number) => {
    const spec = sort ?? ({
      largestFirst: { key: "size", desc: true },
      longestUnused: { key: "unusedFor", desc: true },
      largestAndUnused: { key: "cleanupScore", desc: true },
      recentlyUsed: { key: "lastUsed", desc: true },
      recentlyModified: { key: "modified", desc: true },
    } as Record<HogMode, SortSpec>)[mode];
    const pool = settings.groupBundles ? groupedItemIds : allFileIds;
    return ok(pageOf(sortIds(pool.filter((f) => quickOk(f, quick) && matches(f, query)), spec), offset, limit));
  },

  fileRowIndex: (dirId: number, sort: SortSpec, query: string, fileId: number) =>
    ok(sortIds(dirs[dirId].files.filter((f) => matches(f, query)), sort).indexOf(fileId)),
  hogRowIndex: () => ok(null),

  extensionTable: (sort: ExtSort) => {
    const by = new Map<string, ExtRow>();
    for (const f of files) {
      if (syntheticIds.has(f.id)) continue;
      const e = extOf(f.name);
      const cat = catOf(f.name, isSystem(filePath(f.id)));
      const r = by.get(e) ?? {
        ext: e, label: e ? `.${e}` : "(no extension)",
        category: cat as ExtRow["category"], categoryLabel: KIND[cat],
        files: 0, size: 0, alloc: 0, pctDrive: 0, average: 0, largest: 0, largestName: "",
      };
      r.files++; r.size += f.size; r.alloc += f.alloc;
      if (f.size > r.largest) { r.largest = f.size; r.largestName = f.name; }
      by.set(e, r);
    }
    const rows = [...by.values()].map((r) => ({
      ...r, average: Math.round(r.size / r.files), pctDrive: (r.alloc / CAPACITY) * 100,
    }));
    const d = sort.desc ? -1 : 1;
    rows.sort((a, b) => {
      switch (sort.key) {
        case "extension": return a.ext.localeCompare(b.ext) * d;
        case "category": return a.categoryLabel.localeCompare(b.categoryLabel) * d;
        case "files": return (a.files - b.files) * d;
        case "allocated": return (a.alloc - b.alloc) * d;
        case "pctDrive": return (a.pctDrive - b.pctDrive) * d;
        case "averageSize": return (a.average - b.average) * d;
        case "largestFile": return (a.largest - b.largest) * d;
        default: return (a.size - b.size) * d;
      }
    });
    return ok(rows);
  },

  treemap: (rootDir: number, width: number, height: number, maxRects: number) => {
    const rects = buildTreemap(rootDir, width, height, maxRects);
    return ok<TreemapLayout>({
      rects, rootId: rootDir,
      rootName: dirs[rootDir].name,
      rootSize: dirs[rootDir].aggAlloc,
      truncated: rects.length >= maxRects,
    });
  },

  cleanupGroups: () => {
    const mk = (id: string, safety: "safe" | "review", ids: number[]) => ({
      id,
      safety,
      items: ids.length,
      files: ids.length,
      size: ids.reduce((a, i) => a + Math.max(files[i].alloc, files[i].size), 0),
      truncated: false,
    });
    const inDir = (name: string) =>
      files.filter((f) => dirPath(f.parent).includes(name)).map((f) => f.id);
    const old = (days: number, min = 0) =>
      files
        .filter(
          (f) =>
            !syntheticIds.has(f.id) &&
            f.lastUsed != null &&
            (NOW - f.lastUsed) / DAY >= days &&
            Math.max(f.alloc, f.size) >= min,
        )
        .map((f) => f.id);
    return ok(
      [
        mk("appCaches", "safe", inDir("/Caches")),
        mk("largeUnused", "review", old(365, 5 * GB)),
        mk("oldDownloads", "review", inDir("/Downloads").filter((i) => old(180).includes(i))),
      ].filter((g) => g.items > 0),
    );
  },
  cleanupGroupPage: (group: string, offset: number, limit: number) => {
    const inDir = (name: string) =>
      files.filter((f) => dirPath(f.parent).includes(name)).map((f) => f.id);
    const old = (days: number, min = 0) =>
      files
        .filter(
          (f) =>
            !syntheticIds.has(f.id) &&
            f.lastUsed != null &&
            (NOW - f.lastUsed) / DAY >= days &&
            Math.max(f.alloc, f.size) >= min,
        )
        .map((f) => f.id);
    const map: Record<string, number[]> = {
      appCaches: inDir("/Caches"),
      largeUnused: old(365, 5 * GB),
      oldDownloads: inDir("/Downloads").filter((i) => old(180).includes(i)),
    };
    const ids = (map[group] ?? []).sort(
      (a, b) => Math.max(files[b].alloc, files[b].size) - Math.max(files[a].alloc, files[a].size),
    );
    return ok(pageOf(ids, offset, limit));
  },
  cleanupSelection: (groups: string[]) => {
    const inDir = (name: string) =>
      files.filter((f) => dirPath(f.parent).includes(name)).map((f) => f.id);
    const old = (days: number, min = 0) =>
      files
        .filter(
          (f) =>
            !syntheticIds.has(f.id) &&
            f.lastUsed != null &&
            (NOW - f.lastUsed) / DAY >= days &&
            Math.max(f.alloc, f.size) >= min,
        )
        .map((f) => f.id);
    const map: Record<string, number[]> = {
      appCaches: inDir("/Caches"),
      largeUnused: old(365, 5 * GB),
      oldDownloads: inDir("/Downloads").filter((i) => old(180).includes(i)),
    };
    return ok(groups.flatMap((g) => (map[g] ?? []).map((id) => ({ id, isDir: false }))));
  },

  itemDetail: (id: number, isDir: boolean) => {
    if (isDir) {
      const d = dirs[id];
      const r = treeRow(id);
      return ok({
        id, isDir: true, name: d.name, path: r.path, size: d.aggSize, alloc: d.aggAlloc,
        kind: "Folder", category: "other" as const, lastUsed: d.aggLastUsed,
        lastUsedSource: "fileSystemAccessTime" as const, accessed: d.aggLastUsed,
        modified: d.aggLastUsed, created: null, cleanupScore: 0, cloud: false,
        protected: r.protected, immutable: r.immutable, package: d.pkg,
        files: d.aggFiles, folders: d.aggDirs,
      });
    }
    const r = fileRow(id, 0);
    return ok({ ...r, path: filePath(id), package: false, files: 0, folders: 0 });
  },
  usageMetadata: () => ok({ lastUsed: null, accessed: null, modified: null, created: null, source: "unknown" as const }),
  itemPaths: (ids: number[], areDirs: boolean) => ok(ids.map((i) => (areDirs ? dirPath(i) : filePath(i)))),
  locateFile: (fileId: number) => ok(files[fileId].parent),

  openItem: () => ok(undefined),
  revealItem: () => ok(undefined),
  quickLook: () => ok(undefined),
  openFullDiskAccess: () => ok(undefined),

  trashPreview: (items: ItemRef[]) =>
    ok<TrashPreview>({
      items: items.map((it) => {
        const p = it.isDir ? dirPath(it.id) : filePath(it.id);
        const f = it.isDir ? null : files[it.id];
        return {
          path: p,
          name: it.isDir ? dirs[it.id].name : f!.name,
          size: it.isDir ? dirs[it.id].aggAlloc : Math.max(f!.alloc, f!.size),
          lastUsed: it.isDir ? dirs[it.id].aggLastUsed : f!.lastUsed,
          protected: /^\/(System|Library)/.test(p),
          immutable: isSystem(p),
          isDir: it.isDir,
        };
      }),
      count: items.length,
      totalSize: items.reduce((a, it) => a + (it.isDir ? dirs[it.id].aggAlloc : Math.max(files[it.id].alloc, files[it.id].size)), 0),
      blocked: items.filter((it) => isSystem(it.isDir ? dirPath(it.id) : filePath(it.id))).length,
    }),
  trashItems: () => ok({ moved: 0, failed: 0, bytesFreed: 0, results: [] }),

  getSettings: () => ok(settings),
  setSettings: (s: Settings) => {
    settings = s;
    return ok(s);
  },
  deniedReport: () =>
    ok<DeniedInfo>({
      count: 142,
      samples: ["/Users/user/Library/Private Data", "/private/var/db/ConfigurationProfiles"],
      fullDiskAccess: false,
    }),
};
