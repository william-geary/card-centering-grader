//! The desktop shell. All of the measuring happens in the web front end; the
//! Rust side only provides a native window and native Save dialogs.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A path chosen in the Save dialog is added to the filesystem scope,
        // so the app can write exactly the files the user picks and nothing
        // else.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running the Card Centering Grader");
}
