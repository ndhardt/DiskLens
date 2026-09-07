//! The Tree view: hierarchy preserved, biggest-first at every level.
//!
//! Expansion state lives here rather than in React, so flattening a tree with
//! hundreds of thousands of folders never crosses the IPC boundary.

use serde::{Deserialize, Serialize};

use super::{ScanIndex, NO_PARENT};
use crate::index::files::opt_time;
use crate::model::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TreeSortKey {
    Name,
    PctParent,
    Size,
    Allocated,
    Files,
    Folders,
    LastUsed,
    UnusedFor,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeSort {
    pub key: TreeSortKey,
    pub desc: bool,
}

impl Default for TreeSort {
    fn default() -> Self {
        TreeSort {
            key: TreeSortKey::Size,
            desc: true,
        }
    }
}

/// One row of the left-hand tree table.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeRow {
    pub id: u32,
    pub name: String,
    pub depth: u16,
    pub expanded: bool,
    pub has_children: bool,
    pub pct_parent: f32,
    pub size: u64,
    pub alloc: u64,
    pub files: u64,
    pub folders: u64,
    pub last_used: Option<i64>,
    pub last_used_source: LastUsedSource,
    pub modified: Option<i64>,
    pub path: String,
    pub protected: bool,
    pub immutable: bool,
    pub denied: bool,
    pub package: bool,
    pub category: Category,
}

impl ScanIndex {
    /// Children of `id`, ordered by the active tree sort.
    fn sorted_children(&self, id: u32) -> Vec<u32> {
        let d = &self.dirs[id as usize];
        let mut kids = d.children.clone();
        let sort = self.tree_sort;

        // `children` is already stored in allocated-size-descending order.
        if sort.key == TreeSortKey::Size && sort.desc {
            return kids;
        }

        kids.sort_unstable_by(|a, b| {
            let da = &self.dirs[*a as usize];
            let db = &self.dirs[*b as usize];
            use std::cmp::Ordering;
            let time_cmp = |ta: i64, tb: i64, desc: bool| match (ta == NO_TIME, tb == NO_TIME) {
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
            };
            let ord = match sort.key {
                TreeSortKey::Name => {
                    let o = self
                        .dir_name(*a)
                        .to_lowercase()
                        .cmp(&self.dir_name(*b).to_lowercase());
                    if sort.desc {
                        o.reverse()
                    } else {
                        o
                    }
                }
                // Within one parent, "% of parent" ranks identically to size.
                TreeSortKey::Size | TreeSortKey::PctParent => {
                    let o = da.agg_size.cmp(&db.agg_size);
                    if sort.desc {
                        o.reverse()
                    } else {
                        o
                    }
                }
                TreeSortKey::Allocated => {
                    let o = da.agg_alloc.cmp(&db.agg_alloc);
                    if sort.desc {
                        o.reverse()
                    } else {
                        o
                    }
                }
                TreeSortKey::Files => {
                    let o = da.agg_files.cmp(&db.agg_files);
                    if sort.desc {
                        o.reverse()
                    } else {
                        o
                    }
                }
                TreeSortKey::Folders => {
                    let o = da.agg_dirs.cmp(&db.agg_dirs);
                    if sort.desc {
                        o.reverse()
                    } else {
                        o
                    }
                }
                TreeSortKey::LastUsed => time_cmp(da.agg_last_used, db.agg_last_used, sort.desc),
                TreeSortKey::UnusedFor => time_cmp(da.agg_last_used, db.agg_last_used, !sort.desc),
            };
            ord.then_with(|| a.cmp(b))
        });
        kids
    }

    /// Flatten the visible part of the tree into an ordered id list.
    pub fn tree_rows(&mut self) -> &[u32] {
        if self.tree_rows_cache.is_none() {
            let mut out = Vec::with_capacity(1024);
            if !self.dirs.is_empty() {
                let mut stack: Vec<u32> = vec![ROOT_ONLY];
                // Explicit stack, so a pathological depth cannot blow the real one.
                while let Some(id) = stack.pop() {
                    out.push(id);
                    if self.expanded.get(id as usize).copied().unwrap_or(false) {
                        let kids = self.sorted_children(id);
                        for &k in kids.iter().rev() {
                            stack.push(k);
                        }
                    }
                }
            }
            self.tree_rows_cache = Some(out);
        }
        self.tree_rows_cache.as_deref().unwrap()
    }

    pub fn invalidate_tree(&mut self) {
        self.tree_rows_cache = None;
    }

    pub fn set_expanded(&mut self, id: u32, on: bool) {
        if let Some(slot) = self.expanded.get_mut(id as usize) {
            if *slot != on {
                *slot = on;
                self.invalidate_tree();
            }
        }
    }

