//! File-level views: sorting, ranking and the row payloads sent to the UI.

use serde::{Deserialize, Serialize};

use super::ScanIndex;
use crate::model::*;
use crate::query::Query;

pub const DAY: i64 = 86_400;

/// Raw (un-normalised) review priority.
///
/// `size` and `age` are both compressed logarithmically so that a merely large
/// file cannot outrank a large *and* forgotten one.
pub fn raw_cleanup_score(f: &FileRec, now: i64) -> f64 {
    let bytes = f.alloc.max(f.size) as f64;
    let mb = bytes / (1024.0 * 1024.0);
    let size_score = (mb + 1.0).log2();

    let last = f.effective_last_used();
    let unused_days = if last == NO_TIME {
        // Unknown usage: fall back to modification age, and damp it, so a file
        // we simply know nothing about does not float to the top.
        if f.mtime == NO_TIME {
            30.0
        } else {
            (((now - f.mtime).max(0) as f64) / DAY as f64) * 0.6
        }
    } else {
        ((now - last).max(0) as f64) / DAY as f64
    };
    let unused_score = (unused_days + 2.0).log2();

    size_score * unused_score
}

pub fn cleanup_score(ix: &ScanIndex, id: u32, now: i64) -> u8 {
    let f = &ix.files[id as usize];
    let raw = raw_cleanup_score(f, now);
    let norm = if ix.cleanup_norm > 0.0 { ix.cleanup_norm } else { 1.0 };
    let v = (raw / norm * 100.0).clamp(0.0, 100.0);
    v.round() as u8
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SortKey {
    Name,
    #[default]
    Size,
    Allocated,
    LastUsed,
    Modified,
    Created,
    Extension,
    Path,
    CleanupScore,
    UnusedFor,
    Kind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortSpec {
    pub key: SortKey,
    pub desc: bool,
}

impl Default for SortSpec {
    fn default() -> Self {
        SortSpec {
            key: SortKey::Size,
            desc: true,
        }
    }
}

/// The Space Hogs preset orderings.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HogMode {
    #[default]
    LargestFirst,
    LongestUnused,
    LargestAndUnused,
    RecentlyUsed,
    RecentlyModified,
}

/// The one-click size / age narrowing above the Space Hogs table.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QuickFilter {
    #[default]
    All,
    Size1G,
    Size5G,
    Size10G,
    Unused3m,
    Unused6m,
    Unused1y,
    Unused2y,
}

impl QuickFilter {
    pub fn matches(self, f: &FileRec, now: i64) -> bool {
        const GB: u64 = 1024 * 1024 * 1024;
        let size = f.alloc.max(f.size);
        let unused_days = |f: &FileRec| -> Option<f64> {
            let last = f.effective_last_used();
            if last == NO_TIME {
                None
            } else {
                Some(((now - last).max(0) as f64) / DAY as f64)
            }
        };
        match self {
            QuickFilter::All => true,
            QuickFilter::Size1G => size >= GB,
            QuickFilter::Size5G => size >= 5 * GB,
            QuickFilter::Size10G => size >= 10 * GB,
            QuickFilter::Unused3m => unused_days(f).map(|d| d >= 90.0).unwrap_or(false),
            QuickFilter::Unused6m => unused_days(f).map(|d| d >= 182.0).unwrap_or(false),
            QuickFilter::Unused1y => unused_days(f).map(|d| d >= 365.0).unwrap_or(false),
            QuickFilter::Unused2y => unused_days(f).map(|d| d >= 730.0).unwrap_or(false),
        }
    }
}

/// One row in the file list / Space Hogs table.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRow {
    pub id: u32,
    pub rank: u32,
    pub name: String,
    pub size: u64,
    pub alloc: u64,
    pub last_used: Option<i64>,
    pub last_used_source: LastUsedSource,
    pub accessed: Option<i64>,
    pub modified: Option<i64>,
    pub created: Option<i64>,
    pub ext: String,
    pub dir_path: String,
    pub kind: &'static str,
    pub category: Category,
    pub cleanup_score: u8,
    pub disk_pct: f32,
    pub cloud: bool,
    pub protected: bool,
    pub immutable: bool,
    pub is_dir: bool,
    pub is_package: bool,
}

