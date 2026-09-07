//! Handing an item to the system: Finder, Quick Look, default app.

use std::process::Command;

fn spawn(program: &str, args: &[&str]) -> Result<(), String> {
    Command::new(program)
        .args(args)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("{program}: {e}"))
}

pub fn open_path(path: &str) -> Result<(), String> {
    ensure_exists(path)?;
    spawn("/usr/bin/open", &[path])
}

pub fn reveal_in_finder(path: &str) -> Result<(), String> {
    ensure_exists(path)?;
    spawn("/usr/bin/open", &["-R", path])
}

/// Quick Look preview via `qlmanage -p`, which avoids linking the Quick Look
/// UI framework.
pub fn quick_look(path: &str) -> Result<(), String> {
    ensure_exists(path)?;
    Command::new("/usr/bin/qlmanage")
        .args(["-p", path])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("qlmanage: {e}"))
}

/// Open System Settings on the Full Disk Access pane.
pub fn open_full_disk_access_settings() -> Result<(), String> {
    spawn(
        "/usr/bin/open",
        &["x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"],
    )
}

fn ensure_exists(path: &str) -> Result<(), String> {
    if std::fs::symlink_metadata(path).is_err() {
        return Err(format!("{path} no longer exists"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_paths_are_rejected_before_spawning() {
        assert!(open_path("/nope/nope/nope").is_err());
        assert!(reveal_in_finder("/nope/nope/nope").is_err());
        assert!(quick_look("/nope/nope/nope").is_err());
    }
}
