//! `kMDItemLastUsedDate` via the Metadata framework.
//!
//! `MDItemCreate` reads the metadata index and never opens the file, so asking
//! about an iCloud placeholder does not fault its bytes down.

#![cfg(target_os = "macos")]

use core_foundation::array::{CFArray, CFArrayRef};
use core_foundation::base::{CFRelease, CFType, CFTypeRef, TCFType};
use core_foundation::date::{CFDate, CFDateRef};
use core_foundation::string::{CFString, CFStringRef};
use once_cell::sync::Lazy;

#[allow(non_camel_case_types)]
type MDItemRef = *const std::ffi::c_void;

#[link(name = "CoreServices", kind = "framework")]
extern "C" {
    fn MDItemCreate(allocator: CFTypeRef, path: CFStringRef) -> MDItemRef;
    fn MDItemCopyAttribute(item: MDItemRef, name: CFStringRef) -> CFTypeRef;
}

/// Seconds between the CF epoch (2001-01-01) and the Unix epoch.
const CF_EPOCH_OFFSET: f64 = 978_307_200.0;

struct AttrNames {
    last_used: CFString,
    used_dates: CFString,
}

// CFString is immutable and CF reads are thread-safe, so one shared copy of
// each attribute name serves every worker.
unsafe impl Send for AttrNames {}
unsafe impl Sync for AttrNames {}

static NAMES: Lazy<AttrNames> = Lazy::new(|| AttrNames {
    last_used: CFString::from_static_string("kMDItemLastUsedDate"),
    used_dates: CFString::from_static_string("kMDItemUsedDates"),
});

/// Last-used instant for `path` in Unix seconds, or `None` if unknown.
pub fn last_used(path: &str) -> Option<i64> {
    let cf_path = CFString::new(path);
    let item = unsafe { MDItemCreate(std::ptr::null(), cf_path.as_concrete_TypeRef()) };
    if item.is_null() {
        return None;
    }
    let _guard = CfGuard(item as CFTypeRef);

    if let Some(t) = copy_date(item, NAMES.last_used.as_concrete_TypeRef()) {
        return Some(t);
    }
    // Some items carry only the day-resolution history array.
    copy_latest_date_in_array(item, NAMES.used_dates.as_concrete_TypeRef())
}

fn copy_date(item: MDItemRef, name: CFStringRef) -> Option<i64> {
    let v = unsafe { MDItemCopyAttribute(item, name) };
    if v.is_null() {
        return None;
    }
    let _guard = CfGuard(v);
    if unsafe { core_foundation::base::CFGetTypeID(v) } != CFDate::type_id() {
        return None;
    }
    let abs = unsafe { core_foundation::date::CFDateGetAbsoluteTime(v as CFDateRef) };
    to_unix(abs)
}

fn copy_latest_date_in_array(item: MDItemRef, name: CFStringRef) -> Option<i64> {
    let v = unsafe { MDItemCopyAttribute(item, name) };
    if v.is_null() {
        return None;
    }
    let _guard = CfGuard(v);
    if unsafe { core_foundation::base::CFGetTypeID(v) } != CFArray::<CFType>::type_id() {
        return None;
    }
    let arr: CFArray<CFType> = unsafe { CFArray::wrap_under_get_rule(v as CFArrayRef) };
    let mut best: Option<i64> = None;
    for item in arr.iter() {
        let raw = item.as_CFTypeRef();
        if unsafe { core_foundation::base::CFGetTypeID(raw) } != CFDate::type_id() {
            continue;
        }
        let abs = unsafe { core_foundation::date::CFDateGetAbsoluteTime(raw as CFDateRef) };
        if let Some(t) = to_unix(abs) {
            best = Some(best.map_or(t, |b: i64| b.max(t)));
        }
    }
    best
}

fn to_unix(abs: f64) -> Option<i64> {
    if !abs.is_finite() {
        return None;
    }
    let unix = abs + CF_EPOCH_OFFSET;
    // Reject nonsense rather than show a 1904 date.
    if !(0.0..=4_102_444_800.0).contains(&unix) {
        return None;
    }
    Some(unix as i64)
}

struct CfGuard(CFTypeRef);
impl Drop for CfGuard {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0) };
        }
    }
}

/// Whether Spotlight is likely to answer for this volume.
pub fn indexing_enabled(volume: &str) -> bool {
    // The store directory exists only on an indexed volume.
    let p = if volume == "/" {
        "/.Spotlight-V100".to_string()
    } else {
        format!("{}/.Spotlight-V100", volume.trim_end_matches('/'))
    };
    std::path::Path::new(&p).exists()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_paths_return_none_without_crashing() {
        assert_eq!(last_used("/definitely/not/a/real/path.mov"), None);
    }

    #[test]
    fn a_freshly_written_file_never_reports_a_bogus_epoch() {
        let p = std::env::temp_dir().join(format!("dl-spot-{}.txt", std::process::id()));
        std::fs::write(&p, b"hello").unwrap();
        // Spotlight may or may not know about /tmp; either answer is fine, but
        // an answer must be a plausible instant.
        if let Some(t) = last_used(&p.to_string_lossy()) {
            assert!(t > 1_000_000_000, "date must be after 2001");
            assert!(t < 4_102_444_800);
        }
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn known_application_usually_has_a_used_date() {
        // Not asserted as Some: a fresh machine may not have launched it. The
        // point is that the call is safe and self-consistent on a real path.
        let t = last_used("/System/Applications/Utilities/Terminal.app");
        if let Some(t) = t {
            assert!(t > 1_000_000_000);
        }
    }

    #[test]
    fn boot_volume_reports_indexing_state() {
        // Just needs to answer without panicking.
        let _ = indexing_enabled("/");
    }
}
