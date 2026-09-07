//! The in-memory index produced by a scan.
//!
//! Everything the UI asks for is answered from here: tree rows, file rows,
//! Space Hogs rankings, extension aggregates and Treemap layouts. The frontend
//! only ever receives the window it is about to paint.

pub mod directories;
pub mod extensions;
pub mod files;

use std::collections::HashMap;

use crate::model::*;

pub const ROOT_DIR: u32 = 0;
pub const NO_PARENT: u32 = u32::MAX;

pub struct ScanIndex {
    pub root_path: String,
    pub volume_name: String,

    pub names: NameArena,
    pub dirs: Vec<DirRec>,
    pub files: Vec<FileRec>,

    /// Extension table. `ext_id` 0 is always the empty extension.
    pub ext_names: Vec<String>,
    pub ext_lookup: HashMap<String, u32>,
    pub ext_cats: Vec<Category>,

    /// Scan bookkeeping.
    pub skipped: u64,
    pub denied_dirs: Vec<u32>,
    pub duration_ms: u64,
    pub scanned_at: i64,

    /// Volume capacity, as reported by statfs at scan time.
    pub volume_total: u64,
    pub volume_free: u64,

    /// Files sorted by size descending — the backbone of Space Hogs and search.
    /// Built once at the end of a scan.
    pub by_size: Vec<u32>,
    /// `by_size` with bundle contents rolled into their bundle.
    pub items_grouped: Vec<u32>,
    /// `by_size` with the synthetic bundle rows removed.
    pub items_flat: Vec<u32>,
    /// Synthetic bundle row -> the directory it stands for.
    pub dir_of_synthetic: HashMap<u32, u32>,
    pub synthetic_of_dir: HashMap<u32, u32>,
    /// Number of real files, excluding synthetic bundle rows.
    pub real_files: u64,

    /// Tree expansion state lives in Rust so the frontend never has to hold or
    /// ship a multi-million-entry set.
    pub expanded: Vec<bool>,

    /// Cached flattened tree rows; invalidated on expand/collapse or re-sort.
    pub tree_rows_cache: Option<Vec<u32>>,
    pub tree_sort: directories::TreeSort,

    /// Highest cleanup score seen, used to normalise into 0..100.
    pub cleanup_norm: f64,
}

impl ScanIndex {
    pub fn new(root_path: String, volume_name: String) -> Self {
        let mut ext_names = Vec::with_capacity(256);
        let mut ext_lookup = HashMap::with_capacity(256);
        let mut ext_cats = Vec::with_capacity(256);
        ext_names.push(String::new());
        ext_lookup.insert(String::new(), 0u32);
        ext_cats.push(Category::Other);

        Self {
            root_path,
            volume_name,
            names: NameArena::with_capacity(1 << 20),
            dirs: Vec::new(),
            files: Vec::new(),
            ext_names,
            ext_lookup,
            ext_cats,
            skipped: 0,
            denied_dirs: Vec::new(),
            duration_ms: 0,
            scanned_at: 0,
            volume_total: 0,
            volume_free: 0,
            by_size: Vec::new(),
            items_grouped: Vec::new(),
            items_flat: Vec::new(),
            dir_of_synthetic: HashMap::new(),
            synthetic_of_dir: HashMap::new(),
            real_files: 0,
            expanded: Vec::new(),
            tree_rows_cache: None,
            tree_sort: directories::TreeSort::default(),
            cleanup_norm: 1.0,
        }
    }

    pub fn intern_ext(&mut self, ext: &str) -> u32 {
        if ext.is_empty() {
            return 0;
        }
        if let Some(id) = self.ext_lookup.get(ext) {
            return *id;
        }
        let id = self.ext_names.len() as u32;
        self.ext_names.push(ext.to_string());
        self.ext_cats.push(categorize(ext));
        self.ext_lookup.insert(ext.to_string(), id);
        id
    }

    #[inline]
    pub fn dir_name(&self, id: u32) -> &str {
        self.names.get(self.dirs[id as usize].name)
    }

    #[inline]
    pub fn file_name(&self, id: u32) -> &str {
        self.names.get(self.files[id as usize].name)
    }

