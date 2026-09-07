//! Directory walking.
//!
//! A [`DiskScanner`] knows how to list one directory with metadata. The walker
//! in this module drives it breadth-first, one level at a time, with the whole
//! level read in parallel. Merging is single threaded but only pushes into
//! vectors, so the syscalls stay the bottleneck — which is the point.

pub mod macos;
pub mod standard;

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use rayon::prelude::*;

use crate::index::{ScanIndex, NO_PARENT};
use crate::model::*;
use crate::volumes::MountTable;

/// One entry as returned by a directory read.
#[derive(Debug, Clone)]
pub struct RawEntry {
    pub name: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    /// Logical size. For a cloud placeholder this is the full size of the file.
    pub size: u64,
    /// Bytes actually occupied on this disk. Zero for cloud placeholders.
    pub alloc: u64,
    pub mtime: i64,
    pub atime: i64,
    pub btime: i64,
    pub st_flags: u32,
    pub ino: u64,
    pub dev: i64,
    /// Hard link count. Only meaningful for files: APFS and `lstat` disagree on
    /// what a directory's link count is, and nothing here needs it.
    pub nlink: u32,
}

#[derive(Debug)]
pub enum ReadError {
    Denied,
    NotFound,
    Other(i32),
}

pub trait DiskScanner: Send + Sync {
    fn name(&self) -> &'static str;
    fn read_dir(&self, path: &Path) -> Result<Vec<RawEntry>, ReadError>;
}

#[derive(Clone, Debug)]
pub struct ScanOptions {
    pub root: PathBuf,
    pub volume_name: String,
    /// Symlinks are recorded but never descended into by default.
    pub follow_symlinks: bool,
    /// Descend into filesystems mounted below the root that are not part of the
    /// root's own volume group.
    pub cross_volumes: bool,
    /// Use the `getattrlistbulk` scanner when available.
    pub fast: bool,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            root: PathBuf::from("/"),
            volume_name: "Macintosh HD".into(),
            follow_symlinks: false,
            cross_volumes: false,
            fast: true,
        }
    }
}

#[derive(Default, Clone, Debug)]
pub struct WalkStats {
    pub files: u64,
    pub dirs: u64,
    pub bytes: u64,
    pub alloc: u64,
    pub skipped: u64,
    pub current: String,
    pub elapsed_ms: u64,
    pub done: bool,
}

/// SF_DATALESS — the file's bytes live in iCloud, not on this disk. Reading a
/// dataless file's *content* would fault it in; reading metadata does not, and
/// metadata is all we ever touch.
pub const SF_DATALESS: u32 = 0x4000_0000;

pub fn make_scanner(opts: &ScanOptions) -> Box<dyn DiskScanner> {
    #[cfg(target_os = "macos")]
    if opts.fast && macos::available() {
        return Box::new(macos::MacOSFastScanner::new());
    }
    let _ = opts;
    Box::new(standard::StandardScanner)
}

