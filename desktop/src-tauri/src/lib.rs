// The whole app lives in the webview (React + the Codex /api/v1 JSON API);
// the Rust side is a bare shell. Native commands land here if the app ever
// needs them (system tray, notifications, deep links for the VTT...).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