    #[inline]
    pub fn ext_name(&self, id: u32) -> &str {
        &self.ext_names[id as usize]
    }

    #[inline]
    pub fn file_category(&self, id: u32) -> Category {
        let f = &self.files[id as usize];
        if f.has(flags::IS_SYSTEM) {
            return Category::System;
        }
        self.ext_cats[f.ext as usize]
    }

    /// Absolute path of a directory.
    pub fn dir_path(&self, id: u32) -> String {
        let mut parts: Vec<&str> = Vec::with_capacity(12);
        let mut cur = id;
        loop {
            let d = &self.dirs[cur as usize];
            parts.push(self.names.get(d.name));
            if d.parent == NO_PARENT {
                break;
            }
            cur = d.parent;
        }
        parts.reverse();
        join_abs(&parts)
    }

    /// Absolute path of a file.
    pub fn file_path(&self, id: u32) -> String {
        let f = &self.files[id as usize];
        let parent = self.dir_path(f.parent);
        if parent.ends_with('/') {
            format!("{}{}", parent, self.names.get(f.name))
        } else {
            format!("{}/{}", parent, self.names.get(f.name))
        }
    }

    /// Directory containing a file, as a path (for the `Path` column).
    pub fn file_dir_path(&self, id: u32) -> String {
        self.dir_path(self.files[id as usize].parent)
    }

    /// Aggregate the whole tree bottom-up. Directories were appended in BFS
    /// order during the walk, so iterating backwards visits children first.
    pub fn aggregate(&mut self) {
        for i in (0..self.dirs.len()).rev() {
            let (mut size, mut alloc, mut nfiles) = (0u64, 0u64, 0u64);
            let mut last_used = self.dirs[i].last_used;
            let mut newest_mtime = self.dirs[i].mtime;
            for &fid in &self.dirs[i].files {
                let f = &self.files[fid as usize];
                // A hard link we have already counted contributes logical size
                // but no additional physical bytes.
                size += f.size;
                if !f.has(flags::IS_HARDLINK_DUP) {
                    alloc += f.alloc;
                }
                nfiles += 1;
                last_used = newer(last_used, f.effective_last_used());
                newest_mtime = newer(newest_mtime, f.mtime);
            }
            let mut ndirs = 0u64;
            let children = std::mem::take(&mut self.dirs[i].children);
            for &cid in &children {
                let c = &self.dirs[cid as usize];
                size += c.agg_size;
                alloc += c.agg_alloc;
                nfiles += c.agg_files;
                ndirs += c.agg_dirs + 1;
                last_used = newer(last_used, c.agg_last_used);
                newest_mtime = newer(newest_mtime, c.agg_mtime);
            }
            let d = &mut self.dirs[i];
            d.children = children;
            d.agg_size = size;
            d.agg_alloc = alloc;
            d.agg_files = nfiles;
            d.agg_dirs = ndirs;
            d.agg_last_used = last_used;
            d.agg_mtime = newest_mtime;
        }
    }

    /// Sort every directory's children and files by allocated size descending,
    /// so the tree reads "biggest first" at every level while staying nested.
    pub fn sort_children_by_size(&mut self) {
        let dir_keys: Vec<u64> = self.dirs.iter().map(|d| d.agg_alloc.max(d.agg_size)).collect();
        let file_keys: Vec<u64> = self.files.iter().map(|f| f.alloc.max(f.size)).collect();
        for d in self.dirs.iter_mut() {
            d.children
                .sort_unstable_by(|a, b| dir_keys[*b as usize].cmp(&dir_keys[*a as usize]));
            d.files
                .sort_unstable_by(|a, b| file_keys[*b as usize].cmp(&file_keys[*a as usize]));
        }
    }

    /// Build the global size-ordered file list.
    pub fn build_by_size(&mut self) {
        let mut ids: Vec<u32> = (0..self.files.len() as u32).collect();
        let files = &self.files;
        ids.sort_unstable_by(|a, b| {
            let fa = &files[*a as usize];
            let fb = &files[*b as usize];
            fb.alloc
                .max(fb.size)
                .cmp(&fa.alloc.max(fa.size))
                .then_with(|| a.cmp(b))
        });
        self.by_size = ids;
    }

