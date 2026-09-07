//! Portable scanner: `readdir` plus `lstat` per entry.
//!
//! The reference implementation, and the fallback when the macOS bulk path is
//! unavailable.

use std::ffi::CString;
use std::os::unix::ffi::OsStrExt;
use std::path::Path;

use super::{RawEntry, ReadError};
use crate::model::NO_TIME;

pub struct StandardScanner;

impl super::DiskScanner for StandardScanner {
    fn name(&self) -> &'static str {
        "standard"
    }

    fn read_dir(&self, path: &Path) -> Result<Vec<RawEntry>, ReadError> {
        let iter = match std::fs::read_dir(path) {
            Ok(i) => i,
            Err(e) => return Err(map_io(&e)),
        };

        let mut out = Vec::with_capacity(64);
        for entry in iter {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let name = entry.file_name().to_string_lossy().to_string();
            let full = entry.path();
            match lstat_entry(&full, name) {
                Some(r) => out.push(r),
                None => continue,
            }
        }
        Ok(out)
    }
}

fn lstat_entry(path: &Path, name: String) -> Option<RawEntry> {
    let c = CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut st: libc::stat = unsafe { std::mem::zeroed() };
    // lstat, not stat: describe the link itself, not its target.
    if unsafe { libc::lstat(c.as_ptr(), &mut st) } != 0 {
        return None;
    }
    let mode = st.st_mode & libc::S_IFMT;
    let is_symlink = mode == libc::S_IFLNK;
    let is_dir = mode == libc::S_IFDIR;

    Some(RawEntry {
        name,
        is_dir,
        is_symlink,
        size: if is_dir { 0 } else { st.st_size.max(0) as u64 },
        // st_blocks is always 512-byte units, regardless of the fs block size.
        alloc: if is_dir {
            0
        } else {
            (st.st_blocks.max(0) as u64) * 512
        },
        mtime: nonzero(st.st_mtime),
        atime: nonzero(st.st_atime),
        btime: nonzero(st.st_birthtime),
        st_flags: st.st_flags,
        ino: st.st_ino,
        dev: st.st_dev as i64,
        nlink: st.st_nlink as u32,
    })
}

#[inline]
fn nonzero(t: i64) -> i64 {
    if t <= 0 {
        NO_TIME
    } else {
        t
    }
}

fn map_io(e: &std::io::Error) -> ReadError {
    match e.raw_os_error() {
        Some(libc::EACCES) | Some(libc::EPERM) => ReadError::Denied,
        Some(libc::ENOENT) => ReadError::NotFound,
        Some(code) => ReadError::Other(code),
        None => ReadError::Other(0),
    }
}

#[cfg(test)]
mod tests {
    use super::super::DiskScanner;
    use super::*;

    #[test]
    fn reads_a_directory() {
        let entries = StandardScanner.read_dir(Path::new("/")).unwrap();
        assert!(!entries.is_empty());
        assert!(entries.iter().any(|e| e.name == "Users" && e.is_dir));
    }

    #[test]
    fn missing_paths_report_not_found() {
        let r = StandardScanner.read_dir(Path::new("/definitely/not/here/at/all"));
        assert!(matches!(r, Err(ReadError::NotFound)));
    }
}
