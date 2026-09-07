//! Moving items to the Trash.
//!
//! Deletion is always `NSFileManager -trashItemAtURL:`. Nothing here calls
//! `unlink`, so a mistake stays recoverable from the Finder.

use serde::Serialize;

use crate::model::is_immutable_path;

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TrashOutcome {
    pub path: String,
    pub ok: bool,
    pub error: Option<String>,
    pub bytes: u64,
}

#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct TrashReport {
    pub moved: u32,
    pub failed: u32,
    pub bytes_freed: u64,
    pub results: Vec<TrashOutcome>,
}

/// Move one path to the Trash.
#[cfg(target_os = "macos")]
pub fn move_to_trash(path: &str) -> Result<(), String> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};

    if is_immutable_path(path) {
        return Err(format!(
            "{path} belongs to the operating system and cannot be moved to the Trash"
        ));
    }
    if !std::path::Path::new(path).exists() {
        return Err(format!("{path} no longer exists"));
    }

    let ns_path = NSString::from_str(path);
    let url = NSURL::fileURLWithPath(&ns_path);
    let fm = NSFileManager::defaultManager();
    match fm.trashItemAtURL_resultingItemURL_error(&url, None) {
        Ok(()) => Ok(()),
        Err(err) => Err(err.localizedDescription().to_string()),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn move_to_trash(path: &str) -> Result<(), String> {
    Err(format!("Trash is only implemented on macOS ({path})"))
}

/// Size on disk, used to report how much a delete freed.
pub fn size_on_disk(path: &str) -> u64 {
    use std::os::unix::fs::MetadataExt;
    let Ok(md) = std::fs::symlink_metadata(path) else {
        return 0;
    };
    if md.is_dir() {
        let mut total = 0u64;
        let mut stack = vec![std::path::PathBuf::from(path)];
        // Bounded, so a call on a huge tree cannot stall the caller.
        let mut budget = 200_000u32;
        while let Some(p) = stack.pop() {
            let Ok(rd) = std::fs::read_dir(&p) else { continue };
            for e in rd.flatten() {
                if budget == 0 {
                    return total;
                }
                budget -= 1;
                let Ok(m) = e.metadata() else { continue };
                if m.is_dir() {
                    stack.push(e.path());
                } else {
                    total += m.blocks() * 512;
                }
            }
        }
        total
    } else {
        md.blocks() * 512
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_paths_are_refused() {
        let e = move_to_trash("/System/Library/CoreServices").unwrap_err();
        assert!(e.contains("operating system"), "{e}");
        let e = move_to_trash("/usr/bin/env").unwrap_err();
        assert!(e.contains("operating system"), "{e}");
    }

    #[test]
    fn missing_paths_are_refused_before_touching_the_filesystem() {
        let e = move_to_trash("/tmp/disklens-does-not-exist-xyz").unwrap_err();
        assert!(e.contains("no longer exists"), "{e}");
    }

    #[test]
    fn round_trip_through_the_trash() {
        let p = std::env::temp_dir().join(format!("disklens-trash-{}.bin", std::process::id()));
        std::fs::write(&p, vec![0u8; 4096]).unwrap();
        let path = p.to_string_lossy().to_string();
        assert!(size_on_disk(&path) >= 4096);

        move_to_trash(&path).expect("trashItemAtURL should succeed for a temp file");
        assert!(!p.exists(), "file left the original location");
    }
}
