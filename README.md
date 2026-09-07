# DiskLens

Fast storage analysis for macOS. Built with Tauri 2, React + TypeScript, and Rust.

DiskLens answers three questions about a disk:

1. **What is biggest?** — the question every disk tool answers.
2. **What have I not touched in a year?** — the question macOS can answer, via
   Spotlight's `kMDItemLastUsedDate`, and almost nothing does.
3. **What is both?** — a 40 GB render cache you opened yesterday is not the same
   problem as a 40 GB render cache you last opened in 2023.

The information design follows WizTree's — a dense tree, a file list, a file-type
breakdown, a treemap, everything sorted biggest-first. None of its code, assets,
icons or branding are used; the implementation, layout and visual language here
are original.

---

## Running it

```bash
npm install
npm run tauri dev          # develop
npm run tauri build        # produce DiskLens.app
npm run dmg                # package it into a .dmg
```

The bundle target is `app` rather than `dmg` on purpose. Tauri's own dmg
bundler drives Finder over AppleScript to style the disk image window, which
fails on any machine that has not granted the shell Automation access to
Finder. `npm run dmg` does the same job with `hdiutil` alone.

Requires a recent Rust toolchain, Node 20+, Xcode command line tools, and
macOS 14 or later on Apple silicon.

```bash
cargo test  --manifest-path src-tauri/Cargo.toml     # 55 tests
cargo check --manifest-path src-tauri/Cargo.toml
npm run build
```

`npm run dev` on its own opens the UI in a plain browser against a fixture
harness (`src/lib/mock.ts`) — useful for working on layout without waiting for a
scan. Inside the Tauri shell the real Rust index is always used.

Scan timings on your own machine:

```bash
cargo run --release --manifest-path src-tauri/Cargo.toml --example bench -- /Users
cargo run --release --manifest-path src-tauri/Cargo.toml --example bench -- /Users slow
```

## Full Disk Access

DiskLens runs without it. Folders it cannot read are skipped, counted, and shown
in the status bar with a lock marker in the tree — the scan never aborts. To see
everything, add DiskLens under **System Settings ▸ Privacy & Security ▸ Full Disk
Access**; the status bar and Settings both link straight there.

---

## How it works

### The index lives in Rust

A scan of a few million files never crosses the IPC boundary. `ScanIndex` holds
flat arrays — one `FileRec` per file, one `DirRec` per folder, all names in a
single byte arena — and the UI asks only for the rows it is about to paint.
Sorting, filtering, aggregation and treemap layout all happen in Rust.

Measured on a 1.57 M file, 700 GB home directory (M-series, warm cache):

| | |
|---|---|
| Walk | 7.5 s — 210,000 files/s |
| Aggregate + sort + rank | 77 ms |
| Treemap layout (3,215 rects) | < 1 ms |
| Index memory | ~190 MB |

### Two scanners

`DiskScanner` has two implementations. `StandardScanner` is `readdir` +
`lstat` per entry: portable, obviously correct, and the one the tests pin
behaviour against. `MacOSFastScanner` uses `getattrlistbulk(2)` to pull a whole
directory of names *and* metadata in one syscall, which is about **2× faster**.

The bulk attribute buffer is packed with no alignment padding, and which
attribute groups appear varies per entry — a directory carries no `fileattr`
block — so it is walked with a byte cursor rather than cast to a struct. On
startup the fast scanner cross-checks itself against `lstat` on a directory it
creates; if the two ever disagree it disables itself and the app falls back
rather than reporting sizes that are quietly wrong.

The walk is breadth-first, one level at a time, with each level read in parallel
through Rayon. Merging is single-threaded, which is fine: syscalls dominate.

### Counting bytes once

* **Firmlinks.** On modern macOS `/Users` and `/System/Volumes/Data/Users` are
  the same directory. Every directory's `(dev, ino)` is recorded, so whichever
  path is reached first — always the shorter one, under BFS — wins.
* **Volume groups.** A scan of `/` must reach the Data volume but must not
  wander onto an unrelated disk under `/Volumes`. Allowed devices are the scan
  root's volume plus its siblings in the same APFS container.
* **Hard links.** A second sighting of the same `(dev, ino)` still lists the
  file, but contributes no additional bytes on disk.
* **Symlinks.** Listed, never followed, never charged for their target.
* **iCloud.** A dataless placeholder (`SF_DATALESS`) reports its full logical
  size and zero allocated bytes, and is marked ☁. Nothing in DiskLens ever opens
  a file's contents, so scanning cannot fault cloud data back down.

### Last Used

`kMDItemLastUsedDate` via `MDItemCreate`, falling back to filesystem access
time, falling back to unknown — and the UI always says which, in the tooltip.
The Spotlight pass runs after the walk, in parallel, over the largest 30,000
files: those are the rows anyone acts on, and a whole-drive lookup would cost far
more than it is worth.

### Cleanup Score

```
sizeScore   = log2(sizeMB + 1)
unusedScore = log2(unusedDays + 2)
score       = normalise(sizeScore × unusedScore)
```

Both terms are logarithmic, so a merely huge file cannot outrank one that is
large *and* forgotten, and a tiny ancient file cannot outrank either. Files whose
usage is unknown are damped rather than promoted.

It is labelled **review priority**, not a deletion recommendation. Anything under
`/System`, `/usr`, `/bin`, `/sbin`, `/private` or `/Library`, and anything inside
an application bundle, is marked and never nudged toward deletion. The first five
cannot be trashed at all.

### Deleting

`NSFileManager -trashItemAtURL:`, always. There is no `unlink` anywhere in this
codebase. The confirmation states the size and how long the item has gone
untouched, because those are the two facts that decide it.

---

## Layout

At 1440 × 900 the window divides exactly:

| Row | Height |
|---|---|
| Toolbar | 48 |
| Drive overview | 68 |
| Mode tabs | 36 |
| Main content | 448 |
| Treemap header | 30 |
| Treemap | 236 |
| Status bar | 34 |

The Tree/Files split and the Treemap boundary both drag. Below about 1280 px
lower-priority columns drop out by weight — Name, Size and Unused For always
survive, because they are the three the app exists to show.

## Search

Terms are ANDed:

```
mov                 name contains "mov"
*.mov               glob
extension:mov       exact extension
size:>5GB           allocated-or-logical size
unused:>6m          idle longer than six months
path:Downloads      path contains
kind:video          category
size:>5GB unused:>6m
```

## Keyboard

| | |
|---|---|
| ⌘F | Search |
| ⌘R | Rescan |
| ⌘1 / ⌘2 / ⌘3 | Tree / Space Hogs / File Types |
| Space | Quick Look |
| ⌘O | Open |
| ⌘⌫ | Move to Trash |
| ⌘⌥C | Copy path |
| Esc | Clear selection, close popup |

---

## Layout of the source

```
src-tauri/src/
  model.rs         FileRec, DirRec, categories, protected paths
  index/           aggregation, tree flattening, ranking, extension table
  scanner/         DiskScanner trait, standard.rs, macos.rs (getattrlistbulk)
  metadata/        spotlight.rs (kMDItemLastUsedDate), filesystem.rs
  query.rs         the search language
  treemap.rs       squarified layout
  volumes.rs       mount table, volume groups, capacities
  commands/        the Tauri command surface
  finder/ trash/   Finder, Quick Look, NSFileManager trash
src/
  lib/             API bindings, formatting, virtualization hooks
  components/      toolbar, tree, file list, space hogs, file types, treemap
```

## Licence

MIT.