    /// Expand every ancestor of `id` so a row becomes reachable, and return the
    /// row index it lands on.
    pub fn reveal_dir(&mut self, id: u32) -> Option<usize> {
        if id as usize >= self.dirs.len() {
            return None;
        }
        let mut chain = Vec::new();
        let mut cur = self.dirs[id as usize].parent;
        while cur != NO_PARENT {
            chain.push(cur);
            cur = self.dirs[cur as usize].parent;
        }
        for c in chain {
            self.expanded[c as usize] = true;
        }
        self.invalidate_tree();
        self.tree_rows().iter().position(|&r| r == id)
    }

    pub fn expand_to_depth(&mut self, depth: u16) {
        for i in 0..self.dirs.len() {
            self.expanded[i] = self.dirs[i].depth < depth;
        }
        self.invalidate_tree();
    }

    pub fn collapse_all(&mut self) {
        for e in self.expanded.iter_mut() {
            *e = false;
        }
        if !self.expanded.is_empty() {
            self.expanded[0] = true;
        }
        self.invalidate_tree();
    }

    pub fn make_tree_row(&self, id: u32) -> TreeRow {
        let d = &self.dirs[id as usize];
        let parent_total = if d.parent == NO_PARENT {
            d.agg_size
        } else {
            self.dirs[d.parent as usize].agg_size
        };
        let pct = if parent_total > 0 {
            (d.agg_size as f64 / parent_total as f64 * 100.0) as f32
        } else {
            0.0
        };
        let path = self.dir_path(id);
        let ext = extension_of(self.names.get(d.name));
        TreeRow {
            id,
            name: self.names.get(d.name).to_string(),
            depth: d.depth,
            expanded: self.expanded.get(id as usize).copied().unwrap_or(false),
            has_children: !d.children.is_empty(),
            pct_parent: pct,
            size: d.agg_size,
            alloc: d.agg_alloc,
            files: d.agg_files,
            folders: d.agg_dirs,
            last_used: opt_time(d.agg_last_used),
            last_used_source: if d.agg_last_used == NO_TIME {
                LastUsedSource::Unknown
            } else {
                LastUsedSource::FileSystemAccessTime
            },
            modified: opt_time(d.agg_mtime),
            protected: is_protected_path(&path),
            immutable: is_immutable_path(&path),
            denied: d.has(flags::IS_DENIED),
            package: d.has(flags::IS_PACKAGE),
            category: if d.has(flags::IS_SYSTEM) {
                Category::System
            } else if ext.is_empty() {
                Category::Other
            } else {
                categorize(&ext)
            },
            path,
        }
    }
}

const ROOT_ONLY: u32 = 0;

#[cfg(test)]
mod tests {
    use super::*;

    fn build() -> ScanIndex {
        // root
        //   a (300)
        //     a1 (200)
        //   b (500)
        let mut ix = ScanIndex::new("/r".into(), "T".into());
        for (name, parent, depth) in [("/r", NO_PARENT, 0u16), ("a", 0, 1), ("a1", 1, 2), ("b", 0, 1)] {
            let n = ix.names.push(name);
            ix.dirs.push(DirRec::new(n, parent, depth, flags::IS_DIR));
        }
        ix.dirs[0].children = vec![1, 3];
        ix.dirs[1].children = vec![2];

        let add = |ix: &mut ScanIndex, dir: u32, size: u64| {
            let n = ix.names.push("f");
            ix.files.push(FileRec {
                name: n,
                parent: dir,
                ext: 0,
                size,
                alloc: size,
                mtime: 100,
                atime: 100,
                btime: 100,
                last_used: 100,
                flags: 0,
            });
            let id = ix.files.len() as u32 - 1;
            ix.dirs[dir as usize].files.push(id);
        };
        add(&mut ix, 1, 100);
        add(&mut ix, 2, 200);
        add(&mut ix, 3, 500);
        ix.finalize(1_000_000);
        ix
    }

    #[test]
    fn hierarchy_is_kept_while_sorting_by_size() {
        let mut ix = build();
        ix.collapse_all();
        ix.set_expanded(0, true);
        // b (500) must come before a (300) at the same level.
        let rows: Vec<u32> = ix.tree_rows().to_vec();
        assert_eq!(rows, vec![0, 3, 1]);

        ix.set_expanded(1, true);
        let rows: Vec<u32> = ix.tree_rows().to_vec();
        // a1 stays nested under a, not hoisted above b.
        assert_eq!(rows, vec![0, 3, 1, 2]);
    }

    #[test]
    fn pct_parent_is_relative_to_the_parent() {
        let ix = build();
        let r = ix.make_tree_row(1);
        assert!((r.pct_parent - 37.5).abs() < 0.01); // 300 / 800
        let r = ix.make_tree_row(2);
        assert!((r.pct_parent - 66.6667).abs() < 0.01); // 200 / 300
    }

    #[test]
    fn reveal_expands_ancestors() {
        let mut ix = build();
        ix.collapse_all();
        let pos = ix.reveal_dir(2).unwrap();
        assert_eq!(ix.tree_rows()[pos], 2);
        assert!(ix.expanded[1]);
    }
}
