//! Core types for the scan index.
//!
//! Kept as flat arrays so a multi-million-file scan stays compact. The
//! frontend never receives the whole index, only the slice it renders.

use serde::{Deserialize, Serialize};

/// Slice into the shared name arena, so `FileRec` stays `Copy` and small.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NameRef {
    pub off: u32,
    pub len: u32,
}

/// Arena of UTF-8 file/directory names.
#[derive(Default)]
pub struct NameArena {
    buf: Vec<u8>,
}

impl NameArena {
    pub fn with_capacity(bytes: usize) -> Self {
        Self {
            buf: Vec::with_capacity(bytes),
        }
    }

    pub fn push(&mut self, s: &str) -> NameRef {
        let off = self.buf.len() as u32;
        self.buf.extend_from_slice(s.as_bytes());
        NameRef {
            off,
            len: s.len() as u32,
        }
    }

    #[inline]
    pub fn get(&self, r: NameRef) -> &str {
        let start = r.off as usize;
        let end = start + r.len as usize;
        // Safety: only ever filled through `push`, which takes `&str`.
        unsafe { std::str::from_utf8_unchecked(&self.buf[start..end]) }
    }

    pub fn bytes(&self) -> usize {
        self.buf.len()
    }
}

pub const NO_TIME: i64 = i64::MIN;

/// Bit flags carried by every entry.
pub mod flags {
    pub const IS_DIR: u32 = 1 << 0;
    pub const IS_SYMLINK: u32 = 1 << 1;
    /// iCloud / File Provider placeholder: bytes live in the cloud, not here.
    pub const IS_CLOUD: u32 = 1 << 2;
    /// Seen through a hard link whose inode we had already counted.
    pub const IS_HARDLINK_DUP: u32 = 1 << 3;
    /// Somewhere under a protected system path.
    pub const IS_SYSTEM: u32 = 1 << 4;
    /// A macOS bundle (.app, .framework, ...).
    pub const IS_PACKAGE: u32 = 1 << 5;
    /// Directory we could not read (EACCES/EPERM).
    pub const IS_DENIED: u32 = 1 << 6;
    /// `last_used` came from Spotlight rather than the filesystem.
    pub const USED_FROM_SPOTLIGHT: u32 = 1 << 7;
    /// Lives inside a package/bundle.
    pub const IN_PACKAGE: u32 = 1 << 8;
    /// Stand-in row for a whole bundle. Not a real inode: it lets an .app
    /// rank as one item instead of thousands of pieces.
    pub const IS_SYNTHETIC: u32 = 1 << 9;
}

/// Origin of a `last_used` timestamp.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LastUsedSource {
    Spotlight,
    FileSystemAccessTime,
    Unknown,
}

/// One file. Never a directory.
#[derive(Clone, Copy, Debug)]
pub struct FileRec {
    pub name: NameRef,
    pub parent: u32,
    pub ext: u32,
    pub size: u64,
    pub alloc: u64,
    pub mtime: i64,
    pub atime: i64,
    pub btime: i64,
    pub last_used: i64,
    pub flags: u32,
}

impl FileRec {
    #[inline]
    pub fn has(&self, f: u32) -> bool {
        self.flags & f != 0
    }

    #[inline]
    pub fn last_used_source(&self) -> LastUsedSource {
        if self.has(flags::USED_FROM_SPOTLIGHT) {
            LastUsedSource::Spotlight
        } else if self.atime != NO_TIME {
            LastUsedSource::FileSystemAccessTime
        } else {
            LastUsedSource::Unknown
        }
    }

    /// Best available last-touched instant, Spotlight first.
    #[inline]
    pub fn effective_last_used(&self) -> i64 {
        if self.last_used != NO_TIME {
            self.last_used
        } else if self.atime != NO_TIME {
            self.atime
        } else {
            NO_TIME
        }
    }
}

/// One directory, with subtree aggregates filled in after the walk.
#[derive(Clone, Debug)]
pub struct DirRec {
    pub name: NameRef,
    /// `u32::MAX` for the scan root.
    pub parent: u32,
    pub depth: u16,
    pub flags: u32,

    pub children: Vec<u32>,
    pub files: Vec<u32>,

    /// Metadata of the directory inode itself.
    pub mtime: i64,
    pub atime: i64,
    pub btime: i64,
    pub last_used: i64,

