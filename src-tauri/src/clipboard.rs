//! Clipboard polling + writing.
//!
//! Port of the former Electron `ClipboardMonitor`. The OS clipboard is polled
//! on a background thread; new content is hashed to avoid re-adding the same
//! thing every tick, then handed to the [`Store`](crate::storage::Store).

use crate::storage::{ImageSize, Item};
use crate::AppState;
use arboard::Clipboard;
use base64::Engine;
use serde_json::Value;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const POLL_INTERVAL: Duration = Duration::from_millis(500);
const MAX_PREVIEW_LENGTH: usize = 100;
const OWN_WRITE_GRACE: Duration = Duration::from_secs(3);

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/// Collapse runs of whitespace and trim.
pub fn normalize_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Remove `<...>` tags. Good enough for building previews / dedupe keys.
pub fn strip_html(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.trim().to_string()
}

pub fn generate_preview(text: &str) -> String {
    let cleaned = normalize_text(text);
    if cleaned.chars().count() <= MAX_PREVIEW_LENGTH {
        cleaned
    } else {
        let head: String = cleaned.chars().take(MAX_PREVIEW_LENGTH).collect();
        format!("{head}...")
    }
}

fn quick_hash(kind: &str, bytes: &[u8]) -> u64 {
    // Large buffers (images) are sampled rather than fully hashed; the poll
    // loop runs twice a second so this has to stay cheap.
    let mut h = DefaultHasher::new();
    kind.hash(&mut h);
    bytes.len().hash(&mut h);
    let stride = (bytes.len() / 65_536).max(1);
    for b in bytes.iter().step_by(stride) {
        b.hash(&mut h);
    }
    h.finish()
}

pub fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// What the UI asks us to put on the clipboard.
#[derive(Debug, Default, PartialEq)]
pub struct Payload {
    pub text: Option<String>,
    pub html: Option<String>,
    /// A `data:image/...;base64,` URL (an image item from history).
    pub image: Option<String>,
}

impl Payload {
    pub fn from_value(v: &Value) -> Payload {
        match v {
            Value::String(s) => Payload { text: Some(s.clone()), ..Default::default() },
            Value::Object(o) => {
                let get = |k: &str| {
                    o.get(k)
                        .and_then(|x| x.as_str())
                        .filter(|s| !s.is_empty())
                        .map(String::from)
                };
                Payload { text: get("text"), html: get("html"), image: get("image") }
            }
            other => Payload { text: Some(other.to_string()), ..Default::default() },
        }
    }

    /// If the HTML carries styling / syntax-highlighting markup, pasting it
    /// into a rich editor would drag that DOM along. Swap the HTML flavour for
    /// a plain `<pre>` of the source text instead.
    pub fn html_flavour(&self) -> Option<String> {
        let html = self.html.as_ref()?;
        let styled = html.contains("<span") || html.contains("style=") || html.contains("class=");
        if styled {
            let source = self.text.as_deref().unwrap_or(html);
            Some(format!(
                "<pre style=\"white-space: pre-wrap; font-family: Menlo, Monaco, 'Courier New', monospace;\">{}</pre>",
                escape_html(source)
            ))
        } else {
            Some(html.clone())
        }
    }
}

/// Decode a `data:image/...;base64,` URL into RGBA pixels.
pub fn decode_data_url(url: &str) -> Result<(u32, u32, Vec<u8>), String> {
    let (_, b64) = url.split_once(',').ok_or("not a data URL")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("bad base64: {e}"))?;
    let img = image::load_from_memory(&bytes).map_err(|e| format!("bad image: {e}"))?.to_rgba8();
    Ok((img.width(), img.height(), img.into_raw()))
}

/// Returns `true` when an image was written (so the caller can tell the
/// monitor not to re-capture it).
pub fn write_payload(payload: &Payload) -> Result<bool, String> {
    let mut cb = Clipboard::new().map_err(|e| e.to_string())?;
    if let Some(url) = &payload.image {
        let (width, height, bytes) = decode_data_url(url)?;
        cb.set_image(arboard::ImageData {
            width: width as usize,
            height: height as usize,
            bytes: std::borrow::Cow::Owned(bytes),
        })
        .map_err(|e| e.to_string())?;
        return Ok(true);
    }
    match payload.html_flavour() {
        Some(html) => cb.set_html(html, payload.text.clone()),
        None => cb.set_text(payload.text.clone().unwrap_or_default()),
    }
    .map_err(|e| e.to_string())?;
    Ok(false)
}

