//! Squarified treemap layout.
//!
//! The layout is computed in Rust and handed to Canvas as a flat array of
//! rectangles. Nothing here creates DOM nodes, and the recursion stops as soon
//! as a rectangle is too small to read, so a drive with three million files
//! still produces a few thousand rectangles.

use serde::Serialize;

use crate::index::ScanIndex;
use crate::model::*;

/// Below this many square pixels a directory is painted as one block instead of
/// being opened up.
const MIN_RECURSE_AREA: f64 = 900.0;
/// Rectangles smaller than this are dropped entirely — they would be invisible.
const MIN_EMIT_AREA: f64 = 6.0;
const MAX_DEPTH: u16 = 12;

#[derive(Clone, Copy, Debug)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl Rect {
    fn area(&self) -> f64 {
        self.w.max(0.0) * self.h.max(0.0)
    }
    fn inset(&self, by: f64) -> Rect {
        Rect {
            x: self.x + by,
            y: self.y + by,
            w: (self.w - by * 2.0).max(0.0),
            h: (self.h - by * 2.0).max(0.0),
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TreemapRect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub id: u32,
    /// True when `id` refers to a directory rather than a file.
    pub is_dir: bool,
    pub depth: u16,
    pub cat: u8,
    pub size: u64,
    pub name: String,
    /// A directory drawn as one block because it was too small to open up.
    pub collapsed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreemapLayout {
    pub rects: Vec<TreemapRect>,
    pub root_id: u32,
    pub root_name: String,
    pub root_size: u64,
    pub truncated: bool,
}

#[derive(Clone, Copy)]
struct Item {
    id: u32,
    is_dir: bool,
    value: f64,
}

/// Build the layout for `root` inside a `width` x `height` canvas.
pub fn layout(
    ix: &ScanIndex,
    root: u32,
    width: f64,
    height: f64,
    max_rects: usize,
    use_logical: bool,
) -> TreemapLayout {
    let mut out: Vec<TreemapRect> = Vec::with_capacity(max_rects.min(8192));
    let root = root.min(ix.dirs.len().saturating_sub(1) as u32);

    let root_size = if use_logical {
        ix.dirs[root as usize].agg_size
    } else {
        ix.dirs[root as usize].agg_alloc
    };

    if width > 2.0 && height > 2.0 && root_size > 0 {
        place_dir(
            ix,
            root,
            Rect {
                x: 0.0,
                y: 0.0,
                w: width,
                h: height,
            },
            0,
            use_logical,
            max_rects,
            &mut out,
        );
    }

    let truncated = out.len() >= max_rects;
    TreemapLayout {
        rects: out,
        root_id: root,
        root_name: ix.dir_name(root).to_string(),
        root_size,
        truncated,
    }
}

fn value_of_dir(ix: &ScanIndex, id: u32, logical: bool) -> u64 {
    let d = &ix.dirs[id as usize];
    if logical {
        d.agg_size
    } else {
        d.agg_alloc
    }
}

fn value_of_file(ix: &ScanIndex, id: u32, logical: bool) -> u64 {
    let f = &ix.files[id as usize];
    if logical {
        f.size
    } else {
        f.alloc
    }
}

fn place_dir(
    ix: &ScanIndex,
    dir: u32,
    rect: Rect,
    depth: u16,
    logical: bool,
    max_rects: usize,
    out: &mut Vec<TreemapRect>,
) {
    if out.len() >= max_rects || rect.w < 1.0 || rect.h < 1.0 {
        return;
    }

    let d = &ix.dirs[dir as usize];
    let mut items: Vec<Item> = Vec::with_capacity(d.children.len() + d.files.len());
    for &c in &d.children {
        let v = value_of_dir(ix, c, logical);
        if v > 0 {
            items.push(Item {
                id: c,
                is_dir: true,
                value: v as f64,
            });
        }
    }
    for &f in &d.files {
        if ix.files[f as usize].has(flags::IS_HARDLINK_DUP) && !logical {
            continue;
        }
        let v = value_of_file(ix, f, logical);
        if v > 0 {
            items.push(Item {
                id: f,
                is_dir: false,
                value: v as f64,
            });
        }
    }
    if items.is_empty() {
        return;
    }
    items.sort_unstable_by(|a, b| b.value.partial_cmp(&a.value).unwrap_or(std::cmp::Ordering::Equal));

    let total: f64 = items.iter().map(|i| i.value).sum();
    if total <= 0.0 {
        return;
    }

    let mut placed: Vec<(Item, Rect)> = Vec::with_capacity(items.len());
    squarify(&items, rect, total, &mut placed);

    for (item, r) in placed {
        if out.len() >= max_rects {
            return;
        }
        if r.area() < MIN_EMIT_AREA {
            continue;
        }
        if item.is_dir {
            let can_open = depth < MAX_DEPTH && r.area() >= MIN_RECURSE_AREA && r.w > 4.0 && r.h > 4.0;
            if can_open {
                // Draw the container itself first so nesting is visible, then
                // its contents inside a one-pixel border.
                out.push(rect_for(ix, item, r, depth, false));
                place_dir(ix, item.id, r.inset(1.0), depth + 1, logical, max_rects, out);
            } else {
                out.push(rect_for(ix, item, r, depth, true));
            }
        } else {
            out.push(rect_for(ix, item, r, depth, false));
        }
    }
}

fn rect_for(ix: &ScanIndex, item: Item, r: Rect, depth: u16, collapsed: bool) -> TreemapRect {
    let (name, cat, size) = if item.is_dir {
        let d = &ix.dirs[item.id as usize];
        let ext = extension_of(ix.names.get(d.name));
        let cat = if d.has(flags::IS_SYSTEM) {
            Category::System
        } else if ext.is_empty() {
            Category::Other
        } else {
            categorize(&ext)
        };
        (ix.dir_name(item.id).to_string(), cat, d.agg_size)
    } else {
        (
            ix.file_name(item.id).to_string(),
            ix.file_category(item.id),
            ix.files[item.id as usize].size,
        )
    };
    TreemapRect {
        x: r.x as f32,
        y: r.y as f32,
        w: r.w as f32,
        h: r.h as f32,
        id: item.id,
        is_dir: item.is_dir,
        depth,
        cat: cat as u8,
        size,
        name,
        collapsed,
    }
}

/// Bruls/Huizing/van Wijk squarified layout: fill the rectangle row by row
/// along its shorter side, extending each row while that keeps the aspect
/// ratios improving.
fn squarify(items: &[Item], rect: Rect, total: f64, out: &mut Vec<(Item, Rect)>) {
    let mut area_left = rect.area();
    let mut value_left = total;
    let mut cur = rect;
    let mut i = 0usize;

    while i < items.len() {
        if cur.w <= 0.0 || cur.h <= 0.0 || value_left <= 0.0 {
            break;
        }
        let scale = area_left / value_left;
        let short = cur.w.min(cur.h);

        let mut end = i + 1;
        let mut row_value = items[i].value;
        let mut best = worst_ratio(items[i].value, items[i].value, row_value, short, scale);

        while end < items.len() {
            let v = items[end].value;
            let new_value = row_value + v;
            let r = worst_ratio(items[i].value, v, new_value, short, scale);
            if r > best {
                break;
            }
            best = r;
            row_value = new_value;
            end += 1;
        }

        // Lay the chosen run out across the short side.
        let row_area = row_value * scale;
        let thickness = if short > 0.0 { row_area / short } else { 0.0 };
        let horizontal = cur.w <= cur.h;

        let mut offset = 0.0f64;
        for it in &items[i..end] {
            let frac = if row_value > 0.0 { it.value / row_value } else { 0.0 };
            let along = short * frac;
            let r = if horizontal {
                Rect {
                    x: cur.x + offset,
                    y: cur.y,
                    w: along,
                    h: thickness,
                }
            } else {
                Rect {
                    x: cur.x,
                    y: cur.y + offset,
                    w: thickness,
                    h: along,
                }
            };
            out.push((*it, r));
            offset += along;
        }

        if horizontal {
            cur = Rect {
                x: cur.x,
                y: cur.y + thickness,
                w: cur.w,
                h: (cur.h - thickness).max(0.0),
            };
        } else {
            cur = Rect {
                x: cur.x + thickness,
                y: cur.y,
                w: (cur.w - thickness).max(0.0),
                h: cur.h,
            };
        }
        area_left = (area_left - row_area).max(0.0);
        value_left = (value_left - row_value).max(0.0);
        i = end;
    }
}

/// Worst aspect ratio in a row holding `max`..`min`, given its total value.
fn worst_ratio(max: f64, min: f64, sum: f64, short: f64, scale: f64) -> f64 {
    let s = sum * scale;
    if s <= 0.0 || short <= 0.0 {
        return f64::INFINITY;
    }
    let side2 = short * short;
    let s2 = s * s;
    let a = (side2 * max * scale) / s2;
    let b = s2 / (side2 * min * scale);
    a.max(b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::NO_PARENT;

    fn ix_with(sizes: &[u64]) -> ScanIndex {
        let mut ix = ScanIndex::new("/r".into(), "T".into());
        let n = ix.names.push("/r");
        ix.dirs.push(DirRec::new(n, NO_PARENT, 0, flags::IS_DIR));
        for (i, &s) in sizes.iter().enumerate() {
            let name = ix.names.push(&format!("f{i}.mov"));
            let ext = ix.intern_ext("mov");
            ix.files.push(FileRec {
                name,
                parent: 0,
                ext,
                size: s,
                alloc: s,
                mtime: 1,
                atime: 1,
                btime: 1,
                last_used: 1,
                flags: 0,
            });
            let id = ix.files.len() as u32 - 1;
            ix.dirs[0].files.push(id);
        }
        ix.finalize(1_000);
        ix
    }

    #[test]
    fn rects_fill_the_canvas_without_overlapping() {
        let ix = ix_with(&[500, 300, 120, 60, 20]);
        let lay = layout(&ix, 0, 400.0, 200.0, 5000, true);
        assert_eq!(lay.rects.len(), 5);

        let covered: f64 = lay.rects.iter().map(|r| r.w as f64 * r.h as f64).sum();
        assert!(
            (covered - 400.0 * 200.0).abs() < 1.0,
            "covered {covered} of 80000"
        );

        for r in &lay.rects {
            assert!(r.x >= -0.01 && r.y >= -0.01);
            assert!(r.x + r.w <= 400.01, "{} + {}", r.x, r.w);
            assert!(r.y + r.h <= 200.01);
        }
        // Pairwise overlap check.
        for (i, a) in lay.rects.iter().enumerate() {
            for b in lay.rects.iter().skip(i + 1) {
                let overlap = (a.x + a.w).min(b.x + b.w) - a.x.max(b.x) > 0.01
                    && (a.y + a.h).min(b.y + b.h) - a.y.max(b.y) > 0.01;
                assert!(!overlap, "{} overlaps {}", a.name, b.name);
            }
        }
    }

    #[test]
    fn area_is_proportional_to_size() {
        let ix = ix_with(&[600, 300, 100]);
        let lay = layout(&ix, 0, 300.0, 300.0, 5000, true);
        let total_area = 300.0f64 * 300.0;
        let by_name = |n: &str| {
            lay.rects
                .iter()
                .find(|r| r.name == n)
                .map(|r| r.w as f64 * r.h as f64)
                .unwrap()
        };
        assert!((by_name("f0.mov") / total_area - 0.6).abs() < 0.01);
        assert!((by_name("f1.mov") / total_area - 0.3).abs() < 0.01);
        assert!((by_name("f2.mov") / total_area - 0.1).abs() < 0.01);
    }

    #[test]
    fn aspect_ratios_stay_reasonable() {
        let sizes: Vec<u64> = (1..=40).map(|i| (i * i) as u64).collect();
        let ix = ix_with(&sizes);
        let lay = layout(&ix, 0, 900.0, 240.0, 5000, true);
        let mut worst = 0.0f64;
        for r in &lay.rects {
            if r.w > 2.0 && r.h > 2.0 {
                let ar = (r.w as f64 / r.h as f64).max(r.h as f64 / r.w as f64);
                worst = worst.max(ar);
            }
        }
        // A naive slice-and-dice layout blows past 50:1 here.
        assert!(worst < 12.0, "worst aspect ratio was {worst}");
    }

    #[test]
    fn empty_tree_produces_nothing() {
        let ix = ix_with(&[]);
        let lay = layout(&ix, 0, 400.0, 200.0, 5000, true);
        assert!(lay.rects.is_empty());
    }

    #[test]
    fn rect_budget_is_respected() {
        let sizes: Vec<u64> = (1..=2000).map(|i| (2001 - i) as u64 * 1000).collect();
        let ix = ix_with(&sizes);
        let lay = layout(&ix, 0, 900.0, 240.0, 64, true);
        assert!(lay.rects.len() <= 64);
        assert!(lay.truncated);
    }
}
