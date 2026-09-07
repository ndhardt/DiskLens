//! Tauri command surface.
//!
//! Each command returns the slice the UI is about to paint. Sorting, filtering
//! and aggregation happen here, over the resident index.

use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::index::directories::{TreeRow, TreeSort};
use crate::index::extensions::{ExtRow, ExtSort};
use crate::index::files::{self, FileRow, HogMode, QuickFilter, SortSpec};
use crate::metadata::UsageMetadata;
use crate::model::*;
use crate::state::{self, AppState, DriveSummary, ScanProgress, Settings};
use crate::trash::{TrashOutcome, TrashReport};
use crate::treemap::TreemapLayout;
use crate::volumes::VolumeInfo;

type Shared<'a> = State<'a, Arc<AppState>>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub rows: Vec<T>,
    pub total: usize,
    pub offset: usize,
    /// Largest size in the selection, for the in-row size bars.
    pub max_size: u64,
    /// Sum over the selection, not just this page.
    pub total_size: u64,
}

// ---------------------------------------------------------------- volumes

#[tauri::command]
pub fn list_volumes(state: Shared) -> Vec<VolumeInfo> {
    let v = crate::volumes::list_volumes();
    *state.volumes.write() = v.clone();
    v
}

// ------------------------------------------------------------------- scan

#[tauri::command]
pub fn start_scan(
    app: AppHandle,
    state: Shared,
    path: String,
    volume_name: Option<String>,
) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_dir() {
        return Err(format!("{path} is not a folder"));
    }
    let name = volume_name.unwrap_or_else(|| {
        crate::volumes::list_volumes()
            .into_iter()
            .find(|v| v.path == path)
            .map(|v| v.name)
            .unwrap_or_else(|| path.clone())
    });
    state::spawn_scan(app, Arc::clone(&state), p, name);
    Ok(())
}