/// True when the clipboard still holds exactly what `payload` wrote.
pub fn clipboard_matches(payload: &Payload) -> bool {
    let Ok(mut cb) = Clipboard::new() else { return false };
    match &payload.text {
        Some(t) => cb.get_text().map(|cur| &cur == t).unwrap_or(false),
        None => false,
    }
}

pub fn clear() {
    if let Ok(mut cb) = Clipboard::new() {
        let _ = cb.clear();
    }
}

// ---------------------------------------------------------------------------
// Monitor
// ---------------------------------------------------------------------------

/// Distinguishes items captured in the same millisecond (text + image from a
/// single copy).
static ITEM_SEQ: AtomicU64 = AtomicU64::new(0);

pub struct Monitor {
    running: AtomicBool,
    generation: AtomicU64,
    /// Last seen signature per kind ("text", "image", "html", "file"), so the
    /// same clipboard content is not re-added every tick. Text and images are
    /// tracked independently: apps often put both on the clipboard at once.
    last: Mutex<HashMap<&'static str, u64>>,
    /// After Clyp writes an image, reading it back may differ slightly from the
    /// stored PNG (alpha handling). Until this instant, observed images are only
    /// recorded as "seen", never added as new items.
    own_image_until: Mutex<Option<Instant>>,
}

impl Monitor {
    pub fn new() -> Arc<Self> {
        Arc::new(Monitor {
            running: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            last: Mutex::new(HashMap::new()),
            own_image_until: Mutex::new(None),
        })
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
        self.generation.fetch_add(1, Ordering::SeqCst);
    }

    pub fn start(self: &Arc<Self>, app: AppHandle) {
        if self.running.swap(true, Ordering::SeqCst) {
            return;
        }
        self.last.lock().unwrap().clear();
        let gen = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let me = Arc::clone(self);

        std::thread::Builder::new()
            .name("clyp-clipboard-monitor".into())
            .spawn(move || {
                let mut cb: Option<Clipboard> = None;
                while me.generation.load(Ordering::SeqCst) == gen {
                    std::thread::sleep(POLL_INTERVAL);
                    if cb.is_none() {
                        cb = Clipboard::new().ok();
                    }
                    if let Some(c) = cb.as_mut() {
                        me.check(&app, c);
                    }
                }
            })
            .expect("failed to spawn clipboard monitor thread");
    }

    /// `true` when `hash` differs from what we last saw for `kind`.
    fn changed(&self, kind: &'static str, hash: u64) -> bool {
        self.last.lock().unwrap().insert(kind, hash) != Some(hash)
    }

    /// The `kind` is no longer on the clipboard: forget it so copying the same
    /// thing again later is noticed.
    fn clear_seen(&self, kind: &'static str) {
        self.last.lock().unwrap().remove(kind);
    }

    /// Call right after Clyp itself writes `text` to the clipboard so the
    /// monitor does not capture Clyp's own write as a new item.
    pub fn mark_own_text(&self, text: &str) {
        self.last.lock().unwrap().insert("text", quick_hash("text", normalize_text(text).as_bytes()));
    }

    /// Call right after Clyp itself writes an image to the clipboard.
    pub fn mark_own_image(&self) {
        *self.own_image_until.lock().unwrap() = Some(Instant::now() + OWN_WRITE_GRACE);
    }

    fn own_image_write_active(&self) -> bool {
        self.own_image_until.lock().unwrap().map(|t| Instant::now() < t).unwrap_or(false)
    }

