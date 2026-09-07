//! Timestamps from `lstat`. Always available, weaker than Spotlight for
//! answering when a file was last used.

use super::UsageMetadata;
use crate::model::LastUsedSource;

pub fn times(path: &str) -> UsageMetadata {
    use std::os::unix::fs::MetadataExt;
    let Ok(md) = std::fs::symlink_metadata(path) else {
        return UsageMetadata {
            last_used: None,
            accessed: None,
            modified: None,
            created: None,
            source: LastUsedSource::Unknown,
        };
    };
    let pos = |t: i64| if t > 0 { Some(t) } else { None };
    UsageMetadata {
        last_used: pos(md.atime()),
        accessed: pos(md.atime()),
        modified: pos(md.mtime()),
        created: pos(md.created().ok().and_then(sys_secs).unwrap_or(0)),
        source: if md.atime() > 0 {
            LastUsedSource::FileSystemAccessTime
        } else {
            LastUsedSource::Unknown
        },
    }
}

fn sys_secs(t: std::time::SystemTime) -> Option<i64> {
    t.duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_times_for_a_real_file() {
        let p = std::env::temp_dir().join(format!("dl-fs-{}.txt", std::process::id()));
        std::fs::write(&p, b"x").unwrap();
        let t = times(&p.to_string_lossy());
        assert!(t.modified.is_some());
        assert!(t.accessed.is_some());
        assert_eq!(t.source, LastUsedSource::FileSystemAccessTime);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn missing_file_is_unknown() {
        let t = times("/no/such/path/at/all");
        assert!(t.modified.is_none());
        assert_eq!(t.source, LastUsedSource::Unknown);
    }
}
