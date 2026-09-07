//! Mounted volumes: what we can scan, how big it is, and where one volume ends
//! and another begins.

use std::collections::HashSet;
use std::ffi::{CStr, CString};
use std::path::Path;

use serde::Serialize;

#[derive(Debug, Clone)]
pub struct Mount {
    pub mount_point: String,
    /// e.g. `/dev/disk3s5`
    pub from: String,
    pub fs_type: String,
    pub dev: i64,
    pub total: u64,
    pub free: u64,
    pub available: u64,
    pub read_only: bool,
}

impl Mount {
    /// `/dev/disk3s5` and `/dev/disk3s1s1` share the container `disk3`: on a
    /// modern Mac the System and Data volumes are two members of one group and
    /// must be walked together.
    pub fn container(&self) -> Option<String> {
        // "disk3s1s1" -> "disk3": the name is a word followed by the container
        // number, then one slice suffix per nesting level.
        let dev = self.from.strip_prefix("/dev/")?;
        let b = dev.as_bytes();
        let mut end = 0;
        while end < b.len() && b[end].is_ascii_alphabetic() {
            end += 1;
        }
        let word_end = end;
        while end < b.len() && b[end].is_ascii_digit() {
            end += 1;
        }
        if end == word_end {
            return None;
        }
        Some(dev[..end].to_string())
    }

    pub fn is_local_storage(&self) -> bool {
        matches!(self.fs_type.as_str(), "apfs" | "hfs" | "exfat" | "msdos" | "ntfs" | "ufsd_NTFS")
    }
}

#[derive(Default)]
pub struct MountTable {
    pub mounts: Vec<Mount>,
    points: HashSet<String>,
}

impl MountTable {
    pub fn load() -> MountTable {
        let mut mounts = Vec::new();
        unsafe {
            let mut buf: *mut libc::statfs = std::ptr::null_mut();
            let n = libc::getmntinfo(&mut buf, libc::MNT_NOWAIT);
            if n > 0 && !buf.is_null() {
                for i in 0..n as isize {
                    let s = &*buf.offset(i);
                    mounts.push(Mount {
                        mount_point: cstr(&s.f_mntonname),
                        from: cstr(&s.f_mntfromname),
                        fs_type: cstr(&s.f_fstypename),
                        dev: 0,
                        total: s.f_blocks.saturating_mul(s.f_bsize as u64),
                        free: s.f_bfree.saturating_mul(s.f_bsize as u64),
                        available: s.f_bavail.saturating_mul(s.f_bsize as u64),
                        read_only: s.f_flags & (libc::MNT_RDONLY as u32) != 0,
                    });
                }
            }
        }
        // statfs does not carry st_dev, so take it from the mount point itself.
        for m in mounts.iter_mut() {
            if let Some((dev, _)) = stat_dev_ino(&m.mount_point) {
                m.dev = dev;
            }
        }
        let points = mounts.iter().map(|m| m.mount_point.clone()).collect();
        MountTable { mounts, points }
    }

    pub fn is_mount_point(&self, path: &str) -> bool {
        self.points.contains(path)
    }

    pub fn find(&self, path: &str) -> Option<&Mount> {
        // Longest matching mount point wins.
        self.mounts
            .iter()
            .filter(|m| path == m.mount_point || path.starts_with(&join(&m.mount_point)))
            .max_by_key(|m| m.mount_point.len())
    }

    /// Device ids the walker is allowed to descend onto.
    ///
    /// Empty means "no restriction". Otherwise it is the scan root's own volume
    /// plus its siblings in the same APFS container — which is what makes
    /// `/Users` (Data volume, firmlinked under a read-only System volume)
    /// reachable while an unrelated external disk under `/Volumes` is not.
    pub fn devices_for_scan(&self, root: &Path, cross_volumes: bool) -> HashSet<i64> {
        if cross_volumes {
            return HashSet::new();
        }
        let root_str = root.to_string_lossy().to_string();
        let Some(root_mount) = self.find(&root_str) else {
            return HashSet::new();
        };
        let container = root_mount.container();
        let mut devs = HashSet::new();
        devs.insert(root_mount.dev);
        if let Some(c) = container {
            for m in &self.mounts {
                if m.container().as_deref() == Some(c.as_str()) && m.is_local_storage() {
                    devs.insert(m.dev);
                }
            }
        }
        devs
    }
}

/// A volume as offered in the toolbar picker.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VolumeInfo {
    pub name: String,
    pub path: String,
    pub fs_type: String,
    pub total: u64,
    pub free: u64,
    pub used: u64,
    pub is_root: bool,
    pub read_only: bool,
    pub removable: bool,
}

