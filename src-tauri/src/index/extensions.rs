//! The File Types view: one row per extension, aggregated across the scan.

use serde::{Deserialize, Serialize};

use super::ScanIndex;
use crate::model::*;

#[derive(Default, Clone)]
pub struct ExtAgg {
    pub files: u64,
    pub size: u64,
    pub alloc: u64,
    pub largest: u64,
    pub largest_id: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExtSortKey {
    Extension,
    Category,
    Files,
    TotalSize,
    Allocated,
    PctDrive,
    AverageSize,
    LargestFile,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtSort {
    pub key: ExtSortKey,
    pub desc: bool,
}

impl Default for ExtSort {
    fn default() -> Self {
        ExtSort {
            key: ExtSortKey::TotalSize,
            desc: true,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtRow {
    pub ext: String,
    /// `.mov`, or `(no extension)`.
    pub label: String,
    pub category: Category,
    pub category_label: String,
    pub files: u64,
    pub size: u64,
    pub alloc: u64,
    pub pct_drive: f32,
    pub average: u64,
    pub largest: u64,
    pub largest_name: String,
}

impl ScanIndex {
    pub fn extension_table(&self, sort: ExtSort, drive_total: u64) -> Vec<ExtRow> {
        let mut aggs: Vec<ExtAgg> = vec![ExtAgg::default(); self.ext_names.len()];
        for (i, f) in self.files.iter().enumerate() {
            if f.has(flags::IS_SYNTHETIC) {
                continue; // Bundle stand-ins would double-count their contents.
            }
            let a = &mut aggs[f.ext as usize];
            a.files += 1;
            a.size += f.size;
            if !f.has(flags::IS_HARDLINK_DUP) {
                a.alloc += f.alloc;
            }
            let s = f.alloc.max(f.size);
            if s > a.largest {
                a.largest = s;
                a.largest_id = i as u32;
            }
        }

        let denom = if drive_total > 0 {
            drive_total
        } else {
            self.total_alloc().max(1)
        };

        let mut rows: Vec<ExtRow> = aggs
            .iter()
            .enumerate()
            .filter(|(_, a)| a.files > 0)
            .map(|(id, a)| {
                let ext = self.ext_names[id].clone();
                let label = if ext.is_empty() {
                    "(no extension)".to_string()
                } else {
                    format!(".{ext}")
                };
                ExtRow {
                    category: self.ext_cats[id],
                    category_label: if ext.is_empty() {
                        "Other".to_string()
                    } else {
                        category_label_for_ext(&ext).to_string()
                    },
                    files: a.files,
                    size: a.size,
                    alloc: a.alloc,
                    pct_drive: (a.alloc.max(a.size) as f64 / denom as f64 * 100.0) as f32,
                    average: a.size.checked_div(a.files).unwrap_or(0),
                    largest: a.largest,
                    largest_name: if a.files > 0 {
                        self.file_name(a.largest_id).to_string()
                    } else {
                        String::new()
                    },
                    ext,
                    label,
                }
            })
            .collect();

        rows.sort_by(|x, y| {
            use std::cmp::Ordering;
            let o = match sort.key {
                ExtSortKey::Extension => x.ext.cmp(&y.ext),
                ExtSortKey::Category => x.category_label.cmp(&y.category_label),
                ExtSortKey::Files => x.files.cmp(&y.files),
                ExtSortKey::TotalSize => x.size.cmp(&y.size),
                ExtSortKey::Allocated => x.alloc.cmp(&y.alloc),
                ExtSortKey::PctDrive => x
                    .pct_drive
                    .partial_cmp(&y.pct_drive)
                    .unwrap_or(Ordering::Equal),
                ExtSortKey::AverageSize => x.average.cmp(&y.average),
                ExtSortKey::LargestFile => x.largest.cmp(&y.largest),
            };
            let o = if sort.desc { o.reverse() } else { o };
            o.then_with(|| x.ext.cmp(&y.ext))
        });
        rows
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::NO_PARENT;

    #[test]
    fn aggregates_per_extension() {
        let mut ix = ScanIndex::new("/r".into(), "T".into());
        let n = ix.names.push("/r");
        ix.dirs.push(DirRec::new(n, NO_PARENT, 0, flags::IS_DIR));
        for (name, size) in [("a.mov", 100u64), ("b.mov", 300), ("c.zip", 50)] {
            let ext = ix.intern_ext(&extension_of(name));
            let nm = ix.names.push(name);
            ix.files.push(FileRec {
                name: nm,
                parent: 0,
                ext,
                size,
                alloc: size,
                mtime: 0,
                atime: 0,
                btime: 0,
                last_used: 0,
                flags: 0,
            });
            let id = ix.files.len() as u32 - 1;
            ix.dirs[0].files.push(id);
        }
        ix.finalize(1);
        let rows = ix.extension_table(ExtSort::default(), 1000);
        assert_eq!(rows[0].ext, "mov");
        assert_eq!(rows[0].files, 2);
        assert_eq!(rows[0].size, 400);
        assert_eq!(rows[0].average, 200);
        assert_eq!(rows[0].largest_name, "b.mov");
        assert_eq!(rows[0].category_label, "Video");
        assert_eq!(rows[1].ext, "zip");
    }
}
