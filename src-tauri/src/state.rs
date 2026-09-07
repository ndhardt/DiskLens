//! Application state and the background scan driver.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::index::files::{HogMode, QuickFilter, SortSpec};
use crate::index::ScanIndex;
use crate::model::*;
use crate::query::Query;
use crate::scanner::{self, ScanOptions, WalkStats};
use crate::volumes::MountTable;

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SizeBasis {
    /// Bytes occupied on disk. The default.
    #[default]
    Allocated,
    /// The file's logical length.
    Logical,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// "auto", "en" or "ja". "auto" follows the system language.
    pub language: String,
    pub size_basis: SizeBasis,
    pub group_bundles: bool,
    pub follow_symlinks: bool,
    pub cross_volumes: bool,
    pub fast_scanner: bool,
    pub spotlight_enrichment: bool,
    /// How many of the largest files get a Spotlight lookup.
    pub spotlight_budget: usize,
    pub show_treemap: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            language: "auto".into(),
            size_basis: SizeBasis::Allocated,
            group_bundles: true,
            follow_symlinks: false,
            cross_volumes: false,
            fast_scanner: true,
            spotlight_enrichment: true,
            spotlight_budget: 30_000,
            show_treemap: true,
        }
    }
}

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub running: bool,
    pub files: u64,
    pub dirs: u64,
    pub bytes: u64,
    pub alloc: u64,
    pub skipped: u64,
    pub current: String,
    pub elapsed_ms: u64,
    pub done: bool,
    pub cancelled: bool,
    pub error: Option<String>,
    pub scanner: String,
    pub root: String,
    /// Set when the post-scan Spotlight pass finishes.
    pub spotlight_done: bool,
    pub spotlight_hits: u64,
}

/// Memoised id list for the current table view, so scrolling pages through a
/// result set instead of recomputing it.
///
/// Totals are computed once with the list, not per page: otherwise every
/// scroll would walk a multi-million-entry selection again.
#[derive(Default)]
pub struct ViewCache {
    key: Option<String>,
    ids: Vec<u32>,
    max_size: u64,
    total_size: u64,
}

pub struct CachedSelection<'a> {
    pub ids: &'a [u32],
    pub max_size: u64,
    pub total_size: u64,
}

impl ViewCache {
    pub fn get_or_build<F>(&mut self, key: String, ix: &ScanIndex, build: F) -> CachedSelection<'_>
    where
        F: FnOnce() -> Vec<u32>,
    {
        if self.key.as_deref() != Some(key.as_str()) {
            self.ids = build();
            let mut max = 0u64;
            let mut total = 0u64;
            for &id in &self.ids {
                let f = &ix.files[id as usize];
                let s = f.alloc.max(f.size);
                total = total.saturating_add(s);
                if s > max {
                    max = s;
                }
            }
            self.max_size = max;
            self.total_size = total;
            self.key = Some(key);
        }
        CachedSelection {
            ids: &self.ids,
            max_size: self.max_size,
            total_size: self.total_size,
        }
    }

    pub fn invalidate(&mut self) {
        self.key = None;
        self.ids.clear();
        self.max_size = 0;
        self.total_size = 0;
    }
}

pub struct AppState {
    pub config_dir: RwLock<Option<PathBuf>>,
    pub index: RwLock<Option<ScanIndex>>,
    pub progress: RwLock<ScanProgress>,
    pub settings: RwLock<Settings>,
    pub cancel: Mutex<Option<Arc<AtomicBool>>>,
    pub generation: AtomicU64,
    pub hog_cache: Mutex<ViewCache>,
    pub file_cache: Mutex<ViewCache>,
    pub volumes: RwLock<Vec<crate::volumes::VolumeInfo>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            config_dir: RwLock::new(None),
            index: RwLock::new(None),
            progress: RwLock::new(ScanProgress::default()),
            settings: RwLock::new(Settings::default()),
            cancel: Mutex::new(None),
            generation: AtomicU64::new(0),
            hog_cache: Mutex::new(ViewCache::default()),
            file_cache: Mutex::new(ViewCache::default()),
            volumes: RwLock::new(Vec::new()),
        }
    }
}

impl AppState {
    pub fn invalidate_views(&self) {
        self.hog_cache.lock().invalidate();
        self.file_cache.lock().invalidate();
    }

