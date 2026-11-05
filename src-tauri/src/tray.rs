//! System tray (menu bar on macOS, notification area on Windows/Linux) and the
//! macOS application menu.

use crate::windows::{self, Anchor};
use crate::AppState;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

const TRAY_ID: &str = "main";

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let settings = app.state::<AppState>().store.lock().unwrap().settings();
    let sep = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let sep4 = PredefinedMenuItem::separator(app)?;

    let open = MenuItem::with_id(app, "tray-open", "Open Clipboard History", true, None::<&str>)?;
    let prefs = MenuItem::with_id(
        app,
        "tray-settings",
        if cfg!(target_os = "macos") { "Settings…" } else { "Settings" },
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let monitoring = MenuItem::with_id(
        app,
        "tray-monitoring",
        if settings.monitoring_enabled { "Pause Monitoring" } else { "Resume Monitoring" },
        true,
        None::<&str>,
    )?;
    let clear = MenuItem::with_id(app, "tray-clear", "Clear History", true, None::<&str>)?;
    let devtools = MenuItem::with_id(
        app,
        "tray-devtools",
        "Toggle Developer Tools",
        settings.developer_tools,
        None::<&str>,
    )?;
    let version = MenuItem::with_id(
        app,
        "tray-version",
        format!("Clyp {}", app.package_info().version),
        false,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit Clyp", true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &open, &sep, &prefs, &sep2, &monitoring, &clear, &sep3, &devtools, &version, &sep4,
            &quit,
        ],
    )
}

pub fn refresh_menu(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id(TRAY_ID), build_menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app)?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Clyp – Clipboard Manager")
        .menu(&menu)
        // Left click toggles the popup; right click opens the menu. (Linux
        // shells ignore click events and always show the menu.)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| handle_menu(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                let app = tray.app_handle();
                *app.state::<AppState>().tray_rect.lock().unwrap() = Some(rect);
                windows::toggle_popup(app, Anchor::Tray(rect));
            }
        });

    // macOS wants a monochrome "template" glyph that adapts to light/dark
    // menu bars; Windows and Linux use the full-colour app icon.
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
            .icon_as_template(true);
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(icon) = app.default_window_icon() {
            builder = builder.icon(icon.clone());
        }
    }

    builder.build(app)?;
    Ok(())
}

fn handle_menu(app: &AppHandle, id: &str) {
    match id {
        "tray-open" => {
            let rect = *app.state::<AppState>().tray_rect.lock().unwrap();
            windows::show_popup(app, rect.map(Anchor::Tray).unwrap_or(Anchor::Cursor));
        }
        "tray-settings" | "app-settings" => windows::show_settings(app, None),
        "tray-monitoring" => {
            let enabled = {
                let state = app.state::<AppState>();
                let current = state.store.lock().unwrap().settings().monitoring_enabled;
                !current
            };
            let _ = crate::commands::apply_settings_patch(app, serde_json::json!({ "monitoringEnabled": enabled }));
        }
        "tray-clear" => {
            let history = app.state::<AppState>().store.lock().unwrap().clear_history();
            let _ = app.emit("history-updated", history);
        }
        "tray-devtools" => {
            let target = app
                .webview_windows()
                .into_values()
                .find(|w| w.is_focused().unwrap_or(false))
                .or_else(|| app.get_webview_window(windows::SETTINGS))
                .or_else(|| app.get_webview_window(windows::MAIN));
            if let Some(w) = target {
                if w.is_devtools_open() {
                    w.close_devtools();
                } else {
                    w.open_devtools();
                }
            }
        }
        "tray-quit" => app.exit(0),
        _ => {}
    }
}

/// Standard macOS menu bar (Clyp / Edit / Window). Without an Edit menu the
/// system shortcuts ⌘C ⌘V ⌘A would not work inside the search field.
#[cfg(target_os = "macos")]
pub fn create_app_menu(app: &AppHandle) -> tauri::Result<()> {
    let settings = MenuItem::with_id(app, "app-settings", "Settings…", true, Some("Cmd+,"))?;
    let app_menu = Submenu::with_items(
        app,
        "Clyp",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Clyp"), None)?,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    app.set_menu(Menu::with_items(app, &[&app_menu, &edit, &window])?)?;
    // Only our own ids: tray menu events are handled by the tray's handler.
    app.on_menu_event(|app, event| {
        if event.id().as_ref() == "app-settings" {
            windows::show_settings(app, None);
        }
    });
    Ok(())
}