    /// Subtree totals (this directory + everything under it).
    pub agg_size: u64,
    pub agg_alloc: u64,
    pub agg_files: u64,
    pub agg_dirs: u64,
    /// Most recent usage or modification anywhere in the subtree.
    pub agg_last_used: i64,
    pub agg_mtime: i64,
}

impl DirRec {
    pub fn new(name: NameRef, parent: u32, depth: u16, flags: u32) -> Self {
        Self {
            name,
            parent,
            depth,
            flags,
            children: Vec::new(),
            files: Vec::new(),
            mtime: NO_TIME,
            atime: NO_TIME,
            btime: NO_TIME,
            last_used: NO_TIME,
            agg_size: 0,
            agg_alloc: 0,
            agg_files: 0,
            agg_dirs: 0,
            agg_last_used: NO_TIME,
            agg_mtime: NO_TIME,
        }
    }

    #[inline]
    pub fn has(&self, f: u32) -> bool {
        self.flags & f != 0
    }
}

/// Coarse file family. Drives Treemap colour and the `kind:` filter.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[repr(u8)]
pub enum Category {
    Video = 0,
    Image = 1,
    Audio = 2,
    Archive = 3,
    AiModel = 4,
    Document = 5,
    Code = 6,
    System = 7,
    Other = 8,
}

impl Category {
    pub const ALL: [Category; 9] = [
        Category::Video,
        Category::Image,
        Category::Audio,
        Category::Archive,
        Category::AiModel,
        Category::Document,
        Category::Code,
        Category::System,
        Category::Other,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Category::Video => "Video",
            Category::Image => "Images",
            Category::Audio => "Audio",
            Category::Archive => "Archive",
            Category::AiModel => "AI Model",
            Category::Document => "Documents",
            Category::Code => "Code",
            Category::System => "System",
            Category::Other => "Other",
        }
    }

    pub fn from_token(s: &str) -> Option<Category> {
        match s.to_ascii_lowercase().as_str() {
            "video" | "movie" | "movies" => Some(Category::Video),
            "image" | "images" | "photo" | "photos" | "picture" => Some(Category::Image),
            "audio" | "music" | "sound" => Some(Category::Audio),
            "archive" | "archives" | "zip" => Some(Category::Archive),
            "ai" | "aimodel" | "model" | "models" => Some(Category::AiModel),
            "doc" | "docs" | "document" | "documents" | "text" => Some(Category::Document),
            "code" | "source" | "dev" => Some(Category::Code),
            "system" | "sys" => Some(Category::System),
            "other" | "misc" => Some(Category::Other),
            _ => None,
        }
    }
}

/// Map a lowercase extension (no dot) onto a category.
pub fn categorize(ext: &str) -> Category {
    match ext {
        "mov" | "mp4" | "m4v" | "avi" | "mkv" | "webm" | "mpg" | "mpeg" | "wmv" | "flv" | "prores"
        | "braw" | "r3d" | "mxf" | "m2ts" | "vob" | "ogv" | "3gp" | "dv" => Category::Video,

        "jpg" | "jpeg" | "png" | "gif" | "bmp" | "tif" | "tiff" | "webp" | "heic" | "heif"
        | "psd" | "psb" | "ai" | "svg" | "raw" | "cr2" | "cr3" | "nef" | "arw" | "dng" | "orf"
        | "rw2" | "icns" | "ico" | "exr" | "hdr" | "avif" | "jxl" | "sketch" | "afphoto"
        | "afdesign" | "xcf" => Category::Image,

        "mp3" | "wav" | "aac" | "flac" | "aiff" | "aif" | "m4a" | "ogg" | "opus" | "wma"
        | "alac" | "caf" | "mid" | "midi" | "logicx" | "band" | "aup" | "als" | "flp" => {
            Category::Audio
        }

        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" | "zst" | "tgz" | "dmg" | "iso"
        | "pkg" | "cab" | "lz4" | "sit" | "sitx" | "jar" | "war" | "deb" | "rpm" | "apk"
        | "sparseimage" | "sparsebundle" => Category::Archive,

        "safetensors" | "ckpt" | "gguf" | "ggml" | "pt" | "pth" | "bin" | "onnx" | "pb"
        | "tflite" | "mlmodel" | "mlpackage" | "mlmodelc" | "h5" | "npz" | "npy" | "lora"
        | "vae" | "petals" | "q4_0" | "q8_0" => Category::AiModel,

        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "txt" | "rtf" | "md"
        | "pages" | "numbers" | "key" | "odt" | "ods" | "odp" | "epub" | "mobi" | "csv"
        | "tsv" | "djvu" | "tex" => Category::Document,

        "rs" | "c" | "h" | "cpp" | "cc" | "hpp" | "m" | "mm" | "swift" | "js" | "jsx" | "ts"
        | "tsx" | "py" | "rb" | "go" | "java" | "kt" | "cs" | "php" | "sh" | "zsh" | "bash"
        | "json" | "yaml" | "yml" | "toml" | "xml" | "html" | "css" | "scss" | "sql" | "lua"
        | "pl" | "r" | "jl" | "dart" | "vue" | "svelte" | "ipynb" | "lock" | "gradle" => {
            Category::Code
        }

        "dylib" | "so" | "a" | "o" | "framework" | "kext" | "dext" | "plist" | "cache"
        | "db" | "sqlite" | "sqlite3" | "wal" | "shm" | "log" | "swap" | "sparse" | "asset"
        | "car" | "nib" | "storyboardc" | "dSYM" | "dsym" | "pyc" | "class" | "spotlight"
        | "systemversion" => Category::System,

        "blend" | "blend1" | "fbx" | "obj" | "usd" | "usdz" | "usda" | "usdc" | "abc"
        | "gltf" | "glb" | "3ds" | "dae" | "stl" | "c4d" | "ma" | "mb" | "max" | "ztl"
        | "spp" | "sbsar" => Category::Other,

        _ => Category::Other,
    }
}

