import { invoke } from "@tauri-apps/api/core";
import { mockApi } from "./mock";
import type {
  DeniedInfo,
  DriveSummary,
  ExtRow,
  ExtSort,
  FileRow,
  HogMode,
  ItemDetail,
  ItemRef,
  Page,
  QuickFilter,
  ScanProgress,
  Settings,
  SortSpec,
  TrashPreview,
  TrashReport,
  TreePage,
  TreeSort,
  TreemapLayout,
  UsageMetadata,
  VolumeInfo,
} from "./types";

const realApi = {
  listVolumes: () => invoke<VolumeInfo[]>("list_volumes"),

  startScan: (path: string, volumeName?: string) =>
    invoke<void>("start_scan", { path, volumeName: volumeName ?? null }),
  cancelScan: () => invoke<void>("cancel_scan"),
  scanProgress: () => invoke<ScanProgress>("scan_progress"),
  driveSummary: () => invoke<DriveSummary>("drive_summary"),

  treePage: (offset: number, limit: number) =>
    invoke<TreePage>("tree_page", { offset, limit }),
  treeToggle: (id: number, expanded: boolean) =>
    invoke<void>("tree_toggle", { id, expanded }),
  treeSetSort: (sort: TreeSort) => invoke<void>("tree_set_sort", { sort }),
  treeExpandDepth: (depth: number) => invoke<void>("tree_expand_depth", { depth }),
  treeCollapseAll: () => invoke<void>("tree_collapse_all"),
  treeReveal: (dirId: number) => invoke<number | null>("tree_reveal", { dirId }),

  filePage: (
    dirId: number,
    sort: SortSpec,
    query: string,
    offset: number,
    limit: number,
  ) => invoke<Page<FileRow>>("file_page", { dirId, sort, query, offset, limit }),

  hogPage: (
    mode: HogMode,
    quick: QuickFilter,
    query: string,
    sort: SortSpec | null,
    offset: number,
    limit: number,
  ) =>
    invoke<Page<FileRow>>("hog_page", {
      mode,
      quick,
      query,
      sort,
      offset,
      limit,
    }),

  fileRowIndex: (dirId: number, sort: SortSpec, query: string, fileId: number) =>
    invoke<number | null>("file_row_index", { dirId, sort, query, fileId }),
  hogRowIndex: (
    mode: HogMode,
    quick: QuickFilter,
    query: string,
    sort: SortSpec | null,
    fileId: number,
  ) => invoke<number | null>("hog_row_index", { mode, quick, query, sort, fileId }),

  extensionTable: (sort: ExtSort) => invoke<ExtRow[]>("extension_table", { sort }),

  treemap: (rootDir: number, width: number, height: number, maxRects: number) =>
    invoke<TreemapLayout>("treemap", { rootDir, width, height, maxRects }),

  itemDetail: (id: number, isDir: boolean) =>
    invoke<ItemDetail | null>("item_detail", { id, isDir }),
  usageMetadata: (path: string) => invoke<UsageMetadata>("usage_metadata", { path }),
  itemPaths: (ids: number[], areDirs: boolean) =>
    invoke<string[]>("item_paths", { ids, areDirs }),
  locateFile: (fileId: number) => invoke<number | null>("locate_file", { fileId }),

  openItem: (path: string) => invoke<void>("open_item", { path }),
  revealItem: (path: string) => invoke<void>("reveal_item", { path }),
  quickLook: (path: string) => invoke<void>("quick_look", { path }),
  openFullDiskAccess: () => invoke<void>("open_full_disk_access"),

  trashPreview: (items: ItemRef[]) => invoke<TrashPreview>("trash_preview", { items }),
  trashItems: (paths: string[]) => invoke<TrashReport>("trash_items", { paths }),

  getSettings: () => invoke<Settings>("get_settings"),
  setSettings: (settings: Settings) => invoke<Settings>("set_settings", { settings }),
  deniedReport: () => invoke<DeniedInfo>("denied_report"),
};

/**
 * Outside the Tauri shell there is no Rust side to talk to, so `npm run dev` in
 * a plain browser gets the fixture harness instead. Inside the app this is
 * always the real IPC surface.
 */
const inTauri =
  typeof window !== "undefined" &&
  "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);

export const api: typeof realApi = inTauri
  ? realApi
  : (mockApi as unknown as typeof realApi);
