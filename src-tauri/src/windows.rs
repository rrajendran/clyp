//! Window creation and placement.
//!
//! * `main` – the clipboard history popup. Frameless, always on top, hidden
//!   from the Dock/taskbar, dismissed on blur. On macOS it gets a native
//!   vibrancy material; on Windows/Linux it is an opaque surface.
//! * `settings` – a regular titled window with platform-appropriate chrome.

use crate::AppState;
use std::time::{Duration, Instant};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Rect, Theme, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

pub const MAIN: &str = "main";
pub const SETTINGS: &str = "settings";

const POPUP_W: f64 = 440.0;
const POPUP_H: f64 = 640.0;
/// Gap between the tray icon and the popup, in logical pixels.
const TRAY_GAP: f64 = 6.0;
/// A tray click that lands this soon after the popup lost focus is the click
/// that *caused* the blur, so it should dismiss rather than re-open.
const BLUR_DEBOUNCE: Duration = Duration::from_millis(300);

pub enum Anchor {
    /// Place next to the given tray icon rectangle.
    Tray(Rect),
    /// Place near the mouse cursor's display (used for the global shortcut).
    Cursor,
}

pub fn create_main(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window(MAIN) {
        return Ok(w);
    }

    let theme = theme_from_setting(&app.state::<AppState>().store.lock().unwrap().settings().theme);

    let mut b = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
        .title("Clyp")
        .theme(theme)
        .inner_size(POPUP_W, POPUP_H)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .shadow(true)
        .focused(true);

    #[cfg(target_os = "macos")]
    {
        b = b.transparent(true).visible_on_all_workspaces(true).accept_first_mouse(true);
    }

    let window = b.build()?;

    #[cfg(target_os = "macos")]
    apply_vibrancy(&window, tauri::window::Effect::Popover);

    let handle = app.clone();
    let w = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Focused(false) = event {
            if w.is_devtools_open() {
                return;
            }
            if w.is_visible().unwrap_or(false) {
                let _ = w.hide();
                *handle.state::<AppState>().last_blur_hide.lock().unwrap() = Some(Instant::now());
                crate::commands::on_popup_hidden(&handle);
            }
        }
    });

    Ok(window)
}

#[cfg(target_os = "macos")]
fn apply_vibrancy(window: &WebviewWindow, effect: tauri::window::Effect) {
    use tauri::window::{EffectState, EffectsBuilder};
    let _ = window.set_effects(
        EffectsBuilder::new()
            .effect(effect)
            .state(EffectState::Active)
            .radius(12.0)
            .build(),
    );
}

pub fn toggle_popup(app: &AppHandle, anchor: Anchor) {
    if let Some(w) = app.get_webview_window(MAIN) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            crate::commands::on_popup_hidden(app);
            return;
        }
    }
    if matches!(anchor, Anchor::Tray(_)) {
        let recently_blurred = app
            .state::<AppState>()
            .last_blur_hide
            .lock()
            .unwrap()
            .map(|t| t.elapsed() < BLUR_DEBOUNCE)
            .unwrap_or(false);
        if recently_blurred {
            return;
        }
    }
    show_popup(app, anchor);
}

pub fn show_popup(app: &AppHandle, anchor: Anchor) {
    let Ok(window) = create_main(app) else { return };

    if let Some(pos) = compute_position(app, &window, &anchor) {
        let _ = window.set_position(pos);
    }
    let _ = window.show();
    let _ = window.set_focus();
}