/// 3D assets get their own label in the type table but share the neutral
/// Treemap colour.
pub fn category_label_for_ext(ext: &str) -> &'static str {
    match ext {
        "blend" | "blend1" | "fbx" | "obj" | "usd" | "usdz" | "usda" | "usdc" | "abc" | "gltf"
        | "glb" | "3ds" | "dae" | "stl" | "c4d" | "ma" | "mb" | "max" | "ztl" | "spp" | "sbsar" => {
            "3D"
        }
        _ => categorize(ext).label(),
    }
}

/// Bundle extensions treated as a single leaf item.
pub const PACKAGE_EXTS: &[&str] = &[
    "app",
    "framework",
    "bundle",
    "kext",
    "dext",
    "plugin",
    "appex",
    "xpc",
    "prefpane",
    "qlgenerator",
    "mdimporter",
    "component",
    "vst",
    "vst3",
    "audiounit",
    "photoslibrary",
    "fcpbundle",
    "imovielibrary",
    "logicx",
    "band",
    "sparsebundle",
    "rtfd",
    "mlpackage",
    "mlmodelc",
    "dsym",
    "xcarchive",
    "playground",
    "pbproj",
    "xcodeproj",
    "xcworkspace",
    "scptd",
    "download",
    "aplibrary",
    "tvlibrary",
];

pub fn is_package_ext(ext: &str) -> bool {
    PACKAGE_EXTS.contains(&ext)
}

/// OS paths. Shown, but never suggested for deletion.
pub const PROTECTED_PREFIXES: &[&str] = &[
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/private",
    "/Library",
    "/cores",
    "/opt",
    "/dev",
    "/Network",
    "/Volumes/Preboot",
    "/Volumes/Recovery",
];

/// The subset that cannot be trashed at all.
pub const IMMUTABLE_PREFIXES: &[&str] = &["/System", "/usr", "/bin", "/sbin", "/private", "/dev"];

pub fn is_protected_path(path: &str) -> bool {
    PROTECTED_PREFIXES
        .iter()
        .any(|p| path == *p || path.starts_with(&format!("{p}/")))
}

pub fn is_immutable_path(path: &str) -> bool {
    IMMUTABLE_PREFIXES
        .iter()
        .any(|p| path == *p || path.starts_with(&format!("{p}/")))
}

/// Lowercased extension of a file name, or `""`.
pub fn extension_of(name: &str) -> String {
    match name.rfind('.') {
        // A leading dot means a dotfile, not an extension.
        Some(0) | None => String::new(),
        Some(i) => {
            let ext = &name[i + 1..];
            if ext.is_empty() || ext.len() > 24 || ext.chars().any(|c| c == ' ' || c == '/') {
                String::new()
            } else {
                ext.to_ascii_lowercase()
            }
        }
    }
}