    fn check(&self, app: &AppHandle, cb: &mut Clipboard) {
        let state = app.state::<AppState>();
        let settings = state.store.lock().unwrap().settings();
        let max_bytes = (settings.max_content_size_mb * 1024.0 * 1024.0) as usize;
        let too_big = |len: usize| max_bytes > 0 && len > max_bytes;

        // Copying files in a file manager also offers an icon image: do not
        // record that as an "image".
        let has_files = cb.get().file_list().map(|f| !f.is_empty()).unwrap_or(false);

        // 1. Text.
        let mut has_text = false;
        match cb.get_text() {
            Ok(text) if !text.is_empty() => {
                has_text = true;
                if settings.capture_text && !too_big(text.len())
                    && self.changed("text", quick_hash("text", normalize_text(&text).as_bytes()))
                {
                    let preview = generate_preview(&text);
                    self.add(app, "text", text, preview, None);
                }
            }
            _ => self.clear_seen("text"),
        }

        // 2. Image – checked even when text is present (screenshots tools,
        //    browsers and chat apps often provide both).
        let mut has_image = false;
        if !has_files {
            match cb.get_image() {
                Ok(img) if !img.bytes.is_empty() => {
                    has_image = true;
                    let (w, h) = (img.width as u32, img.height as u32);
                    let sig = quick_hash(&format!("image{w}x{h}"), &img.bytes);
                    if self.own_image_write_active() {
                        self.last.lock().unwrap().insert("image", sig); // seen, but not new
                    } else if settings.capture_images && self.changed("image", sig) {
                        if let Some(png) = encode_png(&img.bytes, w, h) {
                            if !too_big(png.len()) {
                                let data_url = format!(
                                    "data:image/png;base64,{}",
                                    base64::engine::general_purpose::STANDARD.encode(&png)
                                );
                                self.add(
                                    app,
                                    "image",
                                    data_url,
                                    format!("Image ({w}x{h})"),
                                    Some(ImageSize { width: w, height: h }),
                                );
                            } else {
                                eprintln!("clyp: image {w}x{h} ({} KB) exceeds the size limit, skipped", png.len() / 1024);
                            }
                        }
                    }
                }
                _ => self.clear_seen("image"),
            }
        } else {
            self.clear_seen("image");
        }

        // 3. HTML that came without plain text or an image.
        if !has_text && !has_image {
            match cb.get().html() {
                Ok(html) if !html.is_empty() => {
                    if settings.capture_rich_text && !too_big(html.len())
                        && self.changed("html", quick_hash("html", html.as_bytes()))
                    {
                        let visible = normalize_text(&strip_html(&html));
                        self.add(app, "html", html, generate_preview(&visible), None);
                    }
                }
                _ => self.clear_seen("html"),
            }
        }

        // 4. File references.
        if has_files && settings.capture_files {
            if let Ok(files) = cb.get().file_list() {
                let paths: Vec<String> =
                    files.iter().map(|p| p.to_string_lossy().into_owned()).collect();
                let joined = paths.join("\n");
                if !joined.is_empty() && self.changed("file", quick_hash("file", joined.as_bytes())) {
                    let first = paths
                        .first()
                        .and_then(|p| std::path::Path::new(p).file_name())
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_else(|| "File".into());
                    let preview = if paths.len() > 1 {
                        format!("{first} (+{} more)", paths.len() - 1)
                    } else {
                        first
                    };
                    self.add(app, "file", joined, preview, None);
                }
            }
        } else if !has_files {
            self.clear_seen("file");
        }
    }

    fn add(&self, app: &AppHandle, kind: &str, content: String, preview: String, size: Option<ImageSize>) {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let item = Item {
            // Unique even for two items captured in the same millisecond.
            id: format!("{}_{:x}", timestamp, ITEM_SEQ.fetch_add(1, Ordering::SeqCst)),
            timestamp,
            kind: kind.into(),
            content,
            preview,
            size,
            pinned: false,
            tags: vec![],
            content_hash: None,
        };
        let state = app.state::<AppState>();
        let (added, history) = {
            let mut store = state.store.lock().unwrap();
            let added = store.add_item(item);
            (added, store.history())
        };
        if added {
            let _ = app.emit("history-updated", history);
        }
    }
}

