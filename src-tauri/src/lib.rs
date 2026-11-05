mod clipboard;
mod commands;
mod storage;
mod tray;
mod updater;
mod windows;

use clipboard::Monitor;
use commands::CopyState;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use storage::Store;
use tauri::{Manager, Rect};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::ShortcutState;

pub struct AppState {
    pub store: Mutex<Store>,
    pub monitor: Arc<Monitor>,
    pub copy: Mutex<CopyState>,
    pub tray_rect: Mutex<Option<Rect>>,
    pub last_blur_hide: Mutex<Option<Instant>>,
}

/// Where the pre-Tauri (Electron) build kept its data, so we can import it.
fn legacy_data_file(app: &tauri::App) -> Option<PathBuf> {
    let base = if cfg!(target_os = "linux") {
        app.path().config_dir().ok()?
    } else {
        app.path().data_dir().ok()?
    };
    Some(base.join("Clyp").join("clyp-data.json"))
}

pub fn run() {
    let app = tauri::Builder::default()
        // Must be first: a second launch just surfaces the running instance.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            commands::show_popup_default(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        // The shortcut always opens on the cursor's display.
                        windows::toggle_popup(app, windows::Anchor::Cursor);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let data_file = app.path().app_data_dir()?.join("clyp-data.json");
            let store = Store::load(data_file, legacy_data_file(app));
            let hide_dock = store.settings().hide_dock_icon;

            app.manage(AppState {
                store: Mutex::new(store),
                monitor: Monitor::new(),
                copy: Mutex::new(CopyState::default()),
                tray_rect: Mutex::new(None),
                last_blur_hide: Mutex::new(None),
            });

            let handle = app.handle().clone();

            #[cfg(target_os = "macos")]
            {
                let _ = handle.set_activation_policy(if hide_dock {
                    tauri::ActivationPolicy::Accessory
                } else {
                    tauri::ActivationPolicy::Regular
                });
                tray::create_app_menu(&handle)?;
            }
            #[cfg(not(target_os = "macos"))]
            let _ = hide_dock;

            windows::create_main(&handle)?;
            tray::create(&handle)?;
            commands::apply_startup(&handle);

            if !cfg!(debug_assertions) {
                commands::prompt_for_update(&handle);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_history,
            commands::get_settings,
            commands::update_settings,
            commands::delete_item,
            commands::pin_item,
            commands::copy_to_clipboard,
            commands::hide_window,
            commands::show_settings,
            commands::clear_history,
            commands::clear_all_data,
            commands::remove_duplicates,
            commands::add_tag_to_item,
            commands::remove_tag_from_item,
            commands::get_all_tags,
            commands::open_external,
            commands::get_app_version,
            commands::check_for_updates,
            commands::download_update,
            commands::set_start_on_boot,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Clyp");

    app.run(|app_handle, event| match event {
        // Clyp lives in the tray: closing every window must not quit it.
        tauri::RunEvent::ExitRequested { api, code, .. } if code.is_none() => {
            api.prevent_exit();
        }
        // Clicking the Dock icon brings the popup up.
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { has_visible_windows, .. } if !has_visible_windows => {
            commands::show_popup_default(app_handle);
        }
        tauri::RunEvent::Exit => {
            app_handle.state::<AppState>().monitor.stop();
        }
        _ => {}
    });
}
