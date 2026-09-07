//! Bulk scanner built on `getattrlistbulk(2)`.
//!
//! The standard scanner costs one `lstat` per entry. This one gets a whole
//! directory of names and metadata in a single syscall, which is where the
//! speedup on APFS comes from.
//!
//! The attribute buffer is packed with no alignment padding: each attribute
//! follows the previous byte-for-byte, in ascending bit order within its
//! group, with `ATTR_CMN_RETURNED_ATTRS` first. Which groups appear varies per
//! entry (a directory carries no `fileattr` block), so the buffer must be
//! walked with a cursor rather than cast to a struct.

#![cfg(target_os = "macos")]

use std::ffi::CString;
use std::os::unix::ffi::OsStrExt;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use super::{RawEntry, ReadError};
use crate::model::NO_TIME;

// `vtype` values from <sys/vnode.h>.
const VDIR: u32 = 2;
const VLNK: u32 = 5;

const ATTR_CMN_ERROR: libc::attrgroup_t = 0x2000_0000;

const BUF_SIZE: usize = 256 * 1024;

/// Cleared if the self-check fails, so a mismatch degrades to the portable
/// scanner instead of reporting wrong numbers.
static USABLE: AtomicBool = AtomicBool::new(true);

pub fn available() -> bool {
    USABLE.load(Ordering::Relaxed)
}

pub fn disable() {
    USABLE.store(false, Ordering::Relaxed);
}

pub struct MacOSFastScanner;

impl MacOSFastScanner {
    pub fn new() -> Self {
        MacOSFastScanner
    }
}

impl Default for MacOSFastScanner {
    fn default() -> Self {
        Self::new()
    }
}

thread_local! {
    static BUF: std::cell::RefCell<Vec<u8>> = std::cell::RefCell::new(vec![0u8; BUF_SIZE]);
}

fn attr_list() -> libc::attrlist {
    let mut al: libc::attrlist = unsafe { std::mem::zeroed() };
    al.bitmapcount = libc::ATTR_BIT_MAP_COUNT;
    al.commonattr = libc::ATTR_CMN_RETURNED_ATTRS
        | ATTR_CMN_ERROR
        | libc::ATTR_CMN_NAME
        | libc::ATTR_CMN_DEVID
        | libc::ATTR_CMN_OBJTYPE
        | libc::ATTR_CMN_CRTIME
        | libc::ATTR_CMN_MODTIME
        | libc::ATTR_CMN_ACCTIME
        | libc::ATTR_CMN_FLAGS
        | libc::ATTR_CMN_FILEID;
    al.fileattr =
        libc::ATTR_FILE_LINKCOUNT | libc::ATTR_FILE_TOTALSIZE | libc::ATTR_FILE_ALLOCSIZE;
    al
}

/// Byte cursor over one packed entry.
struct Cursor<'a> {
    b: &'a [u8],
    at: usize,
}

impl<'a> Cursor<'a> {
    #[inline]
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let s = self.b.get(self.at..self.at + n)?;
        self.at += n;
        Some(s)
    }
    #[inline]
    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_ne_bytes(self.take(4)?.try_into().ok()?))
    }
    #[inline]
    fn i32(&mut self) -> Option<i32> {
        Some(i32::from_ne_bytes(self.take(4)?.try_into().ok()?))
    }
    #[inline]
    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_ne_bytes(self.take(8)?.try_into().ok()?))
    }
    #[inline]
    fn i64(&mut self) -> Option<i64> {
        Some(i64::from_ne_bytes(self.take(8)?.try_into().ok()?))
    }
    /// `struct timespec`: two 64-bit words on arm64 and x86_64.
    #[inline]
    fn timespec(&mut self) -> Option<i64> {
        let secs = self.i64()?;
        let _nsecs = self.i64()?;
        Some(if secs <= 0 { NO_TIME } else { secs })
    }
}