pub fn list_volumes() -> Vec<VolumeInfo> {
    let table = MountTable::load();
    let mut out: Vec<VolumeInfo> = Vec::new();

    for m in &table.mounts {
        if !m.is_local_storage() {
            continue;
        }
        let is_root = m.mount_point == "/";
        // The System and Data volumes of the boot group are one disk to a user;
        // show only "/" for them.
        if !is_root && m.mount_point.starts_with("/System/Volumes") {
            continue;
        }
        if !is_root && !m.mount_point.starts_with("/Volumes/") {
            continue;
        }
        // Skip the sealed helper volumes Apple mounts under /Volumes.
        if matches!(
            m.mount_point.as_str(),
            "/Volumes/Recovery" | "/Volumes/Preboot" | "/Volumes/VM" | "/Volumes/Update"
        ) {
            continue;
        }

        let name = if is_root {
            boot_volume_name()
        } else {
            m.mount_point
                .rsplit('/')
                .next()
                .unwrap_or(&m.mount_point)
                .to_string()
        };

        // On an APFS boot group, "/" reports the read-only System volume's
        // numbers. The user-visible capacity is the shared container, which the
        // Data volume reports.
        let (total, free) = if is_root {
            boot_group_capacity(&table).unwrap_or((m.total, m.available))
        } else {
            (m.total, m.available)
        };

        out.push(VolumeInfo {
            name,
            path: m.mount_point.clone(),
            fs_type: m.fs_type.to_uppercase(),
            total,
            free,
            used: total.saturating_sub(free),
            is_root,
            read_only: m.read_only,
            removable: !is_root,
        });
    }

    out.sort_by(|a, b| b.is_root.cmp(&a.is_root).then_with(|| a.name.cmp(&b.name)));
    if out.is_empty() {
        out.push(VolumeInfo {
            name: boot_volume_name(),
            path: "/".into(),
            fs_type: "APFS".into(),
            total: 0,
            free: 0,
            used: 0,
            is_root: true,
            read_only: false,
            removable: false,
        });
    }
    out
}

/// Capacity of the whole boot APFS container, as seen through its Data volume.
fn boot_group_capacity(table: &MountTable) -> Option<(u64, u64)> {
    let data = table
        .mounts
        .iter()
        .find(|m| m.mount_point == "/System/Volumes/Data")?;
    Some((data.total, data.available))
}

pub fn boot_volume_name() -> String {
    // /Volumes holds a symlink named after the boot volume pointing at "/".
    if let Ok(entries) = std::fs::read_dir("/Volumes") {
        for e in entries.flatten() {
            let p = e.path();
            if let Ok(md) = std::fs::symlink_metadata(&p) {
                if md.file_type().is_symlink() {
                    if let Ok(target) = std::fs::read_link(&p) {
                        if target == Path::new("/") {
                            return e.file_name().to_string_lossy().to_string();
                        }
                    }
                }
            }
        }
    }
    "Macintosh HD".to_string()
}

pub fn statfs_for(path: &str) -> Option<(u64, u64)> {
    let c = CString::new(path).ok()?;
    let mut s: libc::statfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statfs(c.as_ptr(), &mut s) } != 0 {
        return None;
    }
    Some((
        s.f_blocks.saturating_mul(s.f_bsize as u64),
        s.f_bavail.saturating_mul(s.f_bsize as u64),
    ))
}

fn stat_dev_ino(path: &str) -> Option<(i64, u64)> {
    use std::os::unix::fs::MetadataExt;
    let md = std::fs::metadata(path).ok()?;
    Some((md.dev() as i64, md.ino()))
}

fn join(p: &str) -> String {
    if p.ends_with('/') {
        p.to_string()
    } else {
        format!("{p}/")
    }
}

fn cstr(buf: &[libc::c_char]) -> String {
    unsafe { CStr::from_ptr(buf.as_ptr()) }
        .to_string_lossy()
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mount_table_sees_the_root() {
        let t = MountTable::load();
        assert!(t.is_mount_point("/"));
        let root = t.find("/Users").expect("a mount covers /Users");
        assert!(!root.fs_type.is_empty());
    }

    #[test]
    fn container_groups_system_and_data() {
        let a = Mount {
            mount_point: "/".into(),
            from: "/dev/disk3s1s1".into(),
            fs_type: "apfs".into(),
            dev: 1,
            total: 0,
            free: 0,
            available: 0,
            read_only: true,
        };
        let b = Mount {
            from: "/dev/disk3s5".into(),
            ..a.clone()
        };
        let other = Mount {
            from: "/dev/disk5s2".into(),
            ..a.clone()
        };
        assert_eq!(a.container(), Some("disk3".into()));
        assert_eq!(b.container(), Some("disk3".into()));
        assert_eq!(other.container(), Some("disk5".into()));
        assert_eq!(a.container(), b.container());
        assert_ne!(a.container(), other.container());

        let two_digit = Mount {
            from: "/dev/disk10s3".into(),
            ..a.clone()
        };
        assert_eq!(two_digit.container(), Some("disk10".into()));

        let network = Mount {
            from: "//guest@nas/share".into(),
            ..a.clone()
        };
        assert_eq!(network.container(), None);
    }

    #[test]
    fn scanning_root_reaches_the_data_volume() {
        let t = MountTable::load();
        let devs = t.devices_for_scan(Path::new("/"), false);
        // The Data volume must be reachable, or /Users would come out empty.
        if let Some(data) = t.mounts.iter().find(|m| m.mount_point == "/System/Volumes/Data") {
            assert!(devs.contains(&data.dev), "data volume must be scannable");
        }
    }

    #[test]
    fn volumes_include_the_boot_disk() {
        let v = list_volumes();
        assert!(v.iter().any(|x| x.is_root && x.path == "/"));
        let root = v.iter().find(|x| x.is_root).unwrap();
        assert!(root.total > 0, "boot volume reports a capacity");
        assert!(root.used <= root.total);
    }
}