    /// Normalisation factor for the cleanup score, from the top slice of files.
    pub fn build_cleanup_norm(&mut self, now: i64) {
        let mut best = 1.0f64;
        for &id in self.by_size.iter().take(20_000) {
            let raw = files::raw_cleanup_score(&self.files[id as usize], now);
            if raw > best {
                best = raw;
            }
        }
        self.cleanup_norm = best;
    }

    /// Give every outermost bundle a single stand-in row.
    ///
    /// A `.photoslibrary` or `.app` is one thing to a person, so Space Hogs
    /// ranks the bundle rather than the thousands of files inside it. The real
    /// files stay in the index — the Tree and the file list still show them.
    fn build_package_items(&mut self) {
        self.real_files = self.files.len() as u64;
        let outermost: Vec<u32> = (0..self.dirs.len() as u32)
            .filter(|&i| {
                let d = &self.dirs[i as usize];
                d.has(flags::IS_PACKAGE) && !d.has(flags::IN_PACKAGE) && d.agg_size > 0
            })
            .collect();

        for dir_id in outermost {
            let (name, parent, size, alloc, mtime, atime, btime, last_used, sysflag) = {
                let d = &self.dirs[dir_id as usize];
                (
                    d.name,
                    d.parent,
                    d.agg_size,
                    d.agg_alloc,
                    d.agg_mtime,
                    d.atime,
                    d.btime,
                    d.agg_last_used,
                    d.flags & (flags::IS_SYSTEM | flags::IS_CLOUD),
                )
            };
            let ext_str = extension_of(self.names.get(name));
            let ext = self.intern_ext(&ext_str);
            self.files.push(FileRec {
                name,
                parent,
                ext,
                size,
                alloc,
                mtime,
                atime,
                btime,
                last_used,
                flags: flags::IS_SYNTHETIC | flags::IS_PACKAGE | sysflag,
            });
            let fid = self.files.len() as u32 - 1;
            self.dir_of_synthetic.insert(fid, dir_id);
            self.synthetic_of_dir.insert(dir_id, fid);
        }
    }

    fn build_item_lists(&mut self) {
        let mut grouped = Vec::with_capacity(self.by_size.len());
        let mut flat = Vec::with_capacity(self.by_size.len());
        for &id in &self.by_size {
            let f = &self.files[id as usize];
            if f.has(flags::IS_SYNTHETIC) {
                grouped.push(id);
            } else {
                flat.push(id);
                if !f.has(flags::IN_PACKAGE) {
                    grouped.push(id);
                }
            }
        }
        self.items_grouped = grouped;
        self.items_flat = flat;
    }

    /// The candidate list Space Hogs and search run over.
    pub fn items(&self, group_bundles: bool) -> &[u32] {
        if group_bundles {
            &self.items_grouped
        } else {
            &self.items_flat
        }
    }

    /// Where a row should point when the user asks to reveal it.
    pub fn item_path(&self, id: u32) -> String {
        match self.dir_of_synthetic.get(&id) {
            Some(&dir) => self.dir_path(dir),
            None => self.file_path(id),
        }
    }

    pub fn finalize(&mut self, now: i64) {
        self.aggregate();
        self.build_package_items();
        self.sort_children_by_size();
        self.build_by_size();
        self.build_item_lists();
        self.build_cleanup_norm(now);
        self.expanded = vec![false; self.dirs.len()];
        if !self.dirs.is_empty() {
            self.expanded[0] = true;
            // Open the first level so a fresh scan already shows structure.
            let top: Vec<u32> = self.dirs[0].children.iter().copied().take(1).collect();
            for id in top {
                self.expanded[id as usize] = true;
            }
        }
        self.tree_rows_cache = None;
    }

    pub fn total_size(&self) -> u64 {
        self.dirs.first().map(|d| d.agg_size).unwrap_or(0)
    }

    pub fn total_alloc(&self) -> u64 {
        self.dirs.first().map(|d| d.agg_alloc).unwrap_or(0)
    }
}