impl super::DiskScanner for MacOSFastScanner {
    fn name(&self) -> &'static str {
        "macos-getattrlistbulk"
    }

    fn read_dir(&self, path: &Path) -> Result<Vec<RawEntry>, ReadError> {
        if !available() {
            return super::standard::StandardScanner.read_dir(path);
        }

        let c = match CString::new(path.as_os_str().as_bytes()) {
            Ok(c) => c,
            Err(_) => return Err(ReadError::Other(libc::EINVAL)),
        };
        let fd = unsafe { libc::open(c.as_ptr(), libc::O_RDONLY | libc::O_CLOEXEC) };
        if fd < 0 {
            return Err(errno_to_read_error());
        }
        let _guard = FdGuard(fd);

        let mut al = attr_list();
        let mut out: Vec<RawEntry> = Vec::with_capacity(64);

        BUF.with(|cell| -> Result<(), ReadError> {
            let mut buf = cell.borrow_mut();
            loop {
                let n = unsafe {
                    libc::getattrlistbulk(
                        fd,
                        &mut al as *mut _ as *mut libc::c_void,
                        buf.as_mut_ptr() as *mut libc::c_void,
                        buf.len(),
                        0,
                    )
                };
                if n < 0 {
                    return Err(errno_to_read_error());
                }
                if n == 0 {
                    return Ok(());
                }

                let mut off = 0usize;
                for _ in 0..n {
                    if off + 4 > buf.len() {
                        break;
                    }
                    let len = u32::from_ne_bytes(buf[off..off + 4].try_into().unwrap()) as usize;
                    if len < 4 || off + len > buf.len() {
                        break;
                    }
                    if let Some(e) = parse_entry(&buf[off..off + len]) {
                        out.push(e);
                    }
                    off += len;
                }
            }
        })?;

        Ok(out)
    }
}

fn parse_entry(entry: &[u8]) -> Option<RawEntry> {
    let mut c = Cursor { b: entry, at: 4 };

    let returned_common = c.u32()?;
    let _returned_vol = c.u32()?;
    let _returned_dir = c.u32()?;
    let returned_file = c.u32()?;
    let _returned_fork = c.u32()?;

    // ATTR_CMN_ERROR is packed right after the returned set, out of bit order,
    // and is non-zero when the kernel could not describe this entry.
    if returned_common & ATTR_CMN_ERROR != 0 {
        let err = c.u32()?;
        if err != 0 {
            return None;
        }
    }

    if returned_common & libc::ATTR_CMN_NAME == 0 {
        return None;
    }
    // attrreference_t offsets are relative to the field's own address.
    let name_field_at = c.at;
    let data_off = c.i32()?;
    let data_len = c.u32()? as usize;
    let start = (name_field_at as i64 + data_off as i64) as usize;
    let end = start.checked_add(data_len)?;
    let raw = entry.get(start..end)?;
    // The kernel counts the terminating NUL in attr_length.
    let raw = raw.strip_suffix(&[0]).unwrap_or(raw);
    let name = String::from_utf8_lossy(raw).into_owned();
    if name.is_empty() || name == "." || name == ".." {
        return None;
    }

    let dev = if returned_common & libc::ATTR_CMN_DEVID != 0 {
        c.i32()? as i64
    } else {
        0
    };
    let objtype = if returned_common & libc::ATTR_CMN_OBJTYPE != 0 {
        c.u32()?
    } else {
        return None;
    };
    let btime = if returned_common & libc::ATTR_CMN_CRTIME != 0 {
        c.timespec()?
    } else {
        NO_TIME
    };
    let mtime = if returned_common & libc::ATTR_CMN_MODTIME != 0 {
        c.timespec()?
    } else {
        NO_TIME
    };
    let atime = if returned_common & libc::ATTR_CMN_ACCTIME != 0 {
        c.timespec()?
    } else {
        NO_TIME
    };
    let st_flags = if returned_common & libc::ATTR_CMN_FLAGS != 0 {
        c.u32()?
    } else {
        0
    };
    let ino = if returned_common & libc::ATTR_CMN_FILEID != 0 {
        c.u64()?
    } else {
        0
    };

    // Only files carry a `fileattr` block, and nothing reads nlink for a
    // directory.
    let nlink = if returned_file & libc::ATTR_FILE_LINKCOUNT != 0 {
        c.u32()?
    } else {
        1
    };
    let size = if returned_file & libc::ATTR_FILE_TOTALSIZE != 0 {
        c.i64()?.max(0) as u64
    } else {
        0
    };
    let alloc = if returned_file & libc::ATTR_FILE_ALLOCSIZE != 0 {
        c.i64()?.max(0) as u64
    } else {
        0
    };

    let is_dir = objtype == VDIR;
    let is_symlink = objtype == VLNK;

    Some(RawEntry {
        name,
        is_dir,
        is_symlink,
        size: if is_dir { 0 } else { size },
        alloc: if is_dir { 0 } else { alloc },
        mtime,
        atime,
        btime,
        st_flags,
        ino,
        dev,
        nlink,
    })
}