/// Walk `opts.root`, filling `index`.
///
/// `progress` is called at most every ~90ms with running totals; it is never
/// called per file.
pub fn walk(
    opts: &ScanOptions,
    scanner: &dyn DiskScanner,
    index: &mut ScanIndex,
    cancel: &Arc<AtomicBool>,
    mounts: &MountTable,
    progress: &mut dyn FnMut(&ScanIndex, &WalkStats),
) -> WalkStats {
    let started = Instant::now();
    let mut stats = WalkStats::default();

    let root_str = opts.root.to_string_lossy().to_string();
    let root_name = index.names.push(&root_str);
    let root_flags = flags::IS_DIR
        | if is_protected_path(&root_str) {
            flags::IS_SYSTEM
        } else {
            0
        };
    let mut root_rec = DirRec::new(root_name, NO_PARENT, 0, root_flags);
    if let Ok(md) = std::fs::metadata(&opts.root) {
        use std::os::unix::fs::MetadataExt;
        root_rec.mtime = md.mtime();
        root_rec.atime = md.atime();
        root_rec.btime = md.created().ok().and_then(sys_time_secs).unwrap_or(NO_TIME);
    }
    index.dirs.push(root_rec);

    // Devices we are willing to descend onto.
    let allowed_devs = mounts.devices_for_scan(&opts.root, opts.cross_volumes);

    // (dev, ino) of every directory we have entered, so firmlinked paths such as
    // `/Users` and `/System/Volumes/Data/Users` are counted exactly once.
    let mut seen_dirs: HashSet<(i64, u64)> = HashSet::with_capacity(4096);
    // (dev, ino) of multiply-linked files, so hard links do not inflate the disk
    // total. The first sighting keeps the bytes.
    let mut seen_links: HashSet<(i64, u64)> = HashSet::with_capacity(1024);

    if let Ok(md) = std::fs::metadata(&opts.root) {
        use std::os::unix::fs::MetadataExt;
        seen_dirs.insert((md.dev() as i64, md.ino()));
    }

    let mut frontier: Vec<u32> = vec![0];
    let mut last_report = Instant::now();

    while !frontier.is_empty() {
        if cancel.load(Ordering::Relaxed) {
            break;
        }

        let jobs: Vec<(u32, PathBuf)> = frontier
            .iter()
            .map(|&id| (id, PathBuf::from(index.dir_path(id))))
            .collect();

        let results: Vec<(u32, PathBuf, Result<Vec<RawEntry>, ReadError>)> = jobs
            .into_par_iter()
            .map(|(id, path)| {
                if cancel.load(Ordering::Relaxed) {
                    return (id, path, Ok(Vec::new()));
                }
                let r = scanner.read_dir(&path);
                (id, path, r)
            })
            .collect();

        let mut next: Vec<u32> = Vec::with_capacity(results.len() * 2);

        for (dir_id, dir_path, res) in results {
            let entries = match res {
                Ok(e) => e,
                Err(ReadError::Denied) => {
                    index.dirs[dir_id as usize].flags |= flags::IS_DENIED;
                    index.denied_dirs.push(dir_id);
                    stats.skipped += 1;
                    continue;
                }
                Err(_) => {
                    stats.skipped += 1;
                    continue;
                }
            };

            let parent_depth = index.dirs[dir_id as usize].depth;
            let parent_in_pkg = index.dirs[dir_id as usize].flags
                & (flags::IS_PACKAGE | flags::IN_PACKAGE)
                != 0;
            let parent_system = index.dirs[dir_id as usize].has(flags::IS_SYSTEM);
            let dir_path_str = dir_path.to_string_lossy();

            for e in entries {
                if e.is_symlink && !opts.follow_symlinks {
                    // Recorded as a zero-cost leaf: the bytes belong to the target.
                    push_file(index, dir_id, &e, flags::IS_SYMLINK, 0, 0);
                    stats.files += 1;
                    continue;
                }

                let child_path = if dir_path_str.ends_with('/') {
                    format!("{dir_path_str}{}", e.name)
                } else {
                    format!("{dir_path_str}/{}", e.name)
                };

                if e.is_dir {
                    let ext = extension_of(&e.name);
                    let is_pkg = !ext.is_empty() && is_package_ext(&ext);

                    // Mount points get their identity from the mounted volume,
                    // which is only visible through stat().
                    let (dev, ino) = if mounts.is_mount_point(&child_path) {
                        stat_dev_ino(&child_path).unwrap_or((e.dev, e.ino))
                    } else {
                        (e.dev, e.ino)
                    };

                    if !allowed_devs.is_empty() && !allowed_devs.contains(&dev) {
                        stats.skipped += 1;
                        continue;
                    }
                    if !seen_dirs.insert((dev, ino)) {
                        // Already reached by a shorter path (firmlink or bind).
                        continue;
                    }

                    let mut f = flags::IS_DIR;
                    if is_pkg {
                        f |= flags::IS_PACKAGE;
                    }
                    if parent_in_pkg {
                        f |= flags::IN_PACKAGE;
                    }
                    if parent_system || is_protected_path(&child_path) {
                        f |= flags::IS_SYSTEM;
                    }
                    if e.st_flags & SF_DATALESS != 0 {
                        f |= flags::IS_CLOUD;
                    }

                    let name = index.names.push(&e.name);
                    let mut rec = DirRec::new(name, dir_id, parent_depth + 1, f);
                    rec.mtime = e.mtime;
                    rec.atime = e.atime;
                    rec.btime = e.btime;
                    index.dirs.push(rec);
                    let new_id = index.dirs.len() as u32 - 1;
                    index.dirs[dir_id as usize].children.push(new_id);
                    next.push(new_id);
                    stats.dirs += 1;
                } else {
                    let mut f = 0u32;
                    if parent_in_pkg {
                        f |= flags::IN_PACKAGE;
                    }
                    if parent_system {
                        f |= flags::IS_SYSTEM;
                    }
                    let cloud = e.st_flags & SF_DATALESS != 0
                        || (e.name.starts_with('.') && e.name.ends_with(".icloud"));
                    if cloud {
                        f |= flags::IS_CLOUD;
                    }
                    // A hard link seen for the second time must not add bytes
                    // to the disk total a second time.
                    if e.nlink > 1 && !seen_links.insert((e.dev, e.ino)) {
                        f |= flags::IS_HARDLINK_DUP;
                    }
                    push_file(index, dir_id, &e, f, e.size, e.alloc);
                    stats.files += 1;
                    stats.bytes += e.size;
                    if f & flags::IS_HARDLINK_DUP == 0 {
                        stats.alloc += e.alloc;
                    }
                }
            }

            if last_report.elapsed().as_millis() >= 90 {
                stats.current = dir_path.to_string_lossy().to_string();
                stats.elapsed_ms = started.elapsed().as_millis() as u64;
                progress(index, &stats);
                last_report = Instant::now();
            }
        }

        frontier = next;
    }

    index.skipped = stats.skipped;
    stats.elapsed_ms = started.elapsed().as_millis() as u64;
    stats.done = true;
    stats
}

