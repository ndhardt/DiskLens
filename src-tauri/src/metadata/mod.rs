//! Where "Last Used" comes from.
//!
//! macOS records the real thing — the moment a document was last *opened* — in
//! Spotlight's `kMDItemLastUsedDate`. It is the number that answers "have I
//! actually touched this in a year?", which `mtime` cannot. When Spotlight has
//! nothing (the volume is not indexed, or the file is excluded) we fall back to
//! the filesystem access time and say so in the UI.

pub mod filesystem;
pub mod spotlight;

use serde::Serialize;

use crate::model::LastUsedSource;

/// The shape the UI reasons about for one file's timestamps.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageMetadata {
    /// Unix seconds, when known.
    pub last_used: Option<i64>,
    pub accessed: Option<i64>,
    pub modified: Option<i64>,
    pub created: Option<i64>,
    pub source: LastUsedSource,
}

impl UsageMetadata {
    pub fn resolve(path: &str) -> UsageMetadata {
        let fs = filesystem::times(path);
        match spotlight::last_used(path) {
            Some(t) => UsageMetadata {
                last_used: Some(t),
                accessed: fs.accessed,
                modified: fs.modified,
                created: fs.created,
                source: LastUsedSource::Spotlight,
            },
            None => UsageMetadata {
                last_used: fs.accessed,
                source: if fs.accessed.is_some() {
                    LastUsedSource::FileSystemAccessTime
                } else {
                    LastUsedSource::Unknown
                },
                ..fs
            },
        }
    }
}
