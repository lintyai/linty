mod audio;
mod paste;
mod state;
mod transcribe;

use state::{AppState, AudioCommand};
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

#[tauri::command]
fn start_recording(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    // Mark recording state
    {
        let mut rec = state.recording.lock().map_err(|e| e.to_string())?;
        rec.samples.clear();
        rec.is_recording = true;
    }

    // Initialize audio thread if first time
    {
        let mut tx_guard = state.audio_tx.lock().map_err(|e| e.to_string())?;
        if tx_guard.is_none() {
            let tx = audio::spawn_audio_thread(app.clone(), Arc::clone(&state.audio_buffer));
            *tx_guard = Some(tx);
        }
    }

    // Send start command
    let tx_guard = state.audio_tx.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = tx_guard.as_ref() {
        tx.send(AudioCommand::Start).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn stop_recording(
    _app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<f32>, String> {
    // Send stop command
    {
        let tx_guard = state.audio_tx.lock().map_err(|e| e.to_string())?;
        if let Some(tx) = tx_guard.as_ref() {
            tx.send(AudioCommand::Stop).map_err(|e| e.to_string())?;
        }
    }

    // Small delay to ensure stream is fully stopped
    std::thread::sleep(std::time::Duration::from_millis(50));

    // Drain the buffer
    let samples = {
        let mut buf = state.audio_buffer.lock().map_err(|e| e.to_string())?;
        let s = buf.clone();
        buf.clear();
        s
    };

    {
        let mut rec = state.recording.lock().map_err(|e| e.to_string())?;
        rec.is_recording = false;
        rec.samples = samples.clone();
    }

    Ok(samples)
}

#[tauri::command]
async fn transcribe_audio(samples: Vec<f32>, api_key: String) -> Result<String, String> {
    transcribe::transcribe_cloud(&samples, &api_key).await
}

#[tauri::command]
fn paste_text() -> Result<(), String> {
    paste::simulate_paste()
}

#[tauri::command]
fn check_accessibility() -> bool {
    paste::check_accessibility_permission()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(AppState::new())
        .setup(|app| {
            // Build tray menu
            let show = MenuItem::with_id(app, "show", "Show VoiceInk", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            // Build tray icon
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("VoiceInk — Press Cmd+Shift+Space to record")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.center();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = window.center();
                            }
                        }
                    }
                })
                .build(app)?;

            // Show window on startup for initial setup
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.center();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            transcribe_audio,
            paste_text,
            check_accessibility,
        ])
        .run(tauri::generate_context!())
        .expect("error while running VoiceInk");
}