    pub fn bump(&self) -> u64 {
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }
}

const SETTINGS_FILE: &str = "settings.json";

/// Settings live in the app config directory so a choice like the interface
/// language survives a restart.
pub fn load_settings(dir: &std::path::Path) -> Settings {
    std::fs::read_to_string(dir.join(SETTINGS_FILE))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_settings(dir: &std::path::Path, s: &Settings) {
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    if let Ok(json) = serde_json::to_string_pretty(s) {
        let _ = std::fs::write(dir.join(SETTINGS_FILE), json);
    }
}

pub fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Cache key for a Space Hogs / file list selection.
#[allow(clippy::too_many_arguments)]
pub fn cache_key(
    generation: u64,
    scope: &str,
    dir: u32,
    mode: Option<HogMode>,
    quick: QuickFilter,
    spec: SortSpec,
    query: &str,
    group: bool,
) -> String {
    format!(
        "{generation}|{scope}|{dir}|{mode:?}|{quick:?}|{:?}{}|{query}|{group}",
        spec.key, spec.desc
    )
}

/// Start a scan on a worker thread. Returns immediately.
pub fn spawn_scan(app: AppHandle, state: Arc<AppState>, root: PathBuf, volume_name: String) {
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut slot = state.cancel.lock();
        if let Some(prev) = slot.as_ref() {
            prev.store(true, Ordering::SeqCst);
        }
        *slot = Some(cancel.clone());
    }

    let settings = state.settings.read().clone();
    let opts = ScanOptions {
        root: root.clone(),
        volume_name: volume_name.clone(),
        follow_symlinks: settings.follow_symlinks,
        cross_volumes: settings.cross_volumes,
        fast: settings.fast_scanner,
    };

    {
        let mut p = state.progress.write();
        *p = ScanProgress {
            running: true,
            root: root.to_string_lossy().to_string(),
            ..Default::default()
        };
    }
    state.invalidate_views();

    std::thread::Builder::new()
        .name("disklens-scan".into())
        .spawn(move || {
            let scanner = scanner::make_scanner(&opts);
            let scanner_name = scanner.name().to_string();
            let mounts = MountTable::load();
            let mut index = ScanIndex::new(
                root.to_string_lossy().to_string(),
                volume_name.clone(),
            );
            if let Some((total, free)) = crate::volumes::statfs_for(&root.to_string_lossy()) {
                index.volume_total = total;
                index.volume_free = free;
            }

            let mut last_emit = std::time::Instant::now();
            let emit_app = app.clone();
            let emit_state = state.clone();
            let sname = scanner_name.clone();
            let root_str = root.to_string_lossy().to_string();

            let stats = {
                let mut on_progress = |_ix: &ScanIndex, s: &WalkStats| {
                    if last_emit.elapsed().as_millis() < 90 {
                        return;
                    }
                    last_emit = std::time::Instant::now();
                    let p = ScanProgress {
                        running: true,
                        files: s.files,
                        dirs: s.dirs,
                        bytes: s.bytes,
                        alloc: s.alloc,
                        skipped: s.skipped,
                        current: s.current.clone(),
                        elapsed_ms: s.elapsed_ms,
                        done: false,
                        cancelled: false,
                        error: None,
                        scanner: sname.clone(),
                        root: root_str.clone(),
                        spotlight_done: false,
                        spotlight_hits: 0,
                    };
                    *emit_state.progress.write() = p.clone();
                    let _ = emit_app.emit("scan:progress", p);
                };
                scanner::walk(
                    &opts,
                    scanner.as_ref(),
                    &mut index,
                    &cancel,
                    &mounts,
                    &mut on_progress,
                )
            };

            let cancelled = cancel.load(Ordering::SeqCst);
            let now = now_secs();
            index.duration_ms = stats.elapsed_ms;
            index.scanned_at = now;
            index.finalize(now);

            let final_progress = ScanProgress {
                running: false,
                files: index.real_files,
                dirs: index.dirs.len() as u64 - 1,
                bytes: index.total_size(),
                alloc: index.total_alloc(),
                skipped: index.skipped,
                current: String::new(),
                elapsed_ms: stats.elapsed_ms,
                done: true,
                cancelled,
                error: None,
                scanner: scanner_name,
                root: index.root_path.clone(),
                spotlight_done: false,
                spotlight_hits: 0,
            };

            {
                *state.index.write() = Some(index);
            }
            state.bump();
            state.invalidate_views();
            *state.progress.write() = final_progress.clone();
            let _ = app.emit("scan:done", final_progress);

            if state.settings.read().spotlight_enrichment && !cancelled {
                enrich_with_spotlight(app, state, cancel);
            }
        })
        .expect("spawn scan thread");
}