struct FdGuard(libc::c_int);
impl Drop for FdGuard {
    fn drop(&mut self) {
        unsafe { libc::close(self.0) };
    }
}

fn errno_to_read_error() -> ReadError {
    let e = std::io::Error::last_os_error();
    match e.raw_os_error() {
        Some(libc::EACCES) | Some(libc::EPERM) => ReadError::Denied,
        Some(libc::ENOENT) => ReadError::NotFound,
        Some(code) => ReadError::Other(code),
        None => ReadError::Other(0),
    }
}

/// Cross-check the bulk scanner against `lstat` on a directory of our own.
///
/// Run once at startup. If the packed layout stops matching what this parser
/// expects, the fast path disables itself.
pub fn self_check() -> bool {
    use super::DiskScanner;

    let dir = std::env::temp_dir().join(format!(".disklens-selfcheck-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    if std::fs::create_dir_all(dir.join("subdir")).is_err() {
        return true; // Cannot verify; leave the fast path as it was.
    }
    let payload = vec![0u8; 40_000];
    if std::fs::write(dir.join("probe.bin"), &payload).is_err() {
        let _ = std::fs::remove_dir_all(&dir);
        return true;
    }

    let fast = MacOSFastScanner::new().read_dir(&dir);
    let slow = super::standard::StandardScanner.read_dir(&dir);
    let _ = std::fs::remove_dir_all(&dir);

    let (mut fast, mut slow) = match (fast, slow) {
        (Ok(f), Ok(s)) => (f, s),
        _ => return true,
    };
    fast.sort_by(|a, b| a.name.cmp(&b.name));
    slow.sort_by(|a, b| a.name.cmp(&b.name));

    let ok = fast.len() == slow.len()
        && fast.iter().zip(slow.iter()).all(|(f, s)| {
            f.name == s.name
                && f.is_dir == s.is_dir
                && f.ino == s.ino
                && f.size == s.size
                && f.alloc == s.alloc
                // Directory link counts differ between the two sources; only
                // the file value is used.
                && (f.is_dir || f.nlink == s.nlink)
        });
    if !ok {
        disable();
    }
    ok
}

#[cfg(test)]
mod tests {
    use super::super::DiskScanner;
    use super::*;
    use std::fs;

    #[test]
    fn bulk_scanner_agrees_with_lstat() {
        let dir = std::env::temp_dir().join(format!("disklens-bulk-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("child")).unwrap();
        fs::write(dir.join("a.bin"), vec![0u8; 5000]).unwrap();
        fs::write(dir.join("b.mov"), vec![0u8; 300_000]).unwrap();
        fs::write(dir.join("日本語 🎬.txt"), b"hello").unwrap();
        fs::hard_link(dir.join("a.bin"), dir.join("a-link.bin")).unwrap();
        std::os::unix::fs::symlink(dir.join("b.mov"), dir.join("s.mov")).unwrap();

        assert!(
            available(),
            "the fast path must still be enabled, or this test silently \
             compares the fallback scanner against itself"
        );
        let mut fast = MacOSFastScanner::new().read_dir(&dir).unwrap();
        let mut slow = super::super::standard::StandardScanner.read_dir(&dir).unwrap();
        fast.sort_by(|a, b| a.name.cmp(&b.name));
        slow.sort_by(|a, b| a.name.cmp(&b.name));

        assert_eq!(fast.len(), slow.len(), "entry count");
        for (f, s) in fast.iter().zip(slow.iter()) {
            assert_eq!(f.name, s.name);
            assert_eq!(f.is_dir, s.is_dir, "{}", f.name);
            assert_eq!(f.is_symlink, s.is_symlink, "{}", f.name);
            assert_eq!(f.size, s.size, "size of {}", f.name);
            assert_eq!(f.alloc, s.alloc, "alloc of {}", f.name);
            assert_eq!(f.ino, s.ino, "ino of {}", f.name);
            if !f.is_dir {
                assert_eq!(f.nlink, s.nlink, "nlink of {}", f.name);
            }
            assert_eq!(f.mtime, s.mtime, "mtime of {}", f.name);
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn self_check_passes_on_this_machine() {
        assert!(self_check());
        assert!(available());
    }
}
