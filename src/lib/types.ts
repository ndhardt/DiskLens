export type Category =
  | "video"
  | "image"
  | "audio"
  | "archive"
  | "aiModel"
  | "document"
  | "code"
  | "system"
  | "other";

export type LastUsedSource = "spotlight" | "fileSystemAccessTime" | "unknown";

export interface VolumeInfo {
  name: string;
  path: string;
  fsType: string;
  total: number;
  free: number;
  used: number;
  isRoot: boolean;
  readOnly: boolean;
  removable: boolean;
}

export interface ScanProgress {
  running: boolean;
  files: number;
  dirs: number;
  bytes: number;
  alloc: number;
  skipped: number;
  current: string;
  elapsedMs: number;
  done: boolean;
  cancelled: boolean;
  error: string | null;
  scanner: string;
  root: string;
  spotlightDone: boolean;
  spotlightHits: number;
}

export interface DriveSummary {
  name: string;
  path: string;
  fsType: string;
  capacity: number;
  used: number;
  free: number;
  usedPct: number;
  scannedBytes: number;
  scannedAlloc: number;
  files: number;
  folders: number;
  skipped: number;
  durationMs: number;
  hasIndex: boolean;
  categoryBytes: Record<string, number>;
}

export interface TreeRow {
  id: number;
  name: string;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  pctParent: number;
  size: number;
  alloc: number;
  files: number;
  folders: number;
  lastUsed: number | null;
  lastUsedSource: LastUsedSource;
  modified: number | null;
  path: string;
  protected: boolean;
  immutable: boolean;
  denied: boolean;
  package: boolean;
  category: Category;
}

export interface FileRow {
  id: number;
  rank: number;
  name: string;
  size: number;
  alloc: number;
  lastUsed: number | null;
  lastUsedSource: LastUsedSource;
  accessed: number | null;
  modified: number | null;
  created: number | null;
  ext: string;
  dirPath: string;
  kind: string;
  category: Category;
  cleanupScore: number;
  diskPct: number;
  cloud: boolean;
  protected: boolean;
  immutable: boolean;
  isDir: boolean;
  isPackage: boolean;
}

export interface ExtRow {
  ext: string;
  label: string;
  category: Category;
  categoryLabel: string;
  files: number;
  size: number;
  alloc: number;
  pctDrive: number;
  average: number;
  largest: number;
  largestName: string;
}

export interface Page<T> {
  rows: T[];
  total: number;
  offset: number;
  maxSize: number;
  totalSize: number;
}

export interface TreePage {
  rows: TreeRow[];
  total: number;
  offset: number;
  rootId: number;
}

export interface TreemapRect {
  x: number;
  y: number;
  w: number;
  h: number;
  id: number;
  isDir: boolean;
  depth: number;
  cat: number;
  size: number;
  name: string;
  collapsed: boolean;
}

export interface TreemapLayout {
  rects: TreemapRect[];
  rootId: number;
  rootName: string;
  rootSize: number;
  truncated: boolean;
}

export interface ItemDetail {
  id: number;
  isDir: boolean;
  name: string;
  path: string;
  size: number;
  alloc: number;
  kind: string;
  category: Category;
  lastUsed: number | null;
  lastUsedSource: LastUsedSource;
  accessed: number | null;
  modified: number | null;
  created: number | null;
  cleanupScore: number;
  cloud: boolean;
  protected: boolean;
  immutable: boolean;
  package: boolean;
  files: number;
  folders: number;
}

export interface UsageMetadata {
  lastUsed: number | null;
  accessed: number | null;
  modified: number | null;
  created: number | null;
  source: LastUsedSource;
}

export interface Settings {
  language: "auto" | "en" | "ja";
  sizeBasis: "allocated" | "logical";
  groupBundles: boolean;
  followSymlinks: boolean;
  crossVolumes: boolean;
  fastScanner: boolean;
  spotlightEnrichment: boolean;
  spotlightBudget: number;
  showTreemap: boolean;
}

export interface TrashPreviewItem {
  path: string;
  name: string;
  size: number;
  lastUsed: number | null;
  protected: boolean;
  immutable: boolean;
  isDir: boolean;
}

export interface TrashPreview {
  items: TrashPreviewItem[];
  count: number;
  totalSize: number;
  blocked: number;
}

export interface TrashReport {
  moved: number;
  failed: number;
  bytesFreed: number;
  results: { path: string; ok: boolean; error: string | null; bytes: number }[];
}

export interface DeniedInfo {
  count: number;
  samples: string[];
  fullDiskAccess: boolean;
}

export type SortKey =
  | "name"
  | "size"
  | "allocated"
  | "lastUsed"
  | "modified"
  | "created"
  | "extension"
  | "path"
  | "cleanupScore"
  | "unusedFor"
  | "kind";

export interface SortSpec {
  key: SortKey;
  desc: boolean;
}

export type TreeSortKey =
  | "name"
  | "pctParent"
  | "size"
  | "allocated"
  | "files"
  | "folders"
  | "lastUsed"
  | "unusedFor";

export interface TreeSort {
  key: TreeSortKey;
  desc: boolean;
}

export type ExtSortKey =
  | "extension"
  | "category"
  | "files"
  | "totalSize"
  | "allocated"
  | "pctDrive"
  | "averageSize"
  | "largestFile";

export interface ExtSort {
  key: ExtSortKey;
  desc: boolean;
}

export type HogMode =
  | "largestFirst"
  | "longestUnused"
  | "largestAndUnused"
  | "recentlyUsed"
  | "recentlyModified";

export type QuickFilter =
  | "all"
  | "size1G"
  | "size5G"
  | "size10G"
  | "unused3m"
  | "unused6m"
  | "unused1y"
  | "unused2y";

export type Mode = "tree" | "hogs" | "types" | "cleanup";

export type Safety = "safe" | "review";

export interface CleanupGroup {
  id: string;
  safety: Safety;
  /** Top-level entries that would be moved. */
  items: number;
  /** Files below them, for context. */
  files: number;
  size: number;
  truncated: boolean;
}

export interface ItemRef {
  id: number;
  isDir: boolean;
}