#[inline]
fn newer(a: i64, b: i64) -> i64 {
    if b == NO_TIME {
        a
    } else if a == NO_TIME {
        b
    } else {
        a.max(b)
    }
}

fn join_abs(parts: &[&str]) -> String {
    // The root component already carries its own leading slash.
    let mut s = String::with_capacity(parts.iter().map(|p| p.len() + 1).sum());
    for (i, p) in parts.iter().enumerate() {
        if i == 0 {
            s.push_str(p);
        } else {
            if !s.ends_with('/') {
                s.push('/');
            }
            s.push_str(p);
        }
    }
    if s.is_empty() {
        s.push('/');
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny() -> ScanIndex {
        let mut ix = ScanIndex::new("/root".into(), "Test".into());
        let n = ix.names.push("/root");
        ix.dirs.push(DirRec::new(n, NO_PARENT, 0, flags::IS_DIR));
        let n = ix.names.push("sub");
        ix.dirs.push(DirRec::new(n, 0, 1, flags::IS_DIR));
        ix.dirs[0].children.push(1);

        let ext = ix.intern_ext("mov");
        let n = ix.names.push("a.mov");
        ix.files.push(FileRec {
            name: n,
            parent: 0,
            ext,
            size: 100,
            alloc: 128,
            mtime: 0,
            atime: 0,
            btime: 0,
            last_used: 0,
            flags: 0,
        });
        ix.dirs[0].files.push(0);

        let n = ix.names.push("b.zip");
        let ext = ix.intern_ext("zip");
        ix.files.push(FileRec {
            name: n,
            parent: 1,
            ext,
            size: 500,
            alloc: 512,
            mtime: 0,
            atime: 0,
            btime: 0,
            last_used: 0,
            flags: 0,
        });
        ix.dirs[1].files.push(1);
        ix
    }

    #[test]
    fn aggregates_bottom_up() {
        let mut ix = tiny();
        ix.finalize(1_700_000_000);
        assert_eq!(ix.dirs[1].agg_size, 500);
        assert_eq!(ix.dirs[0].agg_size, 600);
        assert_eq!(ix.dirs[0].agg_alloc, 640);
        assert_eq!(ix.dirs[0].agg_files, 2);
        assert_eq!(ix.dirs[0].agg_dirs, 1);
    }

    #[test]
    fn paths_are_absolute_and_unduplicated() {
        let ix = tiny();
        assert_eq!(ix.dir_path(0), "/root");
        assert_eq!(ix.dir_path(1), "/root/sub");
        assert_eq!(ix.file_path(1), "/root/sub/b.zip");
    }

    #[test]
    fn root_slash_does_not_double() {
        let mut ix = ScanIndex::new("/".into(), "Mac".into());
        let n = ix.names.push("/");
        ix.dirs.push(DirRec::new(n, NO_PARENT, 0, flags::IS_DIR));
        let n = ix.names.push("Users");
        ix.dirs.push(DirRec::new(n, 0, 1, flags::IS_DIR));
        assert_eq!(ix.dir_path(1), "/Users");
    }

    #[test]
    fn by_size_is_descending() {
        let mut ix = tiny();
        ix.finalize(1_700_000_000);
        assert_eq!(ix.by_size, vec![1, 0]);
    }

    #[test]
    fn extension_parsing() {
        assert_eq!(extension_of("movie.MOV"), "mov");
        assert_eq!(extension_of(".bashrc"), "");
        assert_eq!(extension_of("Makefile"), "");
        assert_eq!(extension_of("a.b.safetensors"), "safetensors");
        assert_eq!(extension_of("weird.name with space"), "");
    }

    #[test]
    fn protected_paths_match_prefixes_only() {
        assert!(is_protected_path("/System/Library/Foo"));
        assert!(is_protected_path("/usr"));
        assert!(!is_protected_path("/Users/user"));
        assert!(!is_protected_path("/usrlocal"));
        assert!(is_immutable_path("/private/var/db"));
        assert!(!is_immutable_path("/Library/Caches"));
    }
}