fn compute_position(
    app: &AppHandle,
    window: &WebviewWindow,
    anchor: &Anchor,
) -> Option<PhysicalPosition<i32>> {
    let size: PhysicalSize<u32> = window.outer_size().ok()?;
    let (w, h) = (size.width as f64, size.height as f64);

    match anchor {
        Anchor::Tray(rect) => {
            // Rect values may be logical or physical; normalise on the
            // monitor the icon lives on.
            let probe = rect.position.to_physical::<f64>(1.0);
            let monitor = window
                .monitor_from_point(probe.x, probe.y)
                .ok()
                .flatten()
                .or_else(|| window.primary_monitor().ok().flatten())?;
            let scale = monitor.scale_factor();
            let pos = rect.position.to_physical::<f64>(scale);
            let sz = rect.size.to_physical::<f64>(scale);
            let area = monitor.work_area();
            let (ax, ay) = (area.position.x as f64, area.position.y as f64);
            let (aw, ah) = (area.size.width as f64, area.size.height as f64);

            let center_x = pos.x + sz.width / 2.0;
            let gap = TRAY_GAP * scale;
            // Menu bar / top taskbar → drop down. Bottom taskbar → pop up.
            let icon_in_top_half = pos.y + sz.height / 2.0 < ay + ah / 2.0;
            let y = if icon_in_top_half {
                pos.y + sz.height + gap
            } else {
                pos.y - h - gap
            };
            Some(clamp(center_x - w / 2.0, y, w, h, ax, ay, aw, ah))
        }
        Anchor::Cursor => {
            let cursor = app.cursor_position().ok();
            let monitor = cursor
                .and_then(|c| window.monitor_from_point(c.x, c.y).ok().flatten())
                .or_else(|| window.primary_monitor().ok().flatten())?;
            let area = monitor.work_area();
            let (ax, ay) = (area.position.x as f64, area.position.y as f64);
            let (aw, ah) = (area.size.width as f64, area.size.height as f64);
            // Horizontally centred, in the upper third – like a launcher.
            let x = ax + (aw - w) / 2.0;
            let y = ay + ((ah - h) * 0.3).max(0.0);
            Some(clamp(x, y, w, h, ax, ay, aw, ah))
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn clamp(x: f64, y: f64, w: f64, h: f64, ax: f64, ay: f64, aw: f64, ah: f64) -> PhysicalPosition<i32> {
    let max_x = (ax + aw - w).max(ax);
    let max_y = (ay + ah - h).max(ay);
    PhysicalPosition::new(x.clamp(ax, max_x).round() as i32, y.clamp(ay, max_y).round() as i32)
}

pub fn hide_popup(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.hide();
    }
}

/// Only plain `a-z` and `/` targets (e.g. `clipboard/pinned`, `general`) are
/// accepted; they end up in a URL and an event payload.
fn clean_target(section: Option<&str>) -> Option<String> {
    section
        .filter(|s| !s.is_empty() && s.len() < 40 && s.chars().all(|c| c.is_ascii_lowercase() || c == '/'))
        .map(String::from)
}

/// Opens (or focuses) the full window: clipboard views + settings in one
/// sidebar layout. `section` picks the landing page.
pub fn show_settings(app: &AppHandle, section: Option<&str>) {
    hide_popup(app);
    let target = clean_target(section);

    if let Some(w) = app.get_webview_window(SETTINGS) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        if let Some(t) = &target {
            let _ = app.emit_to(SETTINGS, "navigate", t);
        }
        return;
    }

    let url = match &target {
        Some(t) => format!("settings.html?go={t}"),
        None => "settings.html".to_string(),
    };

    let theme = theme_from_setting(&app.state::<AppState>().store.lock().unwrap().settings().theme);

    #[allow(unused_mut)]
    let mut b = WebviewWindowBuilder::new(app, SETTINGS, WebviewUrl::App(url.into()))
        .title("Clyp")
        .inner_size(980.0, 680.0)
        .min_inner_size(520.0, 420.0)
        .resizable(true)
        .center()
        .theme(theme);

    #[cfg(target_os = "macos")]
    {
        // Unified, transparent title bar with a vibrant sidebar, as in
        // System Settings. The page reserves room for the traffic lights.
        b = b
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .transparent(true);
    }

    if let Ok(window) = b.build() {
        #[cfg(target_os = "macos")]
        apply_vibrancy(&window, tauri::window::Effect::Sidebar);
        let _ = window.set_focus();
    }
}

pub fn theme_from_setting(theme: &str) -> Option<Theme> {
    match theme {
        "light" => Some(Theme::Light),
        "dark" => Some(Theme::Dark),
        _ => None,
    }
}

/// Make native chrome (title bars, vibrancy materials) follow the chosen
/// appearance. `None` hands control back to the OS.
pub fn apply_theme(app: &AppHandle, theme: &str) {
    let t = theme_from_setting(theme);
    for (_, w) in app.webview_windows() {
        let _ = w.set_theme(t);
    }
}
