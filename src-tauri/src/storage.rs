//! Persistent clipboard history + settings.
//!
//! Port of the former Electron `StorageManager`. Data lives in a single JSON
//! file (`clyp-data.json`) shaped as `{ "history": [...], "settings": {...} }`,
//! which is the same layout `electron-store` produced, so existing user data
//! can be imported as-is.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ImageSize {
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub timestamp: i64,
    #[serde(rename = "type")]
    pub kind: String,
    pub content: String,
    #[serde(default)]
    pub preview: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<ImageSize>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub max_history_size: u32,
    #[serde(rename = "maxContentSizeMB")]
    pub max_content_size_mb: f64,
    pub monitoring_enabled: bool,
    pub capture_text: bool,
    pub capture_rich_text: bool,
    pub capture_images: bool,
    pub capture_files: bool,
    pub start_on_boot: bool,
    /// `system`, `light` or `dark`.
    pub theme: String,
    pub shortcut: String,
    pub auto_delete_history: bool,
    pub auto_delete_days: u32,
    pub delete_pinned_items: bool,
    pub hide_dock_icon: bool,
    pub developer_tools: bool,
}

pub fn default_shortcut() -> String {
    if cfg!(target_os = "macos") {
        "Command+Shift+V".into()
    } else {
        "Control+Shift+V".into()
    }
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            max_history_size: 100,
            max_content_size_mb: 5.0,
            monitoring_enabled: true,
            capture_text: true,
            capture_rich_text: true,
            capture_images: true,
            capture_files: false,
            start_on_boot: false,
            theme: "system".into(),
            shortcut: default_shortcut(),
            auto_delete_history: false,
            auto_delete_days: 30,
            delete_pinned_items: false,
            hide_dock_icon: false,
            developer_tools: false,
        }
    }
}

impl Settings {
    /// Clamp / repair values that came from disk or the UI.
    fn sanitize(&mut self) {
        // Older builds shipped extra themes (e.g. "spring-glass").
        if !matches!(self.theme.as_str(), "system" | "light" | "dark") {
            self.theme = "system".into();
        }
        if self.max_history_size == 0 {
            self.max_history_size = 100;
        }
        if self.auto_delete_days == 0 {
            self.auto_delete_days = 30;
        }
        if !self.max_content_size_mb.is_finite() || self.max_content_size_mb < 0.0 {
            self.max_content_size_mb = 5.0;
        }
        if self.shortcut.trim().is_empty() {
            self.shortcut = default_shortcut();
        }
    }
}

#[derive(Serialize, Deserialize, Default)]
struct Disk {
    #[serde(default)]
    history: Vec<Value>,
    #[serde(default)]
    settings: Value,
}

pub struct Store {
    path: Option<PathBuf>,
    history: Vec<Item>,
    settings: Settings,
}

/// Text that is really an image's `data:` URL. Older builds copied image items
/// back to the clipboard as this text, and the monitor then recorded it.
fn is_image_data_url_text(item: &Item) -> bool {
    item.kind == "text"
        && item.content.trim_start().starts_with("data:image/")
        && item.content.contains(";base64,")
}

