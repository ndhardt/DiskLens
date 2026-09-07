//! Full pipeline over a real directory tree: scan, aggregate, rank, search,
//! lay out. This is what the Tauri commands call underneath, so a green run
//! here means the app's data path works, not just its parts.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use disklens_lib::index::directories::{TreeSort, TreeSortKey};
use disklens_lib::index::extensions::ExtSort;
use disklens_lib::index::files::{self, HogMode, QuickFilter, SortKey, SortSpec};
use disklens_lib::index::ScanIndex;
use disklens_lib::model::*;
use disklens_lib::query::Query;
use disklens_lib::scanner::{self, ScanOptions};
use disklens_lib::volumes::MountTable;

const NOW: i64 = 1_790_000_000;
const DAY: i64 = 86_400;
const MB: usize = 1024 * 1024;

struct Fixture {
    root: std::path::PathBuf,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

/// A tree that exercises the awkward cases: long names, Japanese, emoji, an
/// empty folder, an app bundle, a hard link and a symlink.
///
/// Each call gets its own directory — the tests run in parallel and each one
/// deletes its tree on drop.
fn build_fixture() -> Fixture {
    use std::sync::atomic::{AtomicU32, Ordering};
    static SEQ: AtomicU32 = AtomicU32::new(0);
    let root = std::env::temp_dir().join(format!(
        "disklens-e2e-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = std::fs::remove_dir_all(&root);

    let mk = |p: &std::path::Path| std::fs::create_dir_all(p).unwrap();
    let write = |p: std::path::PathBuf, mb: usize| {
        std::fs::write(&p, vec![0u8; mb * MB]).unwrap();
        p
    };

    mk(&root.join("Movies"));
    mk(&root.join("Models"));
    mk(&root.join("Empty Folder"));
    mk(&root.join("空のフォルダ"));
    mk(&root.join("Thing.app/Contents/MacOS"));

    write(root.join("Movies/final_prores.mov"), 12);
    write(root.join("Movies/日本語のファイル名.mov"), 6);
    write(root.join("Movies/🎬 party 🎂.mov"), 3);
    write(
        root.join(
            "Movies/a-really-quite-unreasonably-long-export-filename-that-somebody-typed-v7-final.mov",
        ),
        2,
    );
    write(root.join("Models/big.safetensors"), 20);
    write(root.join("Models/small.safetensors"), 1);
    let orig = write(root.join("archive.zip"), 8);
    std::fs::hard_link(&orig, root.join("archive-link.zip")).unwrap();
    std::os::unix::fs::symlink(&orig, root.join("link-to-archive.zip")).unwrap();
    write(root.join("Thing.app/Contents/MacOS/binary"), 5);

    Fixture { root }
}

fn scan(root: &std::path::Path, fast: bool) -> ScanIndex {
    let opts = ScanOptions {
        root: root.to_path_buf(),
        volume_name: "Test".into(),
        fast,
        ..Default::default()
    };
    let scanner = scanner::make_scanner(&opts);
    let mut ix = ScanIndex::new(root.to_string_lossy().to_string(), "Test".into());
    let cancel = Arc::new(AtomicBool::new(false));
    let mounts = MountTable::load();
    scanner::walk(&opts, scanner.as_ref(), &mut ix, &cancel, &mounts, &mut |_, _| {});
    ix.finalize(NOW);
    ix
}

fn file_named(ix: &ScanIndex, name: &str) -> Option<u32> {
    (0..ix.files.len() as u32).find(|&i| ix.file_name(i) == name)
}

#[test]
fn scan_aggregate_rank_search_and_lay_out() {
    let fx = build_fixture();
    let ix = scan(&fx.root, true);

    // --- totals -----------------------------------------------------------
    let root = &ix.dirs[0];
    // 12 + 6 + 3 + 2 + 20 + 1 + 8 + 8 (hard link, logical) + 5 = 65 MB, plus a
    // few bytes of symlink target path.
    assert!(
        root.agg_size >= 65 * MB as u64 && root.agg_size < 66 * MB as u64,
        "logical total was {}",
        root.agg_size
    );
    // The hard link's bytes are charged once, so allocated is 8 MB lower.
    assert!(
        root.agg_alloc < root.agg_size,
        "hard link should not be charged twice: {} vs {}",
        root.agg_alloc,
        root.agg_size
    );
    // 4 in Movies, 2 in Models, 3 at the root (archive + hard link + symlink),
    // 1 inside the bundle.
    assert_eq!(root.agg_files, 10);

    // --- the awkward names survive ---------------------------------------
    assert!(file_named(&ix, "日本語のファイル名.mov").is_some());
    assert!(file_named(&ix, "🎬 party 🎂.mov").is_some());
    assert!(ix
        .files
        .iter()
        .any(|f| ix.names.get(f.name).len() > 70));

    // --- empty folders are present with zero size ------------------------
    let empty = (0..ix.dirs.len() as u32)
        .find(|&i| ix.dir_name(i) == "空のフォルダ")
        .expect("unicode folder name");
    assert_eq!(ix.dirs[empty as usize].agg_size, 0);
    assert_eq!(ix.dirs[empty as usize].agg_files, 0);

    // --- bundles roll up into one item -----------------------------------
    let app_dir = (0..ix.dirs.len() as u32)
        .find(|&i| ix.dir_name(i) == "Thing.app")
        .expect("bundle directory");
    let synth = ix.synthetic_of_dir.get(&app_dir).copied().expect("bundle stand-in row");
    assert!(ix.files[synth as usize].has(flags::IS_SYNTHETIC));
    assert_eq!(ix.files[synth as usize].size, ix.dirs[app_dir as usize].agg_size);
    let grouped = ix.items(true);
    assert!(grouped.contains(&synth), "grouped view lists the bundle");
    assert!(
        !grouped.contains(&file_named(&ix, "binary").unwrap()),
        "grouped view hides the file inside the bundle"
    );
    assert!(
        ix.items(false).contains(&file_named(&ix, "binary").unwrap()),
        "ungrouped view lists it"
    );

    // --- tree: hierarchy preserved, biggest first ------------------------
    let mut ix = ix;
    ix.tree_sort = TreeSort {
        key: TreeSortKey::Size,
        desc: true,
    };
    ix.expand_to_depth(2);
    let rows: Vec<String> = ix
        .tree_rows()
        .to_vec()
        .iter()
        .map(|&id| ix.dir_name(id).to_string())
        .collect();
    let pos = |n: &str| rows.iter().position(|r| r == n).unwrap();
    assert_eq!(pos(&fx.root.to_string_lossy()), 0, "root first");
    // Movies (23 MB) outranks Models (21 MB) at the same level.
    assert!(pos("Movies") < pos("Models"));
    // ...and Movies' own children stay nested under it rather than being
    // hoisted next to it.
    assert!(pos("Contents") > pos("Thing.app"));

    // --- space hogs -------------------------------------------------------
    let biggest = files::select_files(
        &ix,
        ix.items(true),
        &Query::default(),
        QuickFilter::All,
        files::hog_sort_spec(HogMode::LargestFirst),
        NOW,
        0,
    );
    assert_eq!(ix.file_name(biggest[0]), "big.safetensors");

    // --- search -----------------------------------------------------------
    let q = Query::parse("*.mov");
    let movs = files::select_files(
        &ix,
        ix.items(true),
        &q,
        QuickFilter::All,
        SortSpec::default(),
        NOW,
        0,
    );
    assert_eq!(movs.len(), 4, "four .mov files");

    let q = Query::parse("size:>10MB ext:safetensors");
    let hits = files::select_files(&ix, ix.items(true), &q, QuickFilter::All, SortSpec::default(), NOW, 0);
    assert_eq!(hits.len(), 1);
    assert_eq!(ix.file_name(hits[0]), "big.safetensors");

    // --- extension table --------------------------------------------------
    let table = ix.extension_table(ExtSort::default(), root_total(&ix));
    let mov = table.iter().find(|r| r.ext == "mov").expect(".mov row");
    assert_eq!(mov.files, 4);
    assert_eq!(mov.category_label, "Video");
    let st = table.iter().find(|r| r.ext == "safetensors").unwrap();
    assert_eq!(st.category_label, "AI Model");
    assert_eq!(st.largest_name, "big.safetensors");
    // The bundle stand-in must not double-count its contents.
    let total_listed: u64 = table.iter().map(|r| r.size).sum();
    assert_eq!(total_listed, ix.dirs[0].agg_size);

    // --- treemap ----------------------------------------------------------
    let lay = disklens_lib::treemap::layout(&ix, 0, 1400.0, 236.0, 8000, false);
    assert!(!lay.rects.is_empty());
    for r in &lay.rects {
        assert!(r.x >= -0.01 && r.y >= -0.01);
        assert!(r.x + r.w <= 1400.01);
        assert!(r.y + r.h <= 236.01);
    }
    assert!(
        lay.rects.iter().any(|r| r.name == "big.safetensors"),
        "the biggest file has a rectangle"
    );
}

fn root_total(ix: &ScanIndex) -> u64 {
    ix.dirs[0].agg_alloc.max(1)
}

#[test]
fn both_scanners_produce_the_same_index() {
    let fx = build_fixture();
    let fast = scan(&fx.root, true);
    let slow = scan(&fx.root, false);

    assert_eq!(fast.dirs.len(), slow.dirs.len());
    assert_eq!(fast.files.len(), slow.files.len());
    assert_eq!(fast.dirs[0].agg_size, slow.dirs[0].agg_size);
    assert_eq!(fast.dirs[0].agg_alloc, slow.dirs[0].agg_alloc);
    assert_eq!(fast.dirs[0].agg_files, slow.dirs[0].agg_files);

    let names = |ix: &ScanIndex| {
        let mut v: Vec<String> = (0..ix.files.len() as u32)
            .map(|i| ix.file_name(i).to_string())
            .collect();
        v.sort();
        v
    };
    assert_eq!(names(&fast), names(&slow));
}

#[test]
fn unused_ranking_prefers_large_and_forgotten() {
    let fx = build_fixture();
    let ix = scan(&fx.root, true);

    // Freshly written files all look "used today", so drive the ranking with
    // synthetic ages on the real index.
    let mut ix = ix;
    let big = file_named(&ix, "big.safetensors").unwrap();
    let mov = file_named(&ix, "final_prores.mov").unwrap();
    ix.files[big as usize].last_used = NOW - DAY; // huge, used yesterday
    ix.files[mov as usize].last_used = NOW - 800 * DAY; // smaller, forgotten
    ix.build_cleanup_norm(NOW);

    let ranked = files::select_files(
        &ix,
        ix.items(true),
        &Query::default(),
        QuickFilter::All,
        files::hog_sort_spec(HogMode::LargestAndUnused),
        NOW,
        0,
    );
    let rank_of = |id: u32| ranked.iter().position(|&r| r == id).unwrap();
    assert!(
        rank_of(mov) < rank_of(big),
        "a 12 MB file untouched for two years should outrank a 20 MB file used yesterday"
    );

    // ...while plain "largest first" still puts the big one on top.
    let by_size = files::select_files(
        &ix,
        ix.items(true),
        &Query::default(),
        QuickFilter::All,
        SortSpec {
            key: SortKey::Size,
            desc: true,
        },
        NOW,
        0,
    );
    assert_eq!(by_size[0], big);

    // And the "unused 1y+" quick filter keeps only the forgotten one.
    let old = files::select_files(
        &ix,
        ix.items(true),
        &Query::default(),
        QuickFilter::Unused1y,
        SortSpec::default(),
        NOW,
        0,
    );
    assert_eq!(old, vec![mov]);
}