pub fn make_row(ix: &ScanIndex, id: u32, rank: u32, now: i64, disk_total: u64) -> FileRow {
    let f = ix.files[id as usize];
    let dir_path = ix.file_dir_path(id);
    let name = ix.file_name(id).to_string();
    let full = if dir_path.ends_with('/') {
        format!("{dir_path}{name}")
    } else {
        format!("{dir_path}/{name}")
    };
    let ext = ix.ext_name(f.ext).to_string();
    let size = f.alloc.max(f.size);
    FileRow {
        id,
        rank,
        name,
        size: f.size,
        alloc: f.alloc,
        last_used: opt_time(f.effective_last_used()),
        last_used_source: f.last_used_source(),
        accessed: opt_time(f.atime),
        modified: opt_time(f.mtime),
        created: opt_time(f.btime),
        kind: category_label_for_ext(&ext),
        category: ix.file_category(id),
        ext,
        dir_path,
        cleanup_score: cleanup_score(ix, id, now),
        disk_pct: if disk_total > 0 {
            (size as f64 / disk_total as f64 * 100.0) as f32
        } else {
            0.0
        },
        cloud: f.has(flags::IS_CLOUD),
        protected: is_protected_path(&full),
        immutable: is_immutable_path(&full),
        is_dir: false,
        is_package: f.has(flags::IS_PACKAGE),
    }
}

#[inline]
pub fn opt_time(t: i64) -> Option<i64> {
    if t == NO_TIME || t <= 0 {
        None
    } else {
        Some(t)
    }
}

/// Comparator used by every table. Returns ordering for `a` before `b`.
pub fn compare(ix: &ScanIndex, a: u32, b: u32, spec: SortSpec, now: i64) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let fa = &ix.files[a as usize];
    let fb = &ix.files[b as usize];

    // Missing timestamps always sink to the bottom, whichever way we sort.
    let time_cmp = |ta: i64, tb: i64, desc: bool| -> Ordering {
        match (ta == NO_TIME, tb == NO_TIME) {
            (true, true) => Ordering::Equal,
            (true, false) => Ordering::Greater,
            (false, true) => Ordering::Less,
            (false, false) => {
                if desc {
                    tb.cmp(&ta)
                } else {
                    ta.cmp(&tb)
                }
            }
        }
    };

    let ord = match spec.key {
        SortKey::Name => {
            let o = ix.file_name(a).to_lowercase().cmp(&ix.file_name(b).to_lowercase());
            if spec.desc {
                o.reverse()
            } else {
                o
            }
        }
        SortKey::Size => {
            let o = fa.size.cmp(&fb.size);
            if spec.desc {
                o.reverse()
            } else {
                o
            }
        }
        SortKey::Allocated => {
            let o = fa.alloc.cmp(&fb.alloc);
            if spec.desc {
                o.reverse()
            } else {
                o
            }
        }
        // "Last used" descending means most recent first.
        SortKey::LastUsed => time_cmp(fa.effective_last_used(), fb.effective_last_used(), spec.desc),
        // "Unused for" descending means longest idle first — the inverse.
        SortKey::UnusedFor => time_cmp(
            fa.effective_last_used(),
            fb.effective_last_used(),
            !spec.desc,
        ),
        SortKey::Modified => time_cmp(fa.mtime, fb.mtime, spec.desc),
        SortKey::Created => time_cmp(fa.btime, fb.btime, spec.desc),
        SortKey::Extension => {
            let o = ix.ext_name(fa.ext).cmp(ix.ext_name(fb.ext));
            if spec.desc {
                o.reverse()
            } else {
                o
            }
        }
        SortKey::Kind => {
            let o = ix.file_category(a).label().cmp(ix.file_category(b).label());
            if spec.desc {
                o.reverse()
            } else {
                o
            }
        }
        SortKey::Path => {
            let o = ix.file_dir_path(a).cmp(&ix.file_dir_path(b));
            if spec.desc {
                o.reverse()
            } else {
                o
            }
        }
        SortKey::CleanupScore => {
            let sa = raw_cleanup_score(fa, now);
            let sb = raw_cleanup_score(fb, now);
            let o = sa.partial_cmp(&sb).unwrap_or(Ordering::Equal);
            if spec.desc {
                o.reverse()
            } else {
                o
            }
        }
    };
    // Stable, deterministic paging even when the key ties.
    ord.then_with(|| a.cmp(&b))
}