#[tauri::command]
pub fn cancel_scan(state: Shared) {
    if let Some(c) = state.cancel.lock().as_ref() {
        c.store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

#[tauri::command]
pub fn scan_progress(state: Shared) -> ScanProgress {
    state.progress.read().clone()
}

#[tauri::command]
pub fn drive_summary(state: Shared) -> DriveSummary {
    state::drive_summary(&state)
}

// ------------------------------------------------------------------- tree

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreePage {
    pub rows: Vec<TreeRow>,
    pub total: usize,
    pub offset: usize,
    pub root_id: u32,
}

#[tauri::command]
pub fn tree_page(state: Shared, offset: usize, limit: usize) -> TreePage {
    let mut guard = state.index.write();
    let Some(ix) = guard.as_mut() else {
        return TreePage {
            rows: Vec::new(),
            total: 0,
            offset: 0,
            root_id: 0,
        };
    };
    let ids: Vec<u32> = {
        let rows = ix.tree_rows();
        let total = rows.len();
        let start = offset.min(total);
        let end = (start + limit).min(total);
        rows[start..end].to_vec()
    };
    let total = ix.tree_rows().len();
    TreePage {
        rows: ids.iter().map(|&id| ix.make_tree_row(id)).collect(),
        total,
        offset: offset.min(total),
        root_id: 0,
    }
}

#[tauri::command]
pub fn tree_toggle(state: Shared, id: u32, expanded: bool) {
    let mut guard = state.index.write();
    if let Some(ix) = guard.as_mut() {
        ix.set_expanded(id, expanded);
    }
}

#[tauri::command]
pub fn tree_set_sort(state: Shared, sort: TreeSort) {
    let mut guard = state.index.write();
    if let Some(ix) = guard.as_mut() {
        ix.tree_sort = sort;
        ix.invalidate_tree();
    }
}

#[tauri::command]
pub fn tree_expand_depth(state: Shared, depth: u16) {
    let mut guard = state.index.write();
    if let Some(ix) = guard.as_mut() {
        ix.expand_to_depth(depth);
    }
}

#[tauri::command]
pub fn tree_collapse_all(state: Shared) {
    let mut guard = state.index.write();
    if let Some(ix) = guard.as_mut() {
        ix.collapse_all();
    }
}

/// Expand ancestors so `dir_id` becomes visible; returns its row index.
#[tauri::command]
pub fn tree_reveal(state: Shared, dir_id: u32) -> Option<usize> {
    let mut guard = state.index.write();
    guard.as_mut().and_then(|ix| ix.reveal_dir(dir_id))
}

// -------------------------------------------------------------- file list

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn file_page(
    state: Shared,
    dir_id: u32,
    sort: SortSpec,
    query: String,
    offset: usize,
    limit: usize,
) -> Page<FileRow> {
    let guard = state.index.read();
    let Some(ix) = guard.as_ref() else {
        return empty_page(offset);
    };
    if dir_id as usize >= ix.dirs.len() {
        return empty_page(offset);
    }
    let now = state::now_secs();
    let q = state::parse_query(&query);
    let gen = state.generation.load(std::sync::atomic::Ordering::SeqCst);
    let key = state::cache_key(gen, "files", dir_id, None, QuickFilter::All, sort, &query, false);

    let mut cache = state.file_cache.lock();
    let sel = cache.get_or_build(key, ix, || {
        let candidates = ix.dirs[dir_id as usize].files.clone();
        files::select_files(ix, &candidates, &q, QuickFilter::All, sort, now, 0)
    });

    page_from(ix, &sel, offset, limit, now, drive_total(&state, ix))
}

// ------------------------------------------------------------- space hogs

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn hog_page(
    state: Shared,
    mode: HogMode,
    quick: QuickFilter,
    query: String,
    sort: Option<SortSpec>,
    offset: usize,
    limit: usize,
) -> Page<FileRow> {
    let guard = state.index.read();
    let Some(ix) = guard.as_ref() else {
        return empty_page(offset);
    };
    let now = state::now_secs();
    let q = state::parse_query(&query);
    let spec = sort.unwrap_or_else(|| files::hog_sort_spec(mode));
    let group = state.settings.read().group_bundles;
    let gen = state.generation.load(std::sync::atomic::Ordering::SeqCst);
    let key = state::cache_key(gen, "hogs", 0, Some(mode), quick, spec, &query, group);

    let mut cache = state.hog_cache.lock();
    let sel = cache.get_or_build(key, ix, || {
        files::select_files(ix, ix.items(group), &q, quick, spec, now, 0)
    });

    page_from(ix, &sel, offset, limit, now, drive_total(&state, ix))
}

/// Row index of `file_id` in the current file-list selection.
///
/// Lets a table scroll to the item clicked in the Treemap. The selection is
/// cached, so this scans an id list rather than re-sorting.
#[tauri::command]
pub fn file_row_index(
    state: Shared,
    dir_id: u32,
    sort: SortSpec,
    query: String,
    file_id: u32,
) -> Option<usize> {
    let guard = state.index.read();
    let ix = guard.as_ref()?;
    if dir_id as usize >= ix.dirs.len() {
        return None;
    }
    let now = state::now_secs();
    let q = state::parse_query(&query);
    let gen = state.generation.load(std::sync::atomic::Ordering::SeqCst);
    let key = state::cache_key(gen, "files", dir_id, None, QuickFilter::All, sort, &query, false);
    let mut cache = state.file_cache.lock();
    let sel = cache.get_or_build(key, ix, || {
        let candidates = ix.dirs[dir_id as usize].files.clone();
        files::select_files(ix, &candidates, &q, QuickFilter::All, sort, now, 0)
    });
    sel.ids.iter().position(|&id| id == file_id)
}

#[tauri::command]
pub fn hog_row_index(
    state: Shared,
    mode: HogMode,
    quick: QuickFilter,
    query: String,
    sort: Option<SortSpec>,
    file_id: u32,
) -> Option<usize> {
    let guard = state.index.read();
    let ix = guard.as_ref()?;
    let now = state::now_secs();
    let q = state::parse_query(&query);
    let spec = sort.unwrap_or_else(|| files::hog_sort_spec(mode));
    let group = state.settings.read().group_bundles;
    let gen = state.generation.load(std::sync::atomic::Ordering::SeqCst);
    let key = state::cache_key(gen, "hogs", 0, Some(mode), quick, spec, &query, group);
    let mut cache = state.hog_cache.lock();
    let sel = cache.get_or_build(key, ix, || {
        files::select_files(ix, ix.items(group), &q, quick, spec, now, 0)
    });
    sel.ids
        .iter()
        .position(|&id| id == file_id)
        .or_else(|| {
            // A bundle's stand-in row may be listed instead of the file.
            ix.files
                .get(file_id as usize)
                .map(|_| ())
                .and_then(|_| ix.synthetic_of_dir.get(&file_id).copied())
                .and_then(|syn| sel.ids.iter().position(|&id| id == syn))
        })
}

// ------------------------------------------------------------- file types

#[tauri::command]
pub fn extension_table(state: Shared, sort: ExtSort) -> Vec<ExtRow> {
    let guard = state.index.read();
    let Some(ix) = guard.as_ref() else {
        return Vec::new();
    };
    let total = drive_total(&state, ix);
    ix.extension_table(sort, total)
}

// ---------------------------------------------------------------- treemap

#[tauri::command]
pub fn treemap(
    state: Shared,
    root_dir: u32,
    width: f64,
    height: f64,
    max_rects: usize,
) -> TreemapLayout {
    let guard = state.index.read();
    let Some(ix) = guard.as_ref() else {
        return TreemapLayout {
            rects: Vec::new(),
            root_id: 0,
            root_name: String::new(),
            root_size: 0,
            truncated: false,
        };
    };
    let logical = state.settings.read().size_basis == crate::state::SizeBasis::Logical;
    crate::treemap::layout(
        ix,
        root_dir,
        width,
        height,
        max_rects.clamp(64, 40_000),
        logical,
    )
}

// ------------------------------------------------------------ item detail

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemDetail {
    pub id: u32,
    pub is_dir: bool,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub alloc: u64,
    pub kind: String,
    pub category: Category,
    pub last_used: Option<i64>,
    pub last_used_source: LastUsedSource,
    pub accessed: Option<i64>,
    pub modified: Option<i64>,
    pub created: Option<i64>,
    pub cleanup_score: u8,
    pub cloud: bool,
    pub protected: bool,
    pub immutable: bool,
    pub package: bool,
    pub files: u64,
    pub folders: u64,
}

#[tauri::command]
pub fn item_detail(state: Shared, id: u32, is_dir: bool) -> Option<ItemDetail> {
    let guard = state.index.read();
    let ix = guard.as_ref()?;
    let now = state::now_secs();

    if is_dir {
        let d = ix.dirs.get(id as usize)?;
        let path = ix.dir_path(id);
        Some(ItemDetail {
            id,
            is_dir: true,
            name: ix.dir_name(id).to_string(),
            size: d.agg_size,
            alloc: d.agg_alloc,
            kind: "Folder".into(),
            category: Category::Other,
            last_used: files::opt_time(d.agg_last_used),
            last_used_source: LastUsedSource::FileSystemAccessTime,
            accessed: files::opt_time(d.atime),
            modified: files::opt_time(d.agg_mtime),
            created: files::opt_time(d.btime),
            cleanup_score: 0,
            cloud: d.has(flags::IS_CLOUD),
            protected: is_protected_path(&path),
            immutable: is_immutable_path(&path),
            package: d.has(flags::IS_PACKAGE),
            files: d.agg_files,
            folders: d.agg_dirs,
            path,
        })
    } else {
        let f = ix.files.get(id as usize)?;
        let path = ix.item_path(id);
        let ext = ix.ext_name(f.ext).to_string();
        Some(ItemDetail {
            id,
            is_dir: false,
            name: ix.file_name(id).to_string(),
            size: f.size,
            alloc: f.alloc,
            kind: category_label_for_ext(&ext).to_string(),
            category: ix.file_category(id),
            last_used: files::opt_time(f.effective_last_used()),
            last_used_source: f.last_used_source(),
            accessed: files::opt_time(f.atime),
            modified: files::opt_time(f.mtime),
            created: files::opt_time(f.btime),
            cleanup_score: files::cleanup_score(ix, id, now),
            cloud: f.has(flags::IS_CLOUD),
            protected: is_protected_path(&path),
            immutable: is_immutable_path(&path),
            package: f.has(flags::IS_PACKAGE),
            files: 0,
            folders: 0,
            path,
        })
    }
}

/// Fresh timestamps for one path, read on demand.
#[tauri::command]
pub fn usage_metadata(path: String) -> UsageMetadata {
    UsageMetadata::resolve(&path)
}

#[tauri::command]
pub fn item_paths(state: Shared, ids: Vec<u32>, are_dirs: bool) -> Vec<String> {
    let guard = state.index.read();
    let Some(ix) = guard.as_ref() else {
        return Vec::new();
    };
    ids.into_iter()
        .filter_map(|id| {
            let n = id as usize;
            if are_dirs {
                (n < ix.dirs.len()).then(|| ix.dir_path(id))
            } else {
                (n < ix.files.len()).then(|| ix.item_path(id))
            }
        })
        .collect()
}

/// The directory holding this file. Syncs the Treemap with the tables.
#[tauri::command]
pub fn locate_file(state: Shared, file_id: u32) -> Option<u32> {
    let guard = state.index.read();
    let ix = guard.as_ref()?;
    if let Some(&dir) = ix.dir_of_synthetic.get(&file_id) {
        return Some(dir);
    }
    ix.files.get(file_id as usize).map(|f| f.parent)
}

// ------------------------------------------------------------------ shell

#[tauri::command]
pub fn open_item(path: String) -> Result<(), String> {
    crate::finder::open_path(&path)
}

#[tauri::command]
pub fn reveal_item(path: String) -> Result<(), String> {
    crate::finder::reveal_in_finder(&path)
}

#[tauri::command]
pub fn quick_look(path: String) -> Result<(), String> {
    crate::finder::quick_look(&path)
}

#[tauri::command]
pub fn open_full_disk_access() -> Result<(), String> {
    crate::finder::open_full_disk_access_settings()
}

// ------------------------------------------------------------------ trash

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashPreviewItem {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub last_used: Option<i64>,
    pub protected: bool,
    pub immutable: bool,
    pub is_dir: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashPreview {
    pub items: Vec<TrashPreviewItem>,
    pub count: usize,
    pub total_size: u64,
    pub blocked: usize,
}

#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ItemRef {
    pub id: u32,
    pub is_dir: bool,
}

#[tauri::command]
pub fn trash_preview(state: Shared, items: Vec<ItemRef>) -> TrashPreview {
    let guard = state.index.read();
    let Some(ix) = guard.as_ref() else {
        return TrashPreview {
            items: Vec::new(),
            count: 0,
            total_size: 0,
            blocked: 0,
        };
    };
    let mut out = Vec::with_capacity(items.len());
    let mut total = 0u64;
    let mut blocked = 0usize;

    for r in items {
        let (name, path, size, last_used, is_dir) = if r.is_dir {
            let Some(d) = ix.dirs.get(r.id as usize) else {
                continue;
            };
            (
                ix.dir_name(r.id).to_string(),
                ix.dir_path(r.id),
                d.agg_alloc.max(d.agg_size),
                files::opt_time(d.agg_last_used),
                true,
            )
        } else {
            let Some(f) = ix.files.get(r.id as usize) else {
                continue;
            };
            (
                ix.file_name(r.id).to_string(),
                ix.item_path(r.id),
                f.alloc.max(f.size),
                files::opt_time(f.effective_last_used()),
                f.has(flags::IS_SYNTHETIC),
            )
        };
        let immutable = is_immutable_path(&path);
        if immutable {
            blocked += 1;
        } else {
            total += size;
        }
        out.push(TrashPreviewItem {
            protected: is_protected_path(&path),
            immutable,
            name,
            path,
            size,
            last_used,
            is_dir,
        });
    }

    TrashPreview {
        count: out.len(),
        total_size: total,
        blocked,
        items: out,
    }
}

#[tauri::command]
pub fn trash_items(state: Shared, paths: Vec<String>) -> TrashReport {
    let mut report = TrashReport::default();
    for path in paths {
        let bytes = crate::trash::size_on_disk(&path);
        match crate::trash::move_to_trash(&path) {
            Ok(()) => {
                report.moved += 1;
                report.bytes_freed += bytes;
                report.results.push(TrashOutcome {
                    path,
                    ok: true,
                    error: None,
                    bytes,
                });
            }
            Err(e) => {
                report.failed += 1;
                report.results.push(TrashOutcome {
                    path,
                    ok: false,
                    error: Some(e),
                    bytes: 0,
                });
            }
        }
    }
    if report.moved > 0 {
        state.invalidate_views();
    }
    report
}

// --------------------------------------------------------------- settings

#[tauri::command]
pub fn get_settings(state: Shared) -> Settings {
    state.settings.read().clone()
}

#[tauri::command]
pub fn set_settings(state: Shared, settings: Settings) -> Settings {
    *state.settings.write() = settings.clone();
    if let Some(dir) = state.config_dir.read().as_ref() {
        crate::state::save_settings(dir, &settings);
    }
    state.invalidate_views();
    settings
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeniedInfo {
    pub count: usize,
    pub samples: Vec<String>,
    pub full_disk_access: bool,
}

/// Directories the scan could not read, which usually means Full Disk Access
/// is missing.
#[tauri::command]
pub fn denied_report(state: Shared) -> DeniedInfo {
    let guard = state.index.read();
    let (count, samples) = match guard.as_ref() {
        Some(ix) => (
            ix.denied_dirs.len(),
            ix.denied_dirs
                .iter()
                .take(12)
                .map(|&d| ix.dir_path(d))
                .collect(),
        ),
        None => (0, Vec::new()),
    };
    DeniedInfo {
        count,
        samples,
        full_disk_access: has_full_disk_access(),
    }
}

/// Probe Full Disk Access by reading a directory only it can open.
pub fn has_full_disk_access() -> bool {
    std::fs::read_dir("/Library/Application Support/com.apple.TCC").is_ok()
}

// ---------------------------------------------------------------- helpers

fn empty_page<T>(offset: usize) -> Page<T> {
    Page {
        rows: Vec::new(),
        total: 0,
        offset,
        max_size: 0,
        total_size: 0,
    }
}

fn drive_total(state: &AppState, ix: &crate::index::ScanIndex) -> u64 {
    let vols = state.volumes.read();
    vols.iter()
        .find(|v| v.path == ix.root_path)
        .map(|v| v.total)
        .filter(|t| *t > 0)
        .unwrap_or_else(|| ix.volume_total.max(ix.total_alloc()).max(1))
}

fn page_from(
    ix: &crate::index::ScanIndex,
    sel: &crate::state::CachedSelection<'_>,
    offset: usize,
    limit: usize,
    now: i64,
    drive: u64,
) -> Page<FileRow> {
    let total = sel.ids.len();
    let start = offset.min(total);
    let end = (start + limit).min(total);

    Page {
        rows: sel.ids[start..end]
            .iter()
            .enumerate()
            .map(|(i, &id)| files::make_row(ix, id, (start + i + 1) as u32, now, drive))
            .collect(),
        total,
        offset: start,
        max_size: sel.max_size,
        total_size: sel.total_size,
    }
}