fn push_file(index: &mut ScanIndex, dir: u32, e: &RawEntry, extra_flags: u32, size: u64, alloc: u64) {
    let ext_str = extension_of(&e.name);
    let ext = index.intern_ext(&ext_str);
    let name = index.names.push(&e.name);
    index.files.push(FileRec {
        name,
        parent: dir,
        ext,
        size,
        alloc,
        mtime: e.mtime,
        atime: e.atime,
        btime: e.btime,
        last_used: NO_TIME,
        flags: extra_flags,
    });
    let id = index.files.len() as u32 - 1;
    index.dirs[dir as usize].files.push(id);
}

fn stat_dev_ino(path: &str) -> Option<(i64, u64)> {
    use std::os::unix::fs::MetadataExt;
    let md = std::fs::metadata(path).ok()?;
    Some((md.dev() as i64, md.ino()))
}

pub fn sys_time_secs(t: std::time::SystemTime) -> Option<i64> {
    t.duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmpdir(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("disklens-test-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn run(root: &Path) -> ScanIndex {
        let opts = ScanOptions {
            root: root.to_path_buf(),
            volume_name: "T".into(),
            fast: false,
            ..Default::default()
        };
        let scanner = standard::StandardScanner;
        let mut ix = ScanIndex::new(root.to_string_lossy().to_string(), "T".into());
        let cancel = Arc::new(AtomicBool::new(false));
        let mounts = MountTable::load();
        walk(&opts, &scanner, &mut ix, &cancel, &mounts, &mut |_, _| {});
        ix.finalize(1_760_000_000);
        ix
    }

    #[test]
    fn walks_a_real_tree() {
        let root = tmpdir("walk");
        fs::create_dir_all(root.join("a/b")).unwrap();
        fs::write(root.join("top.bin"), vec![0u8; 4096]).unwrap();
        fs::write(root.join("a/mid.bin"), vec![0u8; 8192]).unwrap();
        fs::write(root.join("a/b/deep.mov"), vec![0u8; 16384]).unwrap();

        let ix = run(&root);
        assert_eq!(ix.dirs[0].agg_files, 3);
        assert_eq!(ix.dirs[0].agg_dirs, 2);
        assert_eq!(ix.dirs[0].agg_size, 4096 + 8192 + 16384);
        // Biggest child first.
        assert_eq!(ix.dir_name(ix.dirs[0].children[0]), "a");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn empty_directories_are_kept_with_zero_size() {
        let root = tmpdir("empty");
        fs::create_dir_all(root.join("hollow")).unwrap();
        let ix = run(&root);
        assert_eq!(ix.dirs.len(), 2);
        assert_eq!(ix.dirs[1].agg_size, 0);
        assert_eq!(ix.dirs[1].agg_files, 0);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn symlinks_are_not_followed_and_add_no_bytes() {
        let root = tmpdir("symlink");
        fs::create_dir_all(root.join("real")).unwrap();
        fs::write(root.join("real/f.bin"), vec![0u8; 2048]).unwrap();
        std::os::unix::fs::symlink(root.join("real"), root.join("loop")).unwrap();

        let ix = run(&root);
        assert_eq!(ix.dirs[0].agg_size, 2048, "symlink must not double-count");
        let link = (0..ix.files.len() as u32).find(|&i| ix.file_name(i) == "loop");
        assert!(link.is_some(), "symlink is still listed");
        assert_eq!(ix.files[link.unwrap() as usize].size, 0);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn hard_links_count_bytes_once() {
        let root = tmpdir("hardlink");
        fs::write(root.join("orig.bin"), vec![0u8; 65536]).unwrap();
        fs::hard_link(root.join("orig.bin"), root.join("copy.bin")).unwrap();

        let ix = run(&root);
        assert_eq!(ix.dirs[0].agg_files, 2, "both links are listed");
        // Logical size counts both; physical bytes are charged once.
        let dup = (0..ix.files.len() as u32)
            .filter(|&i| ix.files[i as usize].has(flags::IS_HARDLINK_DUP))
            .count();
        assert_eq!(dup, 1);
        assert!(ix.dirs[0].agg_alloc < 65536 * 2);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn unicode_and_emoji_names_survive() {
        let root = tmpdir("unicode");
        fs::write(root.join("日本語ファイル名.txt"), b"x").unwrap();
        fs::write(root.join("🎬 movie 🎥.mov"), b"y").unwrap();
        let ix = run(&root);
        let names: Vec<String> = (0..ix.files.len() as u32)
            .map(|i| ix.file_name(i).to_string())
            .collect();
        assert!(names.iter().any(|n| n.contains("日本語")));
        assert!(names.iter().any(|n| n.contains("🎬")));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn packages_are_flagged() {
        let root = tmpdir("package");
        fs::create_dir_all(root.join("Thing.app/Contents/MacOS")).unwrap();
        fs::write(root.join("Thing.app/Contents/MacOS/bin"), vec![0u8; 1024]).unwrap();
        let ix = run(&root);
        let app = (0..ix.dirs.len() as u32).find(|&i| ix.dir_name(i) == "Thing.app").unwrap();
        assert!(ix.dirs[app as usize].has(flags::IS_PACKAGE));
        let inner = (0..ix.dirs.len() as u32).find(|&i| ix.dir_name(i) == "Contents").unwrap();
        assert!(ix.dirs[inner as usize].has(flags::IN_PACKAGE));
        let _ = fs::remove_dir_all(&root);
    }
}
