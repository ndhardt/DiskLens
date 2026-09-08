//! DiskLens: storage analysis for macOS.
//!
//! Rust owns the scan index; the UI requests only the rows it paints. That is
//! what keeps a multi-million-file drive responsive.

pub mod cleanup;
pub mod commands;
pub mod finder;
pub mod index;
pub mod metadata;
pub mod model;
pub mod query;
pub mod scanner;
pub mod state;
pub mod trash;
pub mod treemap;
pub mod volumes;

use std::sync::Arc;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Verify the bulk scanner against lstat before anything relies on it.
    #[cfg(target_os = "macos")]
    {
        scanner::macos::self_check();
    }

    let shared = Arc::new(AppState::default());
    *shared.volumes.write() = volumes::list_volumes();

    let startup = Arc::clone(&shared);
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            use tauri::Manager;
            if let Ok(dir) = app.path().app_config_dir() {
                *startup.settings.write() = state::load_settings(&dir);
                *startup.config_dir.write() = Some(dir);
            }
            Ok(())
        })
        .manage(shared)
        .invoke_handler(tauri::generate_handler![
            commands::list_volumes,
            commands::start_scan,
            commands::cancel_scan,
            commands::scan_progress,
            commands::drive_summary,
            commands::tree_page,
            commands::tree_toggle,
            commands::tree_set_sort,
            commands::tree_expand_depth,
            commands::tree_collapse_all,
            commands::tree_reveal,
            commands::file_page,
            commands::hog_page,
            commands::file_row_index,
            commands::hog_row_index,
            commands::extension_table,
            commands::cleanup_groups,
            commands::cleanup_group_page,
            commands::cleanup_selection,
            commands::treemap,
            commands::item_detail,
            commands::usage_metadata,
            commands::item_paths,
            commands::locate_file,
            commands::open_item,
            commands::reveal_item,
            commands::quick_look,
            commands::open_full_disk_access,
            commands::trash_preview,
            commands::trash_items,
            commands::get_settings,
            commands::set_settings,
            commands::denied_report,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DiskLens");
}
