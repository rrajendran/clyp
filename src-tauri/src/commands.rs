//! Tauri commands exposed to the web UI (the former `ipcMain.handle` set).

use crate::clipboard::{self, Payload};
use crate::storage::{Item, Settings};
use crate::windows::{self, Anchor};
use crate::{tray, updater, AppState};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use tauri_plugin_opener::OpenerExt;

/// How long a copied item may sit on the clipboard before we wipe it.
const COPY_FALLBACK_CLEAR: Duration = Duration::from_secs(30);
/// Grace period after the popup closes so the user can paste.
const COPY_HIDE_GRACE: Duration = Duration::from_secs(5);

#[derive(Default)]
pub struct CopyState {
    pub payload: Option<Payload>,
    pub generation: u64,
}

// -- clipboard clearing ------------------------------------------------------

fn schedule_clear(app: &AppHandle, delay: Duration, generation: u64) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        let state = app.state::<AppState>();
        let mut copy = state.copy.lock().unwrap();
        if copy.generation != generation {
            return; // superseded by a newer copy
        }
        if let Some(payload) = copy.payload.take() {
            // Only wipe if the user hasn't copied something else meanwhile.
            if clipboard::clipboard_matches(&payload) {
                clipboard::clear();
            }
        }
    });
}

/// Called whenever the popup is hidden.
pub fn on_popup_hidden(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mut copy = state.copy.lock().unwrap();
    if copy.payload.is_some() {
        copy.generation += 1;
        let gen = copy.generation;
        drop(copy);
        schedule_clear(app, COPY_HIDE_GRACE, gen);
    }
}

// -- settings side effects ---------------------------------------------------

/// Register the global shortcut; returns a warning if the saved one is unusable.
fn register_shortcut(app: &AppHandle, accel: &str) -> Option<String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let try_register = |a: &str| -> Result<(), String> {
        let sc: Shortcut = a.parse().map_err(|e| format!("{e}"))?;
        gs.register(sc).map_err(|e| e.to_string())
    };
    match try_register(accel) {
        Ok(()) => None,
        Err(e) => {
            let fallback = crate::storage::default_shortcut();
            let _ = try_register(&fallback);
            Some(format!("Could not register \"{accel}\" ({e}). Using {fallback} instead."))
        }
    }
}

fn apply_effects(app: &AppHandle, s: &Settings) -> Option<String> {
    let state = app.state::<AppState>();

    let warning = register_shortcut(app, &s.shortcut);

    if s.monitoring_enabled {
        state.monitor.start(app.clone());
    } else {
        state.monitor.stop();
    }

    sync_autostart(app, s.start_on_boot);
    windows::apply_theme(app, &s.theme);
    apply_dock_visibility(app, s.hide_dock_icon);
    tray::refresh_menu(app);
    warning
}

fn sync_autostart(app: &AppHandle, enabled: bool) {
    let manager = app.autolaunch();
    if manager.is_enabled().unwrap_or(false) != enabled {
        let _ = if enabled { manager.enable() } else { manager.disable() };
    }
}

#[allow(unused_variables)]
fn apply_dock_visibility(app: &AppHandle, hide: bool) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.set_activation_policy(if hide {
            tauri::ActivationPolicy::Accessory
        } else {
            tauri::ActivationPolicy::Regular
        });
    }
}

/// Apply initial settings at launch.
pub fn apply_startup(app: &AppHandle) {
    let s = app.state::<AppState>().store.lock().unwrap().settings();
    if let Some(w) = apply_effects(app, &s) {
        eprintln!("clyp: {w}");
    }
}

pub fn apply_settings_patch(app: &AppHandle, patch: Value) -> Result<Option<String>, String> {
    let settings = app.state::<AppState>().store.lock().unwrap().update_settings(&patch)?;
    let warning = apply_effects(app, &settings);
    let _ = app.emit("settings-changed", &settings);
    Ok(warning)
}

// -- commands ----------------------------------------------------------------

