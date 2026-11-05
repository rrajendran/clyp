//! Lightweight update check against GitHub Releases.
//!
//! Clyp does not self-install; it tells the user a newer version exists and
//! opens the matching installer download in the browser.
//!
//! The logic is split so each part can be tested without a network:
//! [`is_newer`] (versions), [`pick_asset`] (installer for an OS/CPU),
//! [`parse_release`] (API JSON → [`UpdateInfo`]) and [`check_at`] (HTTP).

use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

const OWNER: &str = "rrajendran";
const REPO: &str = "clyp";
const TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub version: String,
    pub release_notes: String,
    pub release_date: String,
    /// Direct installer URL for this platform, or the release page.
    pub download_url: String,
}

/// The OS / CPU an installer must match.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Platform {
    pub os: &'static str,   // "macos" | "windows" | "linux"
    pub arch: &'static str, // "aarch64" | "x86_64"
}

impl Platform {
    pub fn current() -> Self {
        Platform {
            os: if cfg!(target_os = "macos") {
                "macos"
            } else if cfg!(target_os = "windows") {
                "windows"
            } else {
                "linux"
            },
            arch: if cfg!(target_arch = "aarch64") { "aarch64" } else { "x86_64" },
        }
    }
}

fn parse_version(v: &str) -> Vec<u64> {
    v.trim()
        .trim_start_matches('v')
        .split(['.', '-', '+'])
        .map_while(|p| p.parse::<u64>().ok())
        .collect()
}

pub fn is_newer(latest: &str, current: &str) -> bool {
    let (a, b) = (parse_version(latest), parse_version(current));
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x > y;
        }
    }
    false
}

/// Pick the installer asset that suits `platform`. Assets are `(name, url)`.
pub fn pick_asset(assets: &[(String, String)], platform: Platform) -> Option<String> {
    let arm = platform.arch == "aarch64";
    let is_arm_name = |n: &str| n.contains("aarch64") || n.contains("arm64");
    let find = |pred: &dyn Fn(&str) -> bool| {
        assets
            .iter()
            .find(|(name, _)| pred(&name.to_lowercase()))
            .map(|(_, url)| url.clone())
    };
    match platform.os {
        "macos" => find(&|n| n.ends_with(".dmg") && is_arm_name(n) == arm),
        "windows" => find(&|n| n.ends_with("-setup.exe") || n.ends_with(".msi")),
        _ => find(&|n| n.ends_with(".appimage") && is_arm_name(n) == arm)
            .or_else(|| find(&|n| n.ends_with(".deb") && is_arm_name(n) == arm)),
    }
}

fn release_page() -> String {
    format!("https://github.com/{OWNER}/{REPO}/releases/latest")
}

/// Only ever hand the OS a link that lives in this project's GitHub repo, even
/// if the API response says otherwise.
fn trusted_url(url: &str) -> bool {
    url.starts_with(&format!("https://github.com/{OWNER}/{REPO}/"))
}