pub fn content_hash(content: &str, kind: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("{}:{}", kind, content.trim()).as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect()
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl Store {
    /// In-memory store that never touches disk (used by tests).
    pub fn in_memory() -> Self {
        Store {
            path: None,
            history: Vec::new(),
            settings: Settings::default(),
        }
    }

    /// Load from `path`; if it does not exist yet, import `legacy` (the old
    /// Electron data file) when present.
    pub fn load(path: PathBuf, legacy: Option<PathBuf>) -> Self {
        let source = if path.exists() {
            Some(path.clone())
        } else {
            legacy.filter(|p| p.exists())
        };

        let mut store = Store {
            path: Some(path.clone()),
            history: Vec::new(),
            settings: Settings::default(),
        };

        if let Some(src) = source {
            match fs::read_to_string(&src)
                .ok()
                .and_then(|s| serde_json::from_str::<Disk>(&s).ok())
            {
                Some(disk) => {
                    store.history = disk
                        .history
                        .into_iter()
                        .filter_map(|v| serde_json::from_value::<Item>(v).ok())
                        .filter(|i| !i.content.is_empty() && !i.kind.is_empty())
                        // Drop base64 artifacts of the old image-copy bug (large
                        // data URLs; short ones are legitimate copied text).
                        .filter(|i| !(is_image_data_url_text(i) && i.content.len() > 2000))
                        .collect();
                    if disk.settings.is_object() {
                        store.settings = serde_json::from_value(disk.settings).unwrap_or_default();
                    }
                    store.settings.sanitize();
                }
                None => {
                    eprintln!("clyp: could not parse {}, starting fresh", src.display());
                    if src == path {
                        let _ = fs::rename(&src, src.with_extension("json.bak"));
                    }
                }
            }
            store.save();
        }
        store
    }

    fn save(&self) {
        let Some(path) = &self.path else { return };
        let disk = serde_json::json!({ "history": self.history, "settings": self.settings });
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        // Write-then-rename so a crash never leaves a half-written file.
        let tmp = path.with_extension("json.tmp");
        match serde_json::to_vec(&disk) {
            Ok(bytes) => {
                if fs::write(&tmp, bytes).and_then(|_| fs::rename(&tmp, path)).is_err() {
                    eprintln!("clyp: failed to write {}", path.display());
                }
            }
            Err(e) => eprintln!("clyp: failed to serialise store: {e}"),
        }
    }

    pub fn history(&self) -> Vec<Item> {
        self.history.clone()
    }

    pub fn settings(&self) -> Settings {
        self.settings.clone()
    }

    /// Returns `true` when the item was added (i.e. was not a duplicate).
    pub fn add_item(&mut self, mut item: Item) -> bool {
        if item.content.is_empty() || item.kind.is_empty() {
            return false;
        }
        // Never record the base64 text form of an image we already hold: that
        // is Clyp's own copy of its own history item.
        if is_image_data_url_text(&item)
            && self.history.iter().any(|i| i.kind == "image" && i.content.trim() == item.content.trim())
        {
            return false;
        }
        let hash = content_hash(&item.content, &item.kind);
        let duplicate = self.history.iter().any(|existing| {
            (existing.content == item.content && existing.kind == item.kind)
                || content_hash(&existing.content, &existing.kind) == hash
        });
        if duplicate {
            return false;
        }
        item.content_hash = Some(hash);
        self.history.insert(0, item);

        // Enforce max size, keeping pinned items (pinned first).
        let max = self.settings.max_history_size as usize;
        let (pinned, mut unpinned): (Vec<Item>, Vec<Item>) =
            self.history.drain(..).partition(|i| i.pinned);
        unpinned.truncate(max);
        self.history = pinned.into_iter().chain(unpinned).collect();

        if self.settings.auto_delete_history && self.settings.auto_delete_days > 0 {
            let cutoff = now_ms() - self.settings.auto_delete_days as i64 * 24 * 60 * 60 * 1000;
            self.history.retain(|i| i.pinned || i.timestamp > cutoff);
        }
        self.save();
        true
    }

    /// Pinned items cannot be deleted.
    pub fn delete_item(&mut self, id: &str) -> Vec<Item> {
        if let Some(item) = self.history.iter().find(|i| i.id == id) {
            if item.pinned {
                return self.history();
            }
        }
        self.history.retain(|i| i.id != id);
        self.save();
        self.history()
    }

    pub fn toggle_pin(&mut self, id: &str) -> Vec<Item> {
        if let Some(item) = self.history.iter_mut().find(|i| i.id == id) {
            item.pinned = !item.pinned;
            self.save();
        }
        self.history()
    }

    pub fn clear_history(&mut self) -> Vec<Item> {
        if self.settings.delete_pinned_items {
            self.history.clear();
        } else {
            self.history.retain(|i| i.pinned);
        }
        self.save();
        self.history()
    }

    /// Merge a partial settings object (as sent by the UI) into the settings.
    pub fn update_settings(&mut self, patch: &Value) -> Result<Settings, String> {
        let mut merged = serde_json::to_value(&self.settings).map_err(|e| e.to_string())?;
        if let (Some(base), Some(new)) = (merged.as_object_mut(), patch.as_object()) {
            for (k, v) in new {
                base.insert(k.clone(), v.clone());
            }
        }
        let mut next: Settings = serde_json::from_value(merged).map_err(|e| e.to_string())?;
        next.sanitize();

        let old_max = self.settings.max_history_size;
        self.settings = next;
        if self.settings.max_history_size != old_max {
            self.trim_history();
        }
        self.save();
        Ok(self.settings())
    }

    fn trim_history(&mut self) {
        let max = self.settings.max_history_size as usize;
        let (pinned, mut unpinned): (Vec<Item>, Vec<Item>) =
            self.history.drain(..).partition(|i| i.pinned);
        unpinned.truncate(max);
        self.history = pinned.into_iter().chain(unpinned).collect();
    }

    pub fn add_tag(&mut self, id: &str, tag: &str) -> Vec<Item> {
        let tag = tag.trim();
        if tag.is_empty() {
            return self.history();
        }
        if let Some(item) = self.history.iter_mut().find(|i| i.id == id) {
            if !item.tags.iter().any(|t| t == tag) {
                item.tags.push(tag.to_string());
                self.save();
            }
        }
        self.history()
    }

    pub fn remove_tag(&mut self, id: &str, tag: &str) -> Vec<Item> {
        if let Some(item) = self.history.iter_mut().find(|i| i.id == id) {
            item.tags.retain(|t| t != tag);
            self.save();
        }
        self.history()
    }

    pub fn all_tags(&self) -> Vec<String> {
        let set: BTreeSet<&String> = self.history.iter().flat_map(|i| i.tags.iter()).collect();
        set.into_iter().cloned().collect()
    }

    pub fn remove_duplicates(&mut self) -> Vec<Item> {
        let mut seen = std::collections::HashSet::new();
        let mut unique = Vec::with_capacity(self.history.len());
        for mut item in self.history.drain(..) {
            let hash = content_hash(&item.content, &item.kind);
            if seen.insert(hash.clone()) {
                item.content_hash.get_or_insert(hash);
                unique.push(item);
            }
        }
        self.history = unique;
        self.save();
        self.history()
    }

    /// Wipe history and reset settings to defaults.
    pub fn clear_all_data(&mut self) {
        self.history.clear();
        self.settings = Settings::default();
        self.save();
    }

    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn item(id: &str, content: &str) -> Item {
        Item {
            id: id.into(),
            timestamp: now_ms(),
            kind: "text".into(),
            content: content.into(),
            preview: content.into(),
            size: None,
            pinned: false,
            tags: vec![],
            content_hash: None,
        }
    }

    #[test]
    fn adds_newest_first_and_skips_duplicates() {
        let mut s = Store::in_memory();
        assert!(s.add_item(item("1", "hello")));
        assert!(s.add_item(item("2", "world")));
        assert!(!s.add_item(item("3", "  hello  ")), "whitespace-normalised duplicate");
        let h = s.history();
        assert_eq!(h.len(), 2);
        assert_eq!(h[0].content, "world");
        assert!(h[0].content_hash.is_some());
    }

    fn image_item(id: &str, url: &str) -> Item {
        Item { kind: "image".into(), ..item(id, url) }
    }

    #[test]
    fn base64_text_of_an_existing_image_is_not_recorded() {
        let mut s = Store::in_memory();
        let url = "data:image/png;base64,iVBORw0KGgo=";
        assert!(s.add_item(image_item("1", url)));
        assert!(!s.add_item(item("2", url)), "own base64 text must not become a history item");
        assert!(!s.add_item(item("3", &format!("  {url}\n"))), "even with surrounding whitespace");
        assert_eq!(s.history().len(), 1);
    }

    #[test]
    fn unrelated_data_url_text_is_still_recorded() {
        let mut s = Store::in_memory();
        s.add_item(image_item("1", "data:image/png;base64,AAAA"));
        assert!(s.add_item(item("2", "data:image/png;base64,BBBB")), "text the user copied elsewhere");
    }

    #[test]
    fn load_removes_base64_artifacts_but_keeps_small_data_urls() {
        let dir = std::env::temp_dir().join(format!("clyp-test-b64-{}", now_ms()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("clyp-data.json");
        let big = format!("data:image/png;base64,{}", "A".repeat(5000));
        fs::write(&file, json!({ "history": [
            {"id":"1","timestamp":3,"type":"text","content":big,"preview":"data:image","pinned":false,"tags":[]},
            {"id":"2","timestamp":2,"type":"text","content":"data:image/png;base64,AAAA","preview":"x","pinned":false,"tags":[]},
            {"id":"3","timestamp":1,"type":"text","content":"hello","preview":"hello","pinned":false,"tags":[]}
        ], "settings": {} }).to_string()).unwrap();
        let s = Store::load(file, None);
        let ids: Vec<_> = s.history().into_iter().map(|i| i.id).collect();
        assert_eq!(ids, vec!["2", "3"]);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn same_content_different_type_is_not_a_duplicate() {
        let mut s = Store::in_memory();
        assert!(s.add_item(item("1", "<b>x</b>")));
        let mut html = item("2", "<b>x</b>");
        html.kind = "html".into();
        assert!(s.add_item(html));
    }

    #[test]
    fn enforces_max_size_but_keeps_pinned() {
        let mut s = Store::in_memory();
        s.update_settings(&json!({ "maxHistorySize": 2 })).unwrap();
        s.add_item(item("1", "a"));
        s.toggle_pin("1");
        for (i, c) in ["b", "c", "d"].iter().enumerate() {
            s.add_item(item(&format!("x{i}"), c));
        }
        let h = s.history();
        assert_eq!(h.len(), 3, "1 pinned + 2 newest unpinned");
        assert!(h[0].pinned);
        assert_eq!(h[1].content, "d");
        assert_eq!(h[2].content, "c");
    }

    #[test]
    fn pinned_items_cannot_be_deleted() {
        let mut s = Store::in_memory();
        s.add_item(item("1", "a"));
        s.toggle_pin("1");
        assert_eq!(s.delete_item("1").len(), 1);
        s.toggle_pin("1");
        assert_eq!(s.delete_item("1").len(), 0);
    }

    #[test]
    fn clear_history_respects_delete_pinned_setting() {
        let mut s = Store::in_memory();
        s.add_item(item("1", "a"));
        s.add_item(item("2", "b"));
        s.toggle_pin("1");
        assert_eq!(s.clear_history().len(), 1);
        s.update_settings(&json!({ "deletePinnedItems": true })).unwrap();
        assert_eq!(s.clear_history().len(), 0);
    }

    #[test]
    fn tags_are_unique_sorted_and_trimmed() {
        let mut s = Store::in_memory();
        s.add_item(item("1", "a"));
        s.add_item(item("2", "b"));
        s.add_tag("1", "work");
        s.add_tag("1", "work");
        s.add_tag("2", " alpha ");
        s.add_tag("2", "   ");
        assert_eq!(s.all_tags(), vec!["alpha", "work"]);
        s.remove_tag("1", "work");
        assert_eq!(s.all_tags(), vec!["alpha"]);
    }

    #[test]
    fn settings_merge_and_repair() {
        let mut s = Store::in_memory();
        let out = s
            .update_settings(&json!({ "theme": "spring-glass", "captureFiles": true, "bogus": 1 }))
            .unwrap();
        assert_eq!(out.theme, "system", "unknown themes fall back to system");
        assert!(out.capture_files);
        let out = s.update_settings(&json!({ "theme": "dark", "maxContentSizeMB": 12 })).unwrap();
        assert_eq!(out.theme, "dark");
        assert_eq!(out.max_content_size_mb, 12.0);
        assert!(s.update_settings(&json!({ "maxHistorySize": "lots" })).is_err());
    }

    #[test]
    fn shrinking_max_history_trims_immediately() {
        let mut s = Store::in_memory();
        for i in 0..5 {
            s.add_item(item(&i.to_string(), &format!("item {i}")));
        }
        s.update_settings(&json!({ "maxHistorySize": 2 })).unwrap();
        assert_eq!(s.history().len(), 2);
    }

    #[test]
    fn loads_legacy_electron_store_file() {
        let dir = std::env::temp_dir().join(format!("clyp-test-{}", now_ms()));
        fs::create_dir_all(&dir).unwrap();
        let legacy = dir.join("legacy.json");
        fs::write(
            &legacy,
            json!({
                "history": [
                    {"id":"1","timestamp":1,"type":"text","content":"hi","preview":"hi","pinned":false,"tags":["t"],"contentHash":"abc"},
                    {"bogus": true}
                ],
                "settings": {"theme":"spring-glass","springGlassTransparency":65,"maxHistorySize":50,"shortcut":"CommandOrControl+Shift+V"}
            })
            .to_string(),
        )
        .unwrap();
        let target = dir.join("clyp-data.json");
        let s = Store::load(target.clone(), Some(legacy));
        assert_eq!(s.history().len(), 1);
        assert_eq!(s.settings().max_history_size, 50);
        assert_eq!(s.settings().theme, "system");
        assert!(target.exists(), "imported data is persisted at the new location");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn remove_duplicates_keeps_first_occurrence() {
        let mut s = Store::in_memory();
        s.history = vec![item("1", "a"), item("2", "a "), item("3", "b")];
        let out = s.remove_duplicates();
        assert_eq!(out.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), vec!["1", "3"]);
    }
}
