//! Scan timing harness: `cargo run --release --example bench -- /some/path`

use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use disklens_lib::index::ScanIndex;
use disklens_lib::scanner::{self, ScanOptions};
use disklens_lib::volumes::MountTable;

fn main() {
    let root = std::env::args().nth(1).unwrap_or_else(|| "/Users".into());
    let fast = std::env::args().nth(2).map(|s| s != "slow").unwrap_or(true);

    let opts = ScanOptions {
        root: root.clone().into(),
        volume_name: "bench".into(),
        fast,
        ..Default::default()
    };
    let sc = scanner::make_scanner(&opts);
    println!("scanner: {}", sc.name());

    let mut ix = ScanIndex::new(root.clone(), "bench".into());
    let cancel = Arc::new(AtomicBool::new(false));
    let mounts = MountTable::load();
    let t0 = std::time::Instant::now();
    let stats = scanner::walk(&opts, sc.as_ref(), &mut ix, &cancel, &mounts, &mut |_, _| {});
    let walk_ms = t0.elapsed().as_millis();

    let t1 = std::time::Instant::now();
    ix.finalize(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64,
    );
    let finalize_ms = t1.elapsed().as_millis();

    println!(
        "{} files, {} dirs, {:.2} GB logical, {:.2} GB on disk, {} skipped",
        stats.files,
        stats.dirs,
        stats.bytes as f64 / 1e9,
        stats.alloc as f64 / 1e9,
        stats.skipped
    );
    println!(
        "walk {walk_ms} ms, finalize {finalize_ms} ms, total {} ms ({:.0} files/s)",
        walk_ms + finalize_ms,
        stats.files as f64 / (walk_ms.max(1) as f64 / 1000.0)
    );
    println!(
        "index memory: names {:.1} MB, files {:.1} MB, dirs ~{:.1} MB",
        ix.names.bytes() as f64 / 1e6,
        (ix.files.len() * std::mem::size_of::<disklens_lib::model::FileRec>()) as f64 / 1e6,
        (ix.dirs.len() * std::mem::size_of::<disklens_lib::model::DirRec>()) as f64 / 1e6,
    );

    let t2 = std::time::Instant::now();
    let lay = disklens_lib::treemap::layout(&ix, 0, 1400.0, 240.0, 8000, false);
    println!(
        "treemap: {} rects in {} ms",
        lay.rects.len(),
        t2.elapsed().as_millis()
    );
}