/// Turn a `releases/latest` API response into an [`UpdateInfo`].
pub fn parse_release(body: &Value, current_version: &str, platform: Platform) -> UpdateInfo {
    let tag = body["tag_name"].as_str().unwrap_or_default();
    if tag.is_empty() || !is_newer(tag, current_version) {
        return UpdateInfo::default();
    }

    let assets: Vec<(String, String)> = body["assets"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| {
                    Some((
                        x["name"].as_str()?.to_string(),
                        x["browser_download_url"].as_str()?.to_string(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default();

    let download_url = pick_asset(&assets, platform)
        .filter(|u| trusted_url(u))
        .or_else(|| body["html_url"].as_str().filter(|u| trusted_url(u)).map(String::from))
        .unwrap_or_else(release_page);

    UpdateInfo {
        available: true,
        version: tag.trim_start_matches('v').to_string(),
        release_notes: body["body"].as_str().unwrap_or_default().to_string(),
        release_date: body["published_at"].as_str().unwrap_or_default().to_string(),
        download_url,
    }
}

/// Fetch `url` (a `releases/latest` endpoint) and compare with `current_version`.
/// Blocking – call from a worker thread.
pub fn check_at(
    url: &str,
    current_version: &str,
    platform: Platform,
    timeout: Duration,
) -> Result<UpdateInfo, String> {
    let response = ureq::get(url)
        .set("User-Agent", "Clyp-Update-Check")
        .set("Accept", "application/vnd.github+json")
        .timeout(timeout)
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(404, _) => "No releases have been published yet.".to_string(),
            ureq::Error::Status(403, _) | ureq::Error::Status(429, _) => {
                "GitHub rate limit reached. Try again in a few minutes.".to_string()
            }
            ureq::Error::Status(code, _) => format!("GitHub returned HTTP {code}."),
            ureq::Error::Transport(t) => format!("Could not reach GitHub: {t}"),
        })?;
    let body: Value = response
        .into_json()
        .map_err(|e| format!("Unexpected response from GitHub: {e}"))?;
    Ok(parse_release(&body, current_version, platform))
}

/// Blocking – call from a worker thread.
pub fn check(current_version: &str) -> Result<UpdateInfo, String> {
    let url = format!("https://api.github.com/repos/{OWNER}/{REPO}/releases/latest");
    check_at(&url, current_version, Platform::current(), TIMEOUT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    const MAC_ARM: Platform = Platform { os: "macos", arch: "aarch64" };
    const MAC_INTEL: Platform = Platform { os: "macos", arch: "x86_64" };
    const WIN: Platform = Platform { os: "windows", arch: "x86_64" };
    const LINUX: Platform = Platform { os: "linux", arch: "x86_64" };
    const LINUX_ARM: Platform = Platform { os: "linux", arch: "aarch64" };

    fn gh(path: &str) -> String {
        format!("https://github.com/rrajendran/clyp/releases/download/v1.2.0/{path}")
    }

    fn assets(names: &[&str]) -> Vec<(String, String)> {
        names.iter().map(|n| (n.to_string(), gh(n))).collect()
    }

    fn release(tag: &str, names: &[&str]) -> Value {
        json!({
            "tag_name": tag,
            "body": "- fixes\n- features",
            "published_at": "2026-11-05T10:00:00Z",
            "html_url": format!("https://github.com/rrajendran/clyp/releases/tag/{tag}"),
            "assets": names.iter().map(|n| json!({ "name": n, "browser_download_url": gh(n) })).collect::<Vec<_>>(),
        })
    }

    // ---- versions ----

    #[test]
    fn compares_versions_numerically() {
        assert!(is_newer("v1.0.10", "1.0.9"));
        assert!(is_newer("1.1.0", "1.0.99"));
        assert!(is_newer("2.0", "1.9.9"));
        assert!(!is_newer("1.0.3", "1.0.3"));
        assert!(!is_newer("v1.0.2", "1.0.3"));
    }

    #[test]
    fn tolerates_prerelease_suffixes() {
        assert!(is_newer("1.0.4-beta.1", "1.0.3"));
        assert!(!is_newer("1.0.3-beta.1", "1.0.3"), "a prerelease of the current version is not an update");
    }

    #[test]
    fn garbage_versions_never_count_as_newer() {
        assert!(!is_newer("", "1.0.0"));
        assert!(!is_newer("latest", "1.0.0"));
        assert!(!is_newer("nightly-2026", "1.0.0"));
    }

    // ---- installer selection ----

    #[test]
    fn picks_the_right_installer_per_platform() {
        let all = assets(&[
            "Clyp_1.2.0_aarch64.dmg",
            "Clyp_1.2.0_x64.dmg",
            "Clyp_1.2.0_x64-setup.exe",
            "Clyp_1.2.0_amd64.AppImage",
            "Clyp_1.2.0_amd64.deb",
            "Clyp_1.2.0_arm64.deb",
            "latest.json",
        ]);
        assert_eq!(pick_asset(&all, MAC_ARM), Some(gh("Clyp_1.2.0_aarch64.dmg")));
        assert_eq!(pick_asset(&all, MAC_INTEL), Some(gh("Clyp_1.2.0_x64.dmg")));
        assert_eq!(pick_asset(&all, WIN), Some(gh("Clyp_1.2.0_x64-setup.exe")));
        assert_eq!(pick_asset(&all, LINUX), Some(gh("Clyp_1.2.0_amd64.AppImage")));
        assert_eq!(pick_asset(&all, LINUX_ARM), Some(gh("Clyp_1.2.0_arm64.deb")), "falls back to .deb for arm");
    }

    #[test]
    fn handles_legacy_electron_asset_names() {
        let all = assets(&["Clyp-1.0.3-arm64.dmg", "Clyp-1.0.3.dmg"]);
        assert_eq!(pick_asset(&all, MAC_ARM), Some(gh("Clyp-1.0.3-arm64.dmg")));
        assert_eq!(pick_asset(&all, MAC_INTEL), Some(gh("Clyp-1.0.3.dmg")));
    }

    #[test]
    fn never_offers_the_wrong_architecture() {
        let only_arm = assets(&["Clyp_1.2.0_aarch64.dmg"]);
        assert_eq!(pick_asset(&only_arm, MAC_INTEL), None);
        let only_intel = assets(&["Clyp_1.2.0_x64.dmg"]);
        assert_eq!(pick_asset(&only_intel, MAC_ARM), None);
    }

    // ---- release parsing ----

    #[test]
    fn newer_release_is_reported_with_details() {
        let info = parse_release(&release("v1.2.0", &["Clyp_1.2.0_aarch64.dmg"]), "1.0.3", MAC_ARM);
        assert!(info.available);
        assert_eq!(info.version, "1.2.0", "leading v is stripped");
        assert_eq!(info.release_notes, "- fixes\n- features");
        assert_eq!(info.release_date, "2026-11-05T10:00:00Z");
        assert_eq!(info.download_url, gh("Clyp_1.2.0_aarch64.dmg"));
    }

    #[test]
    fn serialises_with_the_keys_the_ui_reads() {
        let info = parse_release(&release("v1.2.0", &["Clyp_1.2.0_aarch64.dmg"]), "1.0.3", MAC_ARM);
        let v = serde_json::to_value(&info).unwrap();
        for key in ["available", "version", "releaseNotes", "releaseDate", "downloadUrl"] {
            assert!(v.get(key).is_some(), "missing {key}");
        }
        assert_eq!(v["available"], true);
    }

    #[test]
    fn same_or_older_release_is_not_an_update() {
        assert_eq!(parse_release(&release("v1.0.3", &[]), "1.0.3", MAC_ARM), UpdateInfo::default());
        assert!(!parse_release(&release("v1.0.2", &[]), "1.0.3", MAC_ARM).available);
    }

    #[test]
    fn falls_back_to_the_release_page_when_no_installer_matches() {
        let info = parse_release(&release("v1.2.0", &["Clyp_1.2.0_x64-setup.exe"]), "1.0.3", MAC_ARM);
        assert!(info.available);
        assert_eq!(info.download_url, "https://github.com/rrajendran/clyp/releases/tag/v1.2.0");
    }

    #[test]
    fn untrusted_download_links_are_never_offered() {
        let mut body = release("v1.2.0", &[]);
        body["assets"] = json!([{ "name": "Clyp_1.2.0_aarch64.dmg", "browser_download_url": "https://evil.example/Clyp.dmg" }]);
        body["html_url"] = json!("https://evil.example/page");
        let info = parse_release(&body, "1.0.3", MAC_ARM);
        assert!(info.available);
        assert_eq!(info.download_url, "https://github.com/rrajendran/clyp/releases/latest");
        assert!(!info.download_url.contains("evil"));
    }

    #[test]
    fn malformed_release_json_is_not_an_update() {
        assert!(!parse_release(&json!({}), "1.0.3", MAC_ARM).available);
        assert!(!parse_release(&json!({ "tag_name": 5 }), "1.0.3", MAC_ARM).available);
        assert!(!parse_release(&json!(null), "1.0.3", MAC_ARM).available);
        // assets of the wrong shape are ignored, not fatal
        let weird = json!({ "tag_name": "v9.0.0", "assets": [1, "x", { "name": "a" }] });
        let info = parse_release(&weird, "1.0.3", MAC_ARM);
        assert!(info.available);
        assert_eq!(info.download_url, "https://github.com/rrajendran/clyp/releases/latest");
    }

    // ---- HTTP, against a local mock of the GitHub API ----

    /// Serves `responses` (status, body) one per connection, then stops.
    /// Returns the base URL and a handle yielding the requests it saw.
    fn mock_github(responses: Vec<(u16, String)>) -> (String, std::thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/repos/rrajendran/clyp/releases/latest", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let mut seen = Vec::new();
            for (status, body) in responses {
                let (mut stream, _) = listener.accept().unwrap();
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                seen.push(String::from_utf8_lossy(&buf[..n]).to_string());
                let reply = format!(
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(reply.as_bytes());
            }
            seen
        });
        (url, handle)
    }

    const T: Duration = Duration::from_secs(5);

    #[test]
    fn check_finds_a_newer_release_over_http() {
        let (url, server) = mock_github(vec![(200, release("v1.2.0", &["Clyp_1.2.0_aarch64.dmg"]).to_string())]);
        let info = check_at(&url, "1.0.3", MAC_ARM, T).unwrap();
        assert!(info.available);
        assert_eq!(info.version, "1.2.0");
        assert_eq!(info.download_url, gh("Clyp_1.2.0_aarch64.dmg"));
        let request = server.join().unwrap().remove(0);
        assert!(request.starts_with("GET /repos/rrajendran/clyp/releases/latest"));
        assert!(request.to_lowercase().contains("user-agent: clyp-update-check"), "GitHub rejects requests without a User-Agent");
    }

    #[test]
    fn check_reports_up_to_date() {
        let (url, _s) = mock_github(vec![(200, release("v1.0.3", &[]).to_string())]);
        assert!(!check_at(&url, "1.0.3", MAC_ARM, T).unwrap().available);
    }

    #[test]
    fn check_explains_http_failures() {
        let (url, _s) = mock_github(vec![(404, "{}".into())]);
        assert_eq!(check_at(&url, "1.0.3", MAC_ARM, T).unwrap_err(), "No releases have been published yet.");
        let (url, _s) = mock_github(vec![(403, "{\"message\":\"rate limit\"}".into())]);
        assert!(check_at(&url, "1.0.3", MAC_ARM, T).unwrap_err().contains("rate limit"));
        let (url, _s) = mock_github(vec![(500, "oops".into())]);
        assert_eq!(check_at(&url, "1.0.3", MAC_ARM, T).unwrap_err(), "GitHub returned HTTP 500.");
    }

    #[test]
    fn check_survives_a_malformed_body() {
        let (url, _s) = mock_github(vec![(200, "<html>not json</html>".into())]);
        let err = check_at(&url, "1.0.3", MAC_ARM, T).unwrap_err();
        assert!(err.starts_with("Unexpected response from GitHub"), "{err}");
    }

    #[test]
    fn check_reports_an_unreachable_server() {
        // Bind then drop to get a port nothing listens on.
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let err = check_at(&format!("http://127.0.0.1:{port}/x"), "1.0.3", MAC_ARM, T).unwrap_err();
        assert!(err.starts_with("Could not reach GitHub"), "{err}");
    }

    #[test]
    fn check_times_out_instead_of_hanging() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/x", listener.local_addr().unwrap());
        let _hold = std::thread::spawn(move || {
            let _conn = listener.accept(); // accept, never answer
            std::thread::sleep(Duration::from_secs(3));
        });
        let started = std::time::Instant::now();
        let err = check_at(&url, "1.0.3", MAC_ARM, Duration::from_millis(300)).unwrap_err();
        assert!(err.starts_with("Could not reach GitHub"), "{err}");
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    /// Hits the real GitHub API. Run on demand:
    /// `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored live_github --nocapture`
    #[test]
    #[ignore]
    fn live_github_latest_release() {
        let info = check("0.0.1").expect("GitHub API reachable and repo has a release");
        println!("latest release: {info:#?}");
        assert!(info.available, "any published release is newer than 0.0.1");
        assert!(info.download_url.starts_with("https://github.com/rrajendran/clyp/"));
        assert!(!check("999.0.0").unwrap().available);
    }
}