pub fn hog_sort_spec(mode: HogMode) -> SortSpec {
    match mode {
        HogMode::LargestFirst => SortSpec {
            key: SortKey::Size,
            desc: true,
        },
        HogMode::LongestUnused => SortSpec {
            key: SortKey::UnusedFor,
            desc: true,
        },
        HogMode::LargestAndUnused => SortSpec {
            key: SortKey::CleanupScore,
            desc: true,
        },
        HogMode::RecentlyUsed => SortSpec {
            key: SortKey::LastUsed,
            desc: true,
        },
        HogMode::RecentlyModified => SortSpec {
            key: SortKey::Modified,
            desc: true,
        },
    }
}

/// Collect the ids matching a query + quick filter, ordered by `spec`.
///
/// The result is a *plain id list*: the caller slices it for the viewport, so
/// nothing but the visible rows is ever serialised.
pub fn select_files(
    ix: &ScanIndex,
    candidates: &[u32],
    query: &Query,
    quick: QuickFilter,
    spec: SortSpec,
    now: i64,
    limit: usize,
) -> Vec<u32> {
    use rayon::prelude::*;

    let filtered: Vec<u32> = if query.is_empty() && quick == QuickFilter::All {
        candidates.to_vec()
    } else if candidates.len() > 40_000 {
        candidates
            .par_iter()
            .copied()
            .filter(|&id| quick.matches(&ix.files[id as usize], now) && query.matches(ix, id, now))
            .collect()
    } else {
        candidates
            .iter()
            .copied()
            .filter(|&id| quick.matches(&ix.files[id as usize], now) && query.matches(ix, id, now))
            .collect()
    };

    let mut out = filtered;
    // `by_size` is already the descending-size order; skip re-sorting for it.
    let already_sorted = spec.key == SortKey::Size
        && spec.desc
        && std::ptr::eq(candidates.as_ptr(), ix.by_size.as_ptr());

    if !already_sorted {
        if out.len() > 100_000 {
            out.par_sort_unstable_by(|a, b| compare(ix, *a, *b, spec, now));
        } else {
            out.sort_unstable_by(|a, b| compare(ix, *a, *b, spec, now));
        }
    }
    if limit > 0 && out.len() > limit {
        out.truncate(limit);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(size: u64, last_used: i64, mtime: i64) -> FileRec {
        FileRec {
            name: NameRef::default(),
            parent: 0,
            ext: 0,
            size,
            alloc: size,
            mtime,
            atime: NO_TIME,
            btime: NO_TIME,
            last_used,
            flags: 0,
        }
    }

    const NOW: i64 = 1_760_000_000;

    #[test]
    fn big_and_forgotten_beats_big_and_fresh() {
        let gb = 1024 * 1024 * 1024;
        let fresh = f(40 * gb, NOW - DAY, NOW);
        let stale = f(20 * gb, NOW - 400 * DAY, NOW);
        assert!(raw_cleanup_score(&stale, NOW) > raw_cleanup_score(&fresh, NOW));
    }

    #[test]
    fn tiny_and_ancient_does_not_beat_huge_and_stale() {
        let gb = 1024 * 1024 * 1024;
        let tiny_old = f(4096, NOW - 3000 * DAY, NOW);
        let huge_stale = f(30 * gb, NOW - 300 * DAY, NOW);
        assert!(raw_cleanup_score(&huge_stale, NOW) > raw_cleanup_score(&tiny_old, NOW));
    }

    #[test]
    fn unknown_usage_is_damped() {
        let gb = 1024 * 1024 * 1024;
        let known_old = f(10 * gb, NOW - 500 * DAY, NOW - 500 * DAY);
        let unknown = f(10 * gb, NO_TIME, NOW - 500 * DAY);
        assert!(raw_cleanup_score(&known_old, NOW) > raw_cleanup_score(&unknown, NOW));
    }

    #[test]
    fn quick_filters_gate_on_size_and_age() {
        let gb = 1024 * 1024 * 1024;
        let big_fresh = f(6 * gb, NOW - DAY, NOW);
        assert!(QuickFilter::Size5G.matches(&big_fresh, NOW));
        assert!(!QuickFilter::Size10G.matches(&big_fresh, NOW));
        assert!(!QuickFilter::Unused6m.matches(&big_fresh, NOW));

        let old = f(gb, NOW - 400 * DAY, NOW);
        assert!(QuickFilter::Unused1y.matches(&old, NOW));
        assert!(!QuickFilter::Unused2y.matches(&old, NOW));

        // Unknown usage must not silently pass an "unused" filter.
        let unknown = f(gb, NO_TIME, NOW);
        assert!(!QuickFilter::Unused3m.matches(&unknown, NOW));
    }
}
