mod audio;
#[cfg(target_os = "macos")]
#[allow(deprecated, unexpected_cfgs)]
mod capsule;
#[cfg(target_os = "macos")]
mod clipboard;
#[cfg(target_os = "macos")]
mod fnkey;
mod paste;
#[cfg(target_os = "macos")]
mod permissions;
mod state;
mod transcribe;
mod watchdog;

use state::{AppState, AudioCommand};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    Emitter, Manager, WindowEvent,
};

/// Lightweight result from stop_recording — samples stay in Rust.
#[derive(serde::Serialize)]
struct StopResult {
    sample_count: usize,
    duration_secs: f64,
}

#[tauri::command]
fn start_recording(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    {
        let mut rec = state.recording.lock().map_err(|e| e.to_string())?;
        rec.samples = Vec::new();
        rec.is_recording = true;
    }

    // Record start timestamp and reset callback counter
    {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        state.recording_started_at.store(now, Ordering::Relaxed);
        state.audio_callback_count.store(0, Ordering::Relaxed);
    }

    {
        let mut tx_guard = state.audio_tx.lock().map_err(|e| e.to_string())?;
        if tx_guard.is_none() {
            let tx = audio::spawn_audio_thread(
                app.clone(),
                Arc::clone(&state.audio_buffer),
                Arc::clone(&state.audio_callback_count),
            );
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
) -> Result<StopResult, String> {
    // Clear recording timestamp
    state.recording_started_at.store(0, Ordering::Relaxed);

    {
        let tx_guard = state.audio_tx.lock().map_err(|e| e.to_string())?;
        if let Some(tx) = tx_guard.as_ref() {
            tx.send(AudioCommand::Stop).map_err(|e| e.to_string())?;
        }
    }

    std::thread::sleep(std::time::Duration::from_millis(100));

    // Zero-copy move: take samples out of audio buffer, place into recording state
    let samples = {
        let mut buf = state.audio_buffer.lock().map_err(|e| e.to_string())?;
        std::mem::take(&mut *buf)
    };

    let sample_count = samples.len();
    let duration_secs = sample_count as f64 / 16000.0;
    eprintln!(
        "[cmd] stop_recording: {} samples ({:.1}s audio)",
        sample_count,
        duration_secs
    );

    {
        let mut rec = state.recording.lock().map_err(|e| e.to_string())?;
        rec.is_recording = false;
        rec.samples = samples;
    }

    Ok(StopResult {
        sample_count,
        duration_secs,
    })
}

/// Transcribe audio samples held in Rust state via local whisper model.
/// Samples never cross IPC — read directly from RecordingState.
#[tauri::command]
async fn transcribe_buffer(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    prompt: Option<String>,
    language: Option<String>,
    translate: bool,
) -> Result<String, String> {
    #[cfg(feature = "local-stt")]
    {
        // Clone Arc<WhisperContext> BEFORE taking samples — if the model isn't loaded,
        // we fail early and leave samples intact for a potential cloud fallback.
        let ctx = {
            let guard = state.whisper_ctx.lock().map_err(|e| e.to_string())?;
            guard
                .as_ref()
                .ok_or_else(|| "Whisper model not loaded".to_string())?
                .clone()
        };

        // Take samples from recording state (zero-copy move)
        let samples = {
            let mut rec = state.recording.lock().map_err(|e| e.to_string())?;
            std::mem::take(&mut rec.samples)
        };

        eprintln!(
            "[cmd] transcribe_buffer: {} samples ({:.1}s)",
            samples.len(),
            samples.len() as f64 / 16000.0
        );

        let app_clone = app.clone();
        tokio::task::spawn_blocking(move || {
            transcribe::transcribe_local_with_events(
                &ctx,
                &samples,
                prompt.as_deref(),
                language.as_deref(),
                translate,
                app_clone,
            )
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))?
    }
    #[cfg(not(feature = "local-stt"))]
    {
        let _ = (app, state, prompt, language, translate);
        Err("Local STT not available — rebuild with `local-stt` feature".into())
    }
}

/// Transcribe audio samples held in Rust state via Groq cloud API.
/// Samples never cross IPC — read directly from RecordingState.
#[tauri::command]
async fn transcribe_buffer_cloud(
    state: tauri::State<'_, AppState>,
    api_key: String,
    prompt: Option<String>,
    language: Option<String>,
    translate: bool,
) -> Result<String, String> {
    // Take samples from recording state
    let samples = {
        let mut rec = state.recording.lock().map_err(|e| e.to_string())?;
        std::mem::take(&mut rec.samples)
    };

    eprintln!(
        "[cmd] transcribe_buffer_cloud: {} samples ({:.1}s)",
        samples.len(),
        samples.len() as f64 / 16000.0
    );

    transcribe::transcribe_cloud(
        &samples,
        &api_key,
        prompt.as_deref(),
        language.as_deref(),
        translate,
    )
    .await
}

#[tauri::command]
fn paste_text() -> Result<(), String> {
    paste::simulate_paste()
}

#[tauri::command]
fn check_accessibility() -> bool {
    #[cfg(target_os = "macos")]
    {
        fnkey::is_accessibility_granted()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

#[tauri::command]
fn request_accessibility() -> bool {
    #[cfg(target_os = "macos")]
    {
        fnkey::request_accessibility_permission()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

#[tauri::command]
fn reinit_fn_key_monitor(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        fnkey::reinit_monitor_if_needed(app);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
    }
}

/// Force-reinitialize the fn key monitor (tears down + re-creates). Called on system wake.
#[tauri::command]
fn force_reinit_fn_key_monitor(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        fnkey::force_reinit_monitor(app);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
    }
}

// ── Clipboard preservation commands (macOS: NSPasteboard, other: stub) ──

#[tauri::command]
fn snapshot_clipboard() {
    #[cfg(target_os = "macos")]
    {
        clipboard::cmd_snapshot();
    }
}

#[tauri::command]
fn restore_clipboard() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        clipboard::cmd_restore()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

#[tauri::command]
fn write_transient_text(text: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        clipboard::cmd_write_transient(&text)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = text;
        Ok(())
    }
}

/// Open a macOS System Settings pane via NSWorkspace.
/// Bypasses Tauri shell plugin URL validation which blocks x-apple.systempreferences: URLs.
#[tauri::command]
fn open_system_settings(pane: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::ffi::c_void;
        unsafe {
            let objc_get_class: unsafe extern "C" fn(*const u8) -> *const c_void = fnkey_ffi::objc_getClass;
            let sel_register: unsafe extern "C" fn(*const u8) -> *const c_void = fnkey_ffi::sel_registerName;

            // Create NSURL from string
            let ns_string_class = objc_get_class(b"NSString\0".as_ptr());
            let url_bytes = format!("{}\0", pane);
            let alloc_sel = sel_register(b"stringWithUTF8String:\0".as_ptr());
            let send_str: unsafe extern "C" fn(*const c_void, *const c_void, *const u8) -> *const c_void =
                std::mem::transmute(fnkey_ffi::objc_msgSend as *const c_void);
            let ns_string = send_str(ns_string_class, alloc_sel, url_bytes.as_ptr());

            let nsurl_class = objc_get_class(b"NSURL\0".as_ptr());
            let url_sel = sel_register(b"URLWithString:\0".as_ptr());
            let send_url: unsafe extern "C" fn(*const c_void, *const c_void, *const c_void) -> *const c_void =
                std::mem::transmute(fnkey_ffi::objc_msgSend as *const c_void);
            let nsurl = send_url(nsurl_class, url_sel, ns_string);

            if nsurl.is_null() {
                return Err(format!("Invalid URL: {}", pane));
            }

            // [[NSWorkspace sharedWorkspace] openURL:nsurl]
            let ws_class = objc_get_class(b"NSWorkspace\0".as_ptr());
            let shared_sel = sel_register(b"sharedWorkspace\0".as_ptr());
            let send_ws: unsafe extern "C" fn(*const c_void, *const c_void) -> *const c_void =
                std::mem::transmute(fnkey_ffi::objc_msgSend as *const c_void);
            let workspace = send_ws(ws_class, shared_sel);

            let open_sel = sel_register(b"openURL:\0".as_ptr());
            let send_open: unsafe extern "C" fn(*const c_void, *const c_void, *const c_void) -> bool =
                std::mem::transmute(fnkey_ffi::objc_msgSend as *const c_void);
            let opened = send_open(workspace, open_sel, nsurl);

            if opened {
                Ok(())
            } else {
                Err(format!("Failed to open: {}", pane))
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = pane;
        Ok(())
    }
}

// Re-export FFI symbols for use in open_system_settings
#[cfg(target_os = "macos")]
mod fnkey_ffi {
    use std::ffi::c_void;

    #[link(name = "objc", kind = "dylib")]
    extern "C" {
        pub fn objc_getClass(name: *const u8) -> *const c_void;
        pub fn sel_registerName(name: *const u8) -> *const c_void;
        pub fn objc_msgSend();
    }
}

// ── Microphone permission commands (macOS: AVFoundation, other: stub) ──

#[tauri::command]
fn check_microphone() -> String {
    #[cfg(target_os = "macos")]
    {
        permissions::check_microphone_permission()
    }
    #[cfg(not(target_os = "macos"))]
    {
        "granted".to_string()
    }
}

#[tauri::command]
async fn request_microphone() -> bool {
    #[cfg(target_os = "macos")]
    {
        // Must run off the main thread — blocking the main thread prevents
        // macOS from displaying the TCC permission prompt.
        tokio::task::spawn_blocking(|| permissions::request_microphone_permission())
            .await
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

// ── Reset all data ──

#[tauri::command]
fn reset_all_data(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app data dir: {}", e))?;

    // Delete settings store
    let settings_path = data_dir.join("linty-settings.json");
    if settings_path.exists() {
        std::fs::remove_file(&settings_path)
            .map_err(|e| format!("Failed to delete settings: {}", e))?;
        eprintln!("[reset] Deleted settings store");
    }

    // Delete history store
    let history_path = data_dir.join("linty-history.json");
    if history_path.exists() {
        std::fs::remove_file(&history_path)
            .map_err(|e| format!("Failed to delete history: {}", e))?;
        eprintln!("[reset] Deleted history store");
    }

    // Delete all downloaded models
    let models_dir = data_dir.join("models");
    if models_dir.exists() {
        std::fs::remove_dir_all(&models_dir)
            .map_err(|e| format!("Failed to delete models: {}", e))?;
        eprintln!("[reset] Deleted models directory");
    }

    // Unload whisper model from memory
    #[cfg(feature = "local-stt")]
    {
        if let Ok(mut ctx) = state.whisper_ctx.lock() {
            *ctx = None;
        }
        eprintln!("[reset] Unloaded whisper model");
    }
    #[cfg(not(feature = "local-stt"))]
    {
        let _ = &state;
    }

    eprintln!("[reset] All data cleared — app will reload");
    Ok(())
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
fn delete_model_file(app: tauri::AppHandle, filename: String) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app data dir: {}", e))?;
    let model_path = data_dir.join("models").join(&filename);
    if model_path.exists() {
        std::fs::remove_file(&model_path)
            .map_err(|e| format!("Failed to delete {}: {}", filename, e))?;
        eprintln!("[cmd] Deleted model: {}", filename);
    }
    Ok(())
}

/// Remove deprecated model binaries (tiny, base) that are no longer offered.
fn cleanup_deprecated_models(app: &tauri::AppHandle) {
    let data_dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(_) => return,
    };
    let models_dir = data_dir.join("models");
    for filename in &["ggml-tiny.bin", "ggml-base.bin"] {
        let path = models_dir.join(filename);
        if path.exists() {
            match std::fs::remove_file(&path) {
                Ok(()) => eprintln!("[cleanup] Removed deprecated model: {}", filename),
                Err(e) => eprintln!("[cleanup] Failed to remove {}: {}", filename, e),
            }
        }
    }
}

#[tauri::command]
fn load_whisper_model(
    #[allow(unused_variables)] app: tauri::AppHandle,
    #[allow(unused_variables)] state: tauri::State<'_, AppState>,
    #[allow(unused_variables)] filename: String,
) -> Result<(), String> {
    eprintln!("[cmd] load_whisper_model: {}", filename);
    #[cfg(feature = "local-stt")]
    {
        use whisper_rs::{WhisperContext, WhisperContextParameters};

        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("No app data dir: {}", e))?;
        let model_path = data_dir.join("models").join(&filename);

        if !model_path.exists() {
            eprintln!("[cmd] Model file not found: {}", model_path.display());
            return Err(format!("Model not found: {}", model_path.display()));
        }

        eprintln!("[cmd] Loading model from: {}", model_path.display());
        let mut ctx_params = WhisperContextParameters::default();
        ctx_params.use_gpu(true);

        let ctx = WhisperContext::new_with_params(
            model_path.to_str().ok_or("Invalid path")?,
            ctx_params,
        )
        .map_err(|e| format!("Failed to load model: {}", e))?;

        let mut guard = state.whisper_ctx.lock().map_err(|e| e.to_string())?;
        *guard = Some(Arc::new(ctx));

        eprintln!("[cmd] Whisper model loaded successfully: {}", filename);
        Ok(())
    }
    #[cfg(not(feature = "local-stt"))]
    Err("Local STT not available — rebuild with `local-stt` feature".into())
}

#[tauri::command]
fn is_local_stt_available() -> bool {
    cfg!(feature = "local-stt")
}

// ── macOS: activation policy (Dock + menu bar visibility) ──

#[cfg(target_os = "macos")]
#[allow(deprecated)]
fn set_activation_policy_regular() {
    use cocoa::appkit::{NSApp, NSApplication, NSApplicationActivationPolicy};
    unsafe {
        let app = NSApp();
        app.setActivationPolicy_(
            NSApplicationActivationPolicy::NSApplicationActivationPolicyRegular,
        );
    }
}

#[cfg(not(target_os = "macos"))]
fn set_activation_policy_regular() {}

#[cfg(target_os = "macos")]
#[allow(deprecated)]
fn set_activation_policy_accessory() {
    use cocoa::appkit::{NSApp, NSApplication, NSApplicationActivationPolicy};
    unsafe {
        let app = NSApp();
        app.setActivationPolicy_(
            NSApplicationActivationPolicy::NSApplicationActivationPolicyAccessory,
        );
    }
}

#[cfg(not(target_os = "macos"))]
fn set_activation_policy_accessory() {}

// ── macOS: System sleep/wake observer ──

#[cfg(target_os = "macos")]
fn register_wake_observer(app: &tauri::AppHandle, app_state: &AppState) {
    use std::ffi::c_void;

    // We need raw pointers to pass into the ObjC block
    struct SendAppHandle(tauri::AppHandle);
    unsafe impl Send for SendAppHandle {}
    unsafe impl Sync for SendAppHandle {}

    struct SendStatePtr(*const AppState);
    unsafe impl Send for SendStatePtr {}
    unsafe impl Sync for SendStatePtr {}

    // Leak the app handle and state pointer — they live for the lifetime of the process
    let app_handle = Box::leak(Box::new(SendAppHandle(app.clone())));
    let state_ptr = SendStatePtr(app_state as *const AppState);
    let state_ptr = Box::leak(Box::new(state_ptr));

    unsafe {
        let objc_get_class: unsafe extern "C" fn(*const u8) -> *const c_void = fnkey_ffi::objc_getClass;
        let sel_register: unsafe extern "C" fn(*const u8) -> *const c_void = fnkey_ffi::sel_registerName;

        // Get [NSWorkspace sharedWorkspace]
        let ws_class = objc_get_class(b"NSWorkspace\0".as_ptr());
        let shared_sel = sel_register(b"sharedWorkspace\0".as_ptr());
        let send_ws: unsafe extern "C" fn(*const c_void, *const c_void) -> *const c_void =
            std::mem::transmute(fnkey_ffi::objc_msgSend as *const c_void);
        let workspace = send_ws(ws_class, shared_sel);

        // Get [[NSWorkspace sharedWorkspace] notificationCenter]
        let nc_sel = sel_register(b"notificationCenter\0".as_ptr());
        let send_nc: unsafe extern "C" fn(*const c_void, *const c_void) -> *const c_void =
            std::mem::transmute(fnkey_ffi::objc_msgSend as *const c_void);
        let notification_center = send_nc(workspace, nc_sel);

        // Build the notification name: NSWorkspaceDidWakeNotification
        let ns_string_class = objc_get_class(b"NSString\0".as_ptr());
        let str_sel = sel_register(b"stringWithUTF8String:\0".as_ptr());
        let send_str: unsafe extern "C" fn(*const c_void, *const c_void, *const u8) -> *const c_void =
            std::mem::transmute(fnkey_ffi::objc_msgSend as *const c_void);
        let wake_name = send_str(ns_string_class, str_sel, b"NSWorkspaceDidWakeNotification\0".as_ptr());

        // Build the ObjC block for the observer callback
        // Block signature: void (^)(NSNotification *)
        #[repr(C)]
        struct WakeBlockDescriptor {
            reserved: u64,
            size: u64,
        }

        #[repr(C)]
        struct WakeBlock {
            isa: *const c_void,
            flags: i32,
            reserved: i32,
            invoke: unsafe extern "C" fn(*mut WakeBlock, *const c_void),
            descriptor: *const WakeBlockDescriptor,
            app_handle: *const SendAppHandle,
            state_ptr: *const SendStatePtr,
        }

        extern "C" {
            static _NSConcreteStackBlock: *const c_void;
        }

        unsafe extern "C" fn wake_invoke(block: *mut WakeBlock, _notification: *const c_void) {
            eprintln!("[wake] System/screen wake detected — reinitializing");

            // Log to file
            if let Ok(home) = std::env::var("HOME") {
                let path = format!("{}/linty-fnkey.log", home);
                if let Ok(mut f) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&path)
                {
                    let _ = std::io::Write::write_all(
                        &mut f,
                        b"[wake] System/screen wake detected - reinitializing\n",
                    );
                }
            }

            let app = &(*(*block).app_handle).0;
            let state = &*(*(*block).state_ptr).0;

            // 1. Force reinit fn key monitors
            fnkey::force_reinit_monitor(app.clone());

            // 2. Re-apply capsule NSPanel properties (macOS may reset level/floating after sleep)
            capsule::reinit_capsule_properties(app);

            // 3. Drop stale audio_tx sender so a fresh audio thread is spawned next recording
            if let Ok(mut tx_guard) = state.audio_tx.lock() {
                *tx_guard = None;
            }

            // 4. Release stale audio buffer memory
            if let Ok(mut buf) = state.audio_buffer.lock() {
                *buf = Vec::new();
            }

            // 5. Reset recording state (prevents desync if recording was active during sleep)
            state.recording_started_at.store(0, Ordering::Relaxed);
            if let Ok(mut rec) = state.recording.lock() {
                rec.is_recording = false;
                rec.samples = Vec::new();
            }

            // 6. Emit system-wake event to frontend
            let _ = app.emit("system-wake", ());
        }

        static WAKE_DESCRIPTOR: WakeBlockDescriptor = WakeBlockDescriptor {
            reserved: 0,
            size: std::mem::size_of::<WakeBlock>() as u64,
        };

        let block = Box::new(WakeBlock {
            isa: _NSConcreteStackBlock,
            flags: 0,
            reserved: 0,
            invoke: wake_invoke,
            descriptor: &WAKE_DESCRIPTOR,
            app_handle: app_handle as *const SendAppHandle,
            state_ptr: state_ptr as *const SendStatePtr,
        });
        let block_ptr = Box::into_raw(block);

        // [notificationCenter addObserverForName:object:queue:usingBlock:]
        let add_sel = sel_register(b"addObserverForName:object:queue:usingBlock:\0".as_ptr());
        let send_add: unsafe extern "C" fn(
            *const c_void, *const c_void,
            *const c_void, *const c_void, *const c_void, *const WakeBlock,
        ) -> *const c_void = std::mem::transmute(fnkey_ffi::objc_msgSend as *const c_void);

        let _observer = send_add(
            notification_center,
            add_sel,
            wake_name,
            std::ptr::null(),   // object: nil (any sender)
            std::ptr::null(),   // queue: nil (posting thread)
            block_ptr,
        );

        eprintln!("[wake] Registered NSWorkspaceDidWakeNotification observer");

        // Also listen for display-only sleep/wake (lid close while on power).
        // NSWorkspaceDidWakeNotification does NOT fire for screen-only wake.
        let screen_wake_name = send_str(
            ns_string_class,
            str_sel,
            b"NSWorkspaceScreensDidWakeNotification\0".as_ptr(),
        );

        // Reuse the same block layout — screen wake needs the same recovery steps.
        // We need a separate block instance since each observer owns its block.
        let screen_block = Box::new(WakeBlock {
            isa: _NSConcreteStackBlock,
            flags: 0,
            reserved: 0,
            invoke: wake_invoke,
            descriptor: &WAKE_DESCRIPTOR,
            app_handle: app_handle as *const SendAppHandle,
            state_ptr: state_ptr as *const SendStatePtr,
        });
        let screen_block_ptr = Box::into_raw(screen_block);

        let _screen_observer = send_add(
            notification_center,
            add_sel,
            screen_wake_name,
            std::ptr::null(),
            std::ptr::null(),
            screen_block_ptr,
        );

        eprintln!("[wake] Registered NSWorkspaceScreensDidWakeNotification observer");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_nspanel::init())
        .manage(AppState::new())
        // macOS app menu bar (Linty + Edit)
        .menu(|app| {
            let about = PredefinedMenuItem::about(app, Some("About Linty"), None)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let reset = MenuItem::with_id(app, "reset-all-data", "Reset All Data...", true, None::<&str>)?;
            let sep2_app = PredefinedMenuItem::separator(app)?;
            let quit = PredefinedMenuItem::quit(app, Some("Quit Linty"))?;
            let check_updates = MenuItem::with_id(app, "check-for-updates", "Check for Updates...", true, None::<&str>)?;
            let app_submenu =
                Submenu::with_items(app, "Linty", true, &[&about, &check_updates, &sep, &reset, &sep2_app, &quit])?;

            let undo = PredefinedMenuItem::undo(app, None)?;
            let redo = PredefinedMenuItem::redo(app, None)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let cut = PredefinedMenuItem::cut(app, None)?;
            let copy = PredefinedMenuItem::copy(app, None)?;
            let paste = PredefinedMenuItem::paste(app, None)?;
            let select_all = PredefinedMenuItem::select_all(app, None)?;
            let edit_submenu = Submenu::with_items(
                app,
                "Edit",
                true,
                &[&undo, &redo, &sep2, &cut, &copy, &paste, &select_all],
            )?;

            Menu::with_items(app, &[&app_submenu, &edit_submenu])
        })
        .on_menu_event(|app, event| {
            match event.id.as_ref() {
                "reset-all-data" => { let _ = app.emit("menu-reset-all-data", ()); }
                "check-for-updates" => { let _ = app.emit("menu-check-for-updates", ()); }
                _ => {}
            }
        })
        .setup(|app| {

            // Tray icon
            let show = MenuItem::with_id(app, "show", "Show Linty", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .menu(&tray_menu)
                .tooltip("Linty — Hold fn to record")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            set_activation_policy_regular();
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
                                set_activation_policy_accessory();
                            } else {
                                set_activation_policy_regular();
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = window.center();
                            }
                        }
                    }
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                set_activation_policy_regular();
                let _ = window.show();
                let _ = window.center();
            }

            // Remove deprecated model binaries (tiny, base)
            cleanup_deprecated_models(app.handle());

            // Init NSPanel capsule overlay (macOS only)
            #[cfg(target_os = "macos")]
            capsule::init_capsule_panel(app.handle());

            // Start fn key monitor (macOS only — uses NSEvent)
            #[cfg(target_os = "macos")]
            fnkey::setup_fn_key_monitor(app.handle().clone());

            // Register sleep/wake observer (macOS only)
            #[cfg(target_os = "macos")]
            {
                let app_state = app.state::<AppState>();
                register_wake_observer(app.handle(), app_state.inner());
            }

            // Start resource watchdog (auto-recovery from CPU overload)
            watchdog::start(app.handle().clone());

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Hide to tray instead of quitting
                let _ = window.hide();
                api.prevent_close();
                set_activation_policy_accessory();
            }
        })
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            transcribe_buffer,
            transcribe_buffer_cloud,
            paste_text,
            snapshot_clipboard,
            restore_clipboard,
            write_transient_text,
            check_accessibility,
            request_accessibility,
            reinit_fn_key_monitor,
            force_reinit_fn_key_monitor,
            open_system_settings,
            check_microphone,
            request_microphone,
            get_available_models,
            get_models_dir,
            check_model_exists,
            download_model_file,
            delete_model_file,
            is_local_stt_available,
            load_whisper_model,
            reset_all_data,
            capsule::show_capsule,
            capsule::hide_capsule,
            capsule::emit_capsule_state,
            capsule::play_capsule_sound,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Linty");
}
