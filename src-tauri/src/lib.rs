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
    {
        let mut rec = state.recording.lock().map_err(|e| e.to_string())?;
        rec.samples.clear();
        rec.is_recording = true;
    }

    {
        let mut tx_guard = state.audio_tx.lock().map_err(|e| e.to_string())?;
        if tx_guard.is_none() {
            let tx = audio::spawn_audio_thread(app.clone(), Arc::clone(&state.audio_buffer));
            *tx_guard = Some(tx);
        }
    }

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
    {
        let tx_guard = state.audio_tx.lock().map_err(|e| e.to_string())?;
        if let Some(tx) = tx_guard.as_ref() {
            tx.send(AudioCommand::Stop).map_err(|e| e.to_string())?;
        }
    }

    std::thread::sleep(std::time::Duration::from_millis(50));

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

// ── Local STT commands ──

#[tauri::command]
fn get_available_models() -> Vec<transcribe::ModelInfo> {
    transcribe::available_models()
}

#[tauri::command]
fn get_models_dir(app: tauri::AppHandle) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app data dir: {}", e))?;
    let models_dir = data_dir.join("models");
    std::fs::create_dir_all(&models_dir).map_err(|e| e.to_string())?;
    Ok(models_dir.to_string_lossy().to_string())
}

#[tauri::command]
fn check_model_exists(app: tauri::AppHandle, filename: String) -> Result<bool, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app data dir: {}", e))?;
    let model_path = data_dir.join("models").join(&filename);
    Ok(model_path.exists())
}

#[tauri::command]
async fn download_model_file(
    app: tauri::AppHandle,
    url: String,
    filename: String,
) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app data dir: {}", e))?;
    let dest = data_dir.join("models").join(&filename);
    transcribe::download_model(&app, &url, &dest).await?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
fn load_whisper_model(
    #[allow(unused_variables)] app: tauri::AppHandle,
    #[allow(unused_variables)] state: tauri::State<'_, AppState>,
    #[allow(unused_variables)] filename: String,
) -> Result<(), String> {
    #[cfg(feature = "local-stt")]
    {
        use whisper_rs::{WhisperContext, WhisperContextParameters};

        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("No app data dir: {}", e))?;
        let model_path = data_dir.join("models").join(&filename);

        if !model_path.exists() {
            return Err(format!("Model not found: {}", model_path.display()));
        }

        let ctx = WhisperContext::new_with_params(
            model_path.to_str().ok_or("Invalid path")?,
            WhisperContextParameters::default(),
        )
        .map_err(|e| format!("Failed to load model: {}", e))?;

        let mut guard = state.whisper_ctx.lock().map_err(|e| e.to_string())?;
        *guard = Some(ctx);

        Ok(())
    }
    #[cfg(not(feature = "local-stt"))]
    Err("Local STT not available — rebuild with `local-stt` feature".into())
}

#[tauri::command]
fn transcribe_local_audio(
    #[allow(unused_variables)] state: tauri::State<'_, AppState>,
    #[allow(unused_variables)] samples: Vec<f32>,
) -> Result<String, String> {
    #[cfg(feature = "local-stt")]
    {
        let guard = state.whisper_ctx.lock().map_err(|e| e.to_string())?;
        let ctx = guard.as_ref().ok_or("Whisper model not loaded")?;
        transcribe::transcribe_local(ctx, &samples)
    }
    #[cfg(not(feature = "local-stt"))]
    Err("Local STT not available — rebuild with `local-stt` feature".into())
}

#[tauri::command]
fn is_local_stt_available() -> bool {
    cfg!(feature = "local-stt")
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
            let show = MenuItem::with_id(app, "show", "Show VoiceInk", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

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
            get_available_models,
            get_models_dir,
            check_model_exists,
            download_model_file,
            is_local_stt_available,
            load_whisper_model,
            transcribe_local_audio,
        ])
        .run(tauri::generate_context!())
        .expect("error while running VoiceInk");
}