/// Ask Spotlight for `kMDItemLastUsedDate` on the largest files.
///
/// Only the top slice: those are the rows anyone acts on, and a whole-drive
/// lookup costs far more than it returns.
#[cfg(target_os = "macos")]
fn enrich_with_spotlight(app: AppHandle, state: Arc<AppState>, cancel: Arc<AtomicBool>) {
    use rayon::prelude::*;

    let budget = state.settings.read().spotlight_budget;
    let targets: Vec<(u32, String)> = {
        let guard = state.index.read();
        let Some(ix) = guard.as_ref() else { return };
        ix.by_size
            .iter()
            .take(budget)
            .filter(|&&id| !ix.files[id as usize].has(flags::IS_SYNTHETIC))
            .map(|&id| (id, ix.file_path(id)))
            .collect()
    };
    if targets.is_empty() {
        return;
    }

    let found: Vec<(u32, i64)> = targets
        .par_iter()
        .filter_map(|(id, path)| {
            if cancel.load(Ordering::Relaxed) {
                return None;
            }
            crate::metadata::spotlight::last_used(path).map(|t| (*id, t))
        })
        .collect();

    let hits = found.len() as u64;
    {
        let mut guard = state.index.write();
        let Some(ix) = guard.as_mut() else { return };
        for (id, t) in found {
            let f = &mut ix.files[id as usize];
            f.last_used = t;
            f.flags |= flags::USED_FROM_SPOTLIGHT;
        }
        // Re-roll subtree totals now that the leaves have better data.
        ix.aggregate();
        // Stand-ins inherit the newest usage found inside the bundle.
        let pairs: Vec<(u32, u32)> = ix.dir_of_synthetic.iter().map(|(a, b)| (*a, *b)).collect();
        for (fid, dir) in pairs {
            let d = &ix.dirs[dir as usize];
            let (used, mtime) = (d.agg_last_used, d.agg_mtime);
            let f = &mut ix.files[fid as usize];
            f.last_used = used;
            f.mtime = mtime;
            if used != NO_TIME {
                f.flags |= flags::USED_FROM_SPOTLIGHT;
            }
        }
        let now = now_secs();
        ix.build_cleanup_norm(now);
        ix.invalidate_tree();
    }
    state.bump();
    state.invalidate_views();

    let mut p = state.progress.write();
    p.spotlight_done = true;
    p.spotlight_hits = hits;
    let payload = p.clone();
    drop(p);
    let _ = app.emit("scan:spotlight", payload);
}

#[cfg(not(target_os = "macos"))]
fn enrich_with_spotlight(_app: AppHandle, _state: Arc<AppState>, _cancel: Arc<AtomicBool>) {}

/// What the header strip needs about the scanned volume.
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct DriveSummary {
    pub name: String,
    pub path: String,
    pub fs_type: String,
    pub capacity: u64,
    pub used: u64,
    pub free: u64,
    pub used_pct: f32,
    pub scanned_bytes: u64,
    pub scanned_alloc: u64,
    pub files: u64,
    pub folders: u64,
    pub skipped: u64,
    pub duration_ms: u64,
    pub has_index: bool,
    pub category_bytes: HashMap<String, u64>,
}