#[tauri::command]
pub fn get_history(state: State<AppState>) -> Vec<Item> {
    state.store.lock().unwrap().history()
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Settings {
    state.store.lock().unwrap().settings()
}

#[tauri::command]
pub fn update_settings(app: AppHandle, settings: Value) -> Result<Value, String> {
    let warning = apply_settings_patch(&app, settings)?;
    Ok(json!({ "ok": true, "warning": warning }))
}

#[tauri::command]
pub fn delete_item(state: State<AppState>, id: String) -> Vec<Item> {
    state.store.lock().unwrap().delete_item(&id)
}

#[tauri::command]
pub fn pin_item(state: State<AppState>, id: String) -> Vec<Item> {
    state.store.lock().unwrap().toggle_pin(&id)
}

#[tauri::command]
pub fn copy_to_clipboard(
    app: AppHandle,
    state: State<AppState>,
    content: Value,
    keep: Option<bool>,
) -> Result<bool, String> {
    let payload = Payload::from_value(&content);
    let wrote_image = clipboard::write_payload(&payload).map_err(|e| format!("copy failed: {e}"))?;
    // The monitor keeps running (so nothing the user copies next is missed);
    // it just must not capture Clyp's own write as a new item.
    if wrote_image {
        state.monitor.mark_own_image();
    } else if let Some(text) = &payload.text {
        state.monitor.mark_own_text(text);
    }
    // `keep`: the big window leaves the clipboard alone. The popup wipes it
    // shortly after use (see on_popup_hidden).
    if keep.unwrap_or(false) {
        return Ok(true);
    }
    let gen = {
        let mut copy = state.copy.lock().unwrap();
        copy.generation += 1;
        copy.payload = Some(payload);
        copy.generation
    };
    schedule_clear(&app, COPY_FALLBACK_CLEAR, gen);
    Ok(true)
}

#[tauri::command]
pub fn hide_window(app: AppHandle) -> bool {
    windows::hide_popup(&app);
    on_popup_hidden(&app);
    true
}

#[tauri::command]
pub fn show_settings(app: AppHandle, section: Option<String>) -> bool {
    windows::show_settings(&app, section.as_deref());
    true
}

#[tauri::command]
pub fn clear_history(app: AppHandle, state: State<AppState>) -> Value {
    let history = state.store.lock().unwrap().clear_history();
    let _ = app.emit("history-updated", &history);
    json!({ "success": true, "history": history })
}

#[tauri::command]
pub fn clear_all_data(app: AppHandle, state: State<AppState>) -> Value {
    let (history, settings) = {
        let mut store = state.store.lock().unwrap();
        store.clear_all_data();
        (store.history(), store.settings())
    };
    apply_effects(&app, &settings);
    let _ = app.emit("history-updated", &history);
    let _ = app.emit("settings-changed", &settings);
    json!({ "success": true })
}

#[tauri::command]
pub fn remove_duplicates(app: AppHandle, state: State<AppState>) -> Value {
    let history = state.store.lock().unwrap().remove_duplicates();
    let _ = app.emit("history-updated", &history);
    json!({ "success": true, "history": history })
}

#[tauri::command]
pub fn add_tag_to_item(state: State<AppState>, id: String, tag: String) -> Value {
    let history = state.store.lock().unwrap().add_tag(&id, &tag);
    json!({ "success": true, "history": history })
}

#[tauri::command]
pub fn remove_tag_from_item(state: State<AppState>, id: String, tag: String) -> Value {
    let history = state.store.lock().unwrap().remove_tag(&id, &tag);
    json!({ "success": true, "history": history })
}

#[tauri::command]
pub fn get_all_tags(state: State<AppState>) -> Value {
    json!({ "success": true, "tags": state.store.lock().unwrap().all_tags() })
}

#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<bool, String> {
    // Only ever hand web links to the OS.
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http(s) links can be opened".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn get_app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<Value, String> {
    let current = app.package_info().version.to_string();
    let info = tauri::async_runtime::spawn_blocking(move || updater::check(&current))
        .await
        .map_err(|e| e.to_string())??;
    serde_json::to_value(info).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn download_update(app: AppHandle) -> Value {
    let current = app.package_info().version.to_string();
    let result = tauri::async_runtime::spawn_blocking(move || updater::check(&current)).await;
    match result {
        Ok(Ok(info)) if info.available => match app.opener().open_url(info.download_url, None::<&str>) {
            Ok(()) => json!({ "success": true }),
            Err(e) => json!({ "success": false, "error": e.to_string() }),
        },
        Ok(Ok(_)) => json!({ "success": false, "error": "No update available" }),
        Ok(Err(e)) => json!({ "success": false, "error": e }),
        Err(e) => json!({ "success": false, "error": e.to_string() }),
    }
}

#[tauri::command]
pub fn set_start_on_boot(app: AppHandle, enabled: bool) -> bool {
    sync_autostart(&app, enabled);
    true
}

/// Startup update prompt (release builds only).
pub fn prompt_for_update(app: &AppHandle) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio_sleep(Duration::from_secs(5)).await;
        let current = app.package_info().version.to_string();
        let Ok(Ok(info)) = tauri::async_runtime::spawn_blocking(move || updater::check(&current)).await else {
            return;
        };
        if !info.available {
            return;
        }
        let handle = app.clone();
        app.dialog()
            .message(format!("Version {} is available.\n\nDownload it now?", info.version))
            .title("Update Available")
            .buttons(MessageDialogButtons::OkCancelCustom("Download".into(), "Later".into()))
            .show(move |download| {
                if download {
                    let _ = handle.opener().open_url(info.download_url, None::<&str>);
                }
            });
    });
}

async fn tokio_sleep(d: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}

pub fn show_popup_default(app: &AppHandle) {
    let rect = *app.state::<AppState>().tray_rect.lock().unwrap();
    windows::show_popup(app, rect.map(Anchor::Tray).unwrap_or(Anchor::Cursor));
}