fn encode_png(rgba: &[u8], w: u32, h: u32) -> Option<Vec<u8>> {
    use image::codecs::png::PngEncoder;
    use image::{ExtendedColorType, ImageEncoder};
    let mut out = Vec::new();
    PngEncoder::new(&mut out)
        .write_image(rgba, w, h, ExtendedColorType::Rgba8)
        .ok()?;
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn preview_collapses_whitespace_and_truncates() {
        assert_eq!(generate_preview("  a \n\t b  "), "a b");
        let long = "x".repeat(250);
        let p = generate_preview(&long);
        assert_eq!(p.chars().count(), MAX_PREVIEW_LENGTH + 3);
        assert!(p.ends_with("..."));
    }

    #[test]
    fn preview_is_utf8_safe() {
        let s = "é".repeat(300);
        assert!(generate_preview(&s).starts_with("éé"));
    }

    #[test]
    fn strips_tags() {
        assert_eq!(strip_html("<p>Hello <b>world</b></p>"), "Hello world");
        assert_eq!(strip_html("1 < 2"), "1");
    }

    #[test]
    fn payload_parses_strings_and_objects() {
        assert_eq!(Payload::from_value(&json!("hi")).text.as_deref(), Some("hi"));
        let p = Payload::from_value(&json!({ "html": "<b>x</b>", "text": "x" }));
        assert_eq!(p.html.as_deref(), Some("<b>x</b>"));
        assert_eq!(p.text.as_deref(), Some("x"));
    }

    #[test]
    fn styled_html_becomes_escaped_pre() {
        let p = Payload { html: Some("<span style=\"color:red\">a<b</span>".into()), text: Some("a<b".into()), ..Default::default() };
        let out = p.html_flavour().unwrap();
        assert!(out.starts_with("<pre"));
        assert!(out.contains("a&lt;b"));
        assert!(!out.contains("<span"));
    }

    #[test]
    fn plain_html_passes_through() {
        let p = Payload { html: Some("<b>x</b>".into()), ..Default::default() };
        assert_eq!(p.html_flavour().as_deref(), Some("<b>x</b>"));
    }

    #[test]
    fn payload_carries_image_data_urls() {
        let p = Payload::from_value(&json!({ "image": "data:image/png;base64,AAAA" }));
        assert_eq!(p.image.as_deref(), Some("data:image/png;base64,AAAA"));
        assert!(p.text.is_none() && p.html.is_none());
    }

    #[test]
    fn image_data_url_round_trips_to_pixels() {
        // 2x1 image: red, then semi-transparent blue.
        let rgba = vec![255, 0, 0, 255, 0, 0, 255, 128];
        let png = encode_png(&rgba, 2, 1).unwrap();
        let url = format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(&png));
        let (w, h, px) = decode_data_url(&url).unwrap();
        assert_eq!((w, h), (2, 1));
        assert_eq!(px, rgba);
    }

    #[test]
    fn bad_data_urls_are_rejected() {
        assert!(decode_data_url("not a url").is_err());
        assert!(decode_data_url("data:image/png;base64,@@@").is_err());
        assert!(decode_data_url("data:image/png;base64,AAAA").is_err()); // valid base64, not an image
    }

    /// Touches the real system clipboard, so it only runs on request:
    /// `cargo test -- --ignored clipboard_image_round_trip`
    #[test]
    #[ignore]
    fn clipboard_image_round_trip() {
        let rgba: Vec<u8> = (0..16 * 16).flat_map(|i| [(i % 256) as u8, 40, 200, 255]).collect();
        let png = encode_png(&rgba, 16, 16).unwrap();
        let url = format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(&png));
        let wrote_image = write_payload(&Payload { image: Some(url), ..Default::default() }).unwrap();
        assert!(wrote_image);
        let back = Clipboard::new().unwrap().get_image().unwrap();
        assert_eq!((back.width, back.height), (16, 16));
        println!("pixels identical after round trip: {}", back.bytes.as_ref() == rgba.as_slice());
    }

    #[test]
    fn own_image_write_window_expires() {
        let m = Monitor::new();
        assert!(!m.own_image_write_active());
        m.mark_own_image();
        assert!(m.own_image_write_active());
    }

    #[test]
    fn text_and_image_are_tracked_independently() {
        let m = Monitor::new();
        assert!(m.changed("text", 1));
        assert!(m.changed("image", 1), "same value, different kind, is still new");
        assert!(!m.changed("text", 1));
        assert!(!m.changed("image", 1));
        assert!(m.changed("text", 2));
        assert!(!m.changed("image", 1), "changing text does not reset the image");
    }

    #[test]
    fn forgetting_a_kind_lets_the_same_content_be_captured_again() {
        let m = Monitor::new();
        assert!(m.changed("image", 7));
        m.clear_seen("image");
        assert!(m.changed("image", 7));
    }

    #[test]
    fn own_writes_are_not_recaptured() {
        let m = Monitor::new();
        m.mark_own_text("  hello\n world ");
        assert!(!m.changed("text", quick_hash("text", normalize_text("hello world").as_bytes())));
    }

    #[test]
    fn quick_hash_distinguishes_content_and_kind() {
        assert_ne!(quick_hash("text", b"a"), quick_hash("text", b"b"));
        assert_ne!(quick_hash("text", b"a"), quick_hash("html", b"a"));
        assert_eq!(quick_hash("text", b"a"), quick_hash("text", b"a"));
    }
}