pub fn drive_summary(state: &AppState) -> DriveSummary {
    let guard = state.index.read();
    let Some(ix) = guard.as_ref() else {
        return DriveSummary::default();
    };
    let vols = state.volumes.read();
    let vol = vols.iter().find(|v| v.path == ix.root_path);

    let capacity = vol.map(|v| v.total).unwrap_or(ix.volume_total);
    let free = vol.map(|v| v.free).unwrap_or(ix.volume_free);
    let used = capacity.saturating_sub(free);

    let mut category_bytes: HashMap<String, u64> = HashMap::new();
    for f in ix.files.iter() {
        if f.has(flags::IS_SYNTHETIC) || f.has(flags::IS_HARDLINK_DUP) {
            continue;
        }
        let cat = if f.has(flags::IS_SYSTEM) {
            Category::System
        } else {
            ix.ext_cats[f.ext as usize]
        };
        *category_bytes.entry(cat.label().to_string()).or_insert(0) += f.alloc.max(f.size);
    }

    DriveSummary {
        name: vol.map(|v| v.name.clone()).unwrap_or_else(|| ix.volume_name.clone()),
        path: ix.root_path.clone(),
        fs_type: vol.map(|v| v.fs_type.clone()).unwrap_or_else(|| "APFS".into()),
        capacity,
        used,
        free,
        used_pct: if capacity > 0 {
            (used as f64 / capacity as f64 * 100.0) as f32
        } else {
            0.0
        },
        scanned_bytes: ix.total_size(),
        scanned_alloc: ix.total_alloc(),
        files: ix.real_files,
        folders: ix.dirs.len() as u64 - 1,
        skipped: ix.skipped,
        duration_ms: ix.duration_ms,
        has_index: true,
        category_bytes,
    }
}

pub fn parse_query(s: &str) -> Query {
    Query::parse(s.trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_index() -> ScanIndex {
        use crate::index::NO_PARENT;
        let mut ix = ScanIndex::new("/r".into(), "T".into());
        let n = ix.names.push("/r");
        ix.dirs.push(DirRec::new(n, NO_PARENT, 0, flags::IS_DIR));
        for size in [10u64, 40, 25] {
            let n = ix.names.push("f.bin");
            ix.files.push(FileRec {
                name: n,
                parent: 0,
                ext: 0,
                size,
                alloc: size,
                mtime: 1,
                atime: 1,
                btime: 1,
                last_used: 1,
                flags: 0,
            });
            let id = ix.files.len() as u32 - 1;
            ix.dirs[0].files.push(id);
        }
        ix.finalize(1000);
        ix
    }

    #[test]
    fn view_cache_rebuilds_only_when_the_key_changes() {
        let ix = sample_index();
        let mut c = ViewCache::default();
        let mut builds = 0;
        c.get_or_build("a".into(), &ix, || {
            builds += 1;
            vec![0, 1, 2]
        });
        c.get_or_build("a".into(), &ix, || {
            builds += 1;
            vec![0]
        });
        assert_eq!(builds, 1);

        let sel = c.get_or_build("a".into(), &ix, Vec::new);
        assert_eq!(sel.ids, &[0, 1, 2]);
        assert_eq!(sel.max_size, 40);
        assert_eq!(sel.total_size, 75);

        c.get_or_build("b".into(), &ix, || {
            builds += 1;
            vec![1]
        });
        assert_eq!(builds, 2);
    }

    #[test]
    fn settings_round_trip_through_disk() {
        let dir = std::env::temp_dir().join(format!("disklens-settings-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        // Nothing written yet: fall back to the defaults.
        assert_eq!(load_settings(&dir).language, "auto");

        let s = Settings {
            language: "ja".into(),
            group_bundles: false,
            ..Default::default()
        };
        save_settings(&dir, &s);

        let back = load_settings(&dir);
        assert_eq!(back.language, "ja");
        assert!(!back.group_bundles);
        assert_eq!(back.size_basis, SizeBasis::Allocated);

        // A file written by an older build, missing most keys, must still load.
        std::fs::write(dir.join("settings.json"), r#"{"language":"en"}"#).unwrap();
        let partial = load_settings(&dir);
        assert_eq!(partial.language, "en");
        assert!(partial.group_bundles, "missing keys fall back to the default");

        // Corrupt input must not panic or wipe the app's ability to start.
        std::fs::write(dir.join("settings.json"), "{not json").unwrap();
        assert_eq!(load_settings(&dir).language, "auto");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cache_keys_separate_distinct_views() {
        let a = cache_key(1, "hogs", 0, Some(HogMode::LargestFirst), QuickFilter::All, SortSpec::default(), "", true);
        let b = cache_key(1, "hogs", 0, Some(HogMode::LongestUnused), QuickFilter::All, SortSpec::default(), "", true);
        let c = cache_key(2, "hogs", 0, Some(HogMode::LargestFirst), QuickFilter::All, SortSpec::default(), "", true);
        assert_ne!(a, b);
        assert_ne!(a, c);
    }
}
