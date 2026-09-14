mod audio;
mod application;
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
#[cfg(feature = "parakeet")]
pub mod parakeet;
mod state;
pub mod transcribe;
mod tray;
mod watchdog;

use state::{AppState, AudioCommand};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    Emitter, Manager, WindowEvent,
};

/// Lightweight result from stop_recording — samples stay in Rust.
#[derive(serde::Serialize)]
struct StopResult {
    sample_count: usize,
    duration_secs: f64,
    application: Option<application::ApplicationIdentity>,
}

/// System-level fn key binding status (issue #32 — macOS Dictation double-paste).
#[derive(serde::Serialize)]
struct FnKeyConflict {
    /// AppleFnUsageType: 0 = Do Nothing, 1 = Change Input Source,
    /// 2 = Show Emoji & Symbols, 3 = Start Dictation. None = unset (macOS default).
    usage_type: Option<i64>,
    conflict: bool,
}

fn now_epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Load a whisper model from the app models dir on a blocking thread.
/// Never call this on the main thread path — the read + Metal init takes seconds.
#[cfg(feature = "local-stt")]
async fn load_whisper_ctx(
    app: &tauri::AppHandle,
    filename: &str,
) -> Result<whisper_rs::WhisperContext, String> {
    use whisper_rs::{WhisperContext, WhisperContextParameters};

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app data dir: {}", e))?;
    let model_path = data_dir.join("models").join(filename);

    if !model_path.exists() {
        eprintln!("[stt] Model file not found: {}", model_path.display());
        return Err(format!("Model not found: {}", model_path.display()));
    }

    eprintln!("[stt] Loading model from: {}", model_path.display());
    let path_str = model_path.to_str().ok_or("Invalid path")?.to_string();

    tokio::task::spawn_blocking(move || {
        let mut ctx_params = WhisperContextParameters::default();
        ctx_params.use_gpu(true);
        WhisperContext::new_with_params(&path_str, ctx_params)
            .map_err(|e| format!("Failed to load model: {}", e))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

fn models_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app data dir: {}", e))?;
    Ok(data_dir.join("models"))
}

/// A resident local speech engine, cloned out of AppState before blocking inference.
#[cfg(feature = "local-stt")]
enum LocalEngine {
    Whisper(Arc<whisper_rs::WhisperContext>),
    #[cfg(feature = "parakeet")]
    Parakeet(Arc<parakeet::ParakeetEngine>),
}

#[cfg(feature = "local-stt")]
fn resident_local_engine(state: &AppState) -> Result<Option<LocalEngine>, String> {
    #[cfg(feature = "parakeet")]
    {
        let guard = state.parakeet_engine.lock().map_err(|e| e.to_string())?;
        if let Some(engine) = guard.as_ref() {
            return Ok(Some(LocalEngine::Parakeet(Arc::clone(engine))));
        }
    }
    let guard = state.whisper_ctx.lock().map_err(|e| e.to_string())?;
    Ok(guard.as_ref().map(|ctx| LocalEngine::Whisper(Arc::clone(ctx))))
}

/// Load `filename` (whisper .bin or the Parakeet bundle) into memory, evicting
/// whichever engine was resident so only one model is ever loaded.
/// Caller must hold `local_model_load_lock`.
#[cfg(feature = "local-stt")]
async fn load_local_engine(
    app: &tauri::AppHandle,
    state: &AppState,
    filename: &str,
) -> Result<LocalEngine, String> {
    if transcribe::is_parakeet_model(filename) {
        #[cfg(feature = "parakeet")]
        {
            let dir = models_dir(app)?.join(filename);
            eprintln!("[stt] Loading Parakeet bundle from: {}", dir.display());
            let started = std::time::Instant::now();
            let engine = tokio::task::spawn_blocking(move || parakeet::ParakeetEngine::load(&dir))
                .await
                .map_err(|e| format!("Task join error: {}", e))??;
            eprintln!(
                "[stt] Parakeet loaded in {:.0}ms",
                started.elapsed().as_millis()
            );
            let engine = Arc::new(engine);
            // Evict whisper outside its lock: freeing a model can take a moment
            // and other threads probe these slots while inference runs.
            let previous = state.whisper_ctx.lock().map_err(|e| e.to_string())?.take();
            *state.parakeet_engine.lock().map_err(|e| e.to_string())? = Some(Arc::clone(&engine));
            drop(previous);
            return Ok(LocalEngine::Parakeet(engine));
        }
        #[cfg(not(feature = "parakeet"))]
        return Err("This build does not include Parakeet support".to_string());
    }

    let ctx = Arc::new(load_whisper_ctx(app, filename).await?);
    // Same eviction rule as above: take the old engine out, release the lock,
    // then let it drop (ParakeetEngine::drop blocks on the Swift actor's cleanup).
    #[cfg(feature = "parakeet")]
    let previous = state.parakeet_engine.lock().map_err(|e| e.to_string())?.take();
    *state.whisper_ctx.lock().map_err(|e| e.to_string())? = Some(Arc::clone(&ctx));
    #[cfg(feature = "parakeet")]
    drop(previous);
    Ok(LocalEngine::Whisper(ctx))
}

/// Resolve the engine for the selected local model, transparently reloading it
/// after the watchdog's idle unload. Runs BEFORE the recorded samples are taken
/// so a failed load leaves them intact for a retry.
#[cfg(feature = "local-stt")]
async fn resolve_local_engine(
    app: &tauri::AppHandle,
    state: &AppState,
) -> Result<LocalEngine, String> {
    if let Some(engine) = resident_local_engine(state)? {
        return Ok(engine);
    }
    // Serialize with other loads, then re-check — a concurrent load may have
    // finished while we waited for the lock.
    let _load_guard = state.local_model_load_lock.lock().await;
    if let Some(engine) = resident_local_engine(state)? {
        return Ok(engine);
    }
    let filename = state
        .local_model_filename
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    let Some(filename) = filename else {
        return Err("Local model not loaded".to_string());
    };
    eprintln!(
        "[cmd] transcribe_buffer: reloading idle-unloaded model {}",
        filename
    );
    load_local_engine(app, state, &filename).await
}

/// Prime the freshly loaded engine with a tiny silent inference on a background
/// thread so the first real dictation doesn't pay the pipeline warm-up cost.
#[cfg(feature = "local-stt")]
fn warm_up_local_engine(engine: LocalEngine) {
    std::thread::spawn(move || {
        let warmup_start = std::time::Instant::now();
        match engine {
            LocalEngine::Whisper(ctx) => {
                eprintln!("[cmd] Warming up Whisper GPU pipeline...");
                if let Ok(mut state) = ctx.create_state() {
                    let silence = vec![0.0f32; 1600]; // 0.1s at 16kHz
                    let mut params = whisper_rs::FullParams::new(
                        whisper_rs::SamplingStrategy::Greedy { best_of: 1 },
                    );
                    params.set_n_threads(1);
                    params.set_single_segment(true);
                    params.set_no_timestamps(true);
                    params.set_print_special(false);
                    params.set_print_progress(false);
                    params.set_print_realtime(false);
                    let _ = state.full(params, &silence);
                }
            }
            #[cfg(feature = "parakeet")]
            LocalEngine::Parakeet(engine) => {
                eprintln!("[cmd] Warming up Parakeet Neural Engine pipeline...");
                let silence = vec![0.0f32; 16000]; // 1s at 16kHz
                let _ = engine.transcribe(&silence, None);
            }
        }
        eprintln!(
            "[cmd] Warm-up done in {:.0}ms",
            warmup_start.elapsed().as_millis()
        );
    });
}

#[tauri::command]
fn start_recording(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    track_application: Option<bool>,
) -> Result<(), String> {
    {
        let mut rec = state.recording.lock().map_err(|e| e.to_string())?;
        rec.samples = Vec::new();
        rec.application = if track_application.unwrap_or(false) {
            application::frontmost_application()
        } else {
            None
        };
        rec.is_recording = true;
    }

    // Record start timestamp and reset callback counter
    {
        let now = now_epoch_ms();
        state.recording_started_at.store(now, Ordering::Relaxed);
        state.audio_callback_count.store(0, Ordering::Relaxed);
        // Touch the whisper idle clock — never unload the model mid-dictation.
        #[cfg(feature = "local-stt")]
        state.local_model_last_used_at.store(now, Ordering::Relaxed);
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
async fn stop_recording(
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

    // Let the audio thread drain in-flight callbacks — async so the main
    // thread keeps servicing events (sync commands run on the main thread).
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

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

    let application = {
        let mut rec = state.recording.lock().map_err(|e| e.to_string())?;
        rec.is_recording = false;
        rec.samples = samples;
        rec.application.take()
    };

    Ok(StopResult {
        sample_count,
        duration_secs,
        application,
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
) -> Result<String, String> {
    #[cfg(feature = "local-stt")]
    {
        state
            .local_model_last_used_at
            .store(now_epoch_ms(), Ordering::Relaxed);

        // Resolve the engine BEFORE taking samples — if the model can't be
        // loaded, we fail early and leave samples intact for a retry.
        let engine = resolve_local_engine(&app, &state).await?;

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

        match engine {
            LocalEngine::Whisper(ctx) => {
                let app_seg = app.clone();
                let app_prog = app.clone();
                tokio::task::spawn_blocking(move || {
                    transcribe::transcribe_local(
                        &ctx,
                        &samples,
                        prompt.as_deref(),
                        language.as_deref(),
                        // Stream partial text / progress to the capsule as whisper decodes.
                        move |partial| {
                            let _ = app_seg.emit_to("capsule", "capsule-partial-text", partial);
                        },
                        move |progress| {
                            let _ = app_prog.emit_to("capsule", "capsule-stt-progress", progress);
                        },
                    )
                })
                .await
                .map_err(|e| format!("Task join error: {}", e))?
            }
            #[cfg(feature = "parakeet")]
            LocalEngine::Parakeet(engine) => {
                // Parakeet has no vocabulary prompt.
                let _ = prompt;
                tokio::task::spawn_blocking(move || {
                    transcribe::transcribe_parakeet(&engine, &samples, language.as_deref())
                })
                .await
                .map_err(|e| format!("Task join error: {}", e))?
            }
        }
    }
    #[cfg(not(feature = "local-stt"))]
    {
        let _ = (app, state, prompt, language);
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
    )
    .await
}

// Stays async so the pre-paste and inter-key delays never block event
// processing; only the TIS keyboard-layout lookup hops to the main thread
// inside simulate_paste (main-thread-only on macOS 26). CGEvent posting is
// thread-safe and stays on the worker.
#[tauri::command(async)]
fn paste_text(app: tauri::AppHandle) -> Result<(), String> {
    let result = paste::simulate_paste(&app);
    // Time-based restore (not read-triggered): clipboard managers reading the
    // pasteboard on change must not cause a restore that beats the target
    // app's Cmd+V read. Scheduled even on paste failure so the user's
    // original clipboard always comes back.
    #[cfg(target_os = "macos")]
    clipboard::schedule_restore(clipboard::RESTORE_DELAY_MS);
    result
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

/// Point the modifier-hold monitor at a different trigger key
/// (fn, right-command, left-option, ...). Invalid names are rejected.
#[tauri::command]
fn set_trigger_modifier(modifier: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        fnkey::set_trigger_modifier(&modifier)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = modifier;
        Ok(())
    }
}

/// Detect whether the fn key is also bound to a macOS system action.
/// Linty's NSEvent monitors are observe-only, so a system binding (Dictation,
/// emoji picker) fires alongside push-to-talk — the cause of double-pasted
/// dictations (issue #32). Only AppleFnUsageType == 0 ("Do Nothing") is safe.
#[tauri::command]
fn check_fn_key_conflict() -> FnKeyConflict {
    #[cfg(target_os = "macos")]
    {
        let usage_type = fnkey::fn_usage_type();
        FnKeyConflict {
            usage_type,
            conflict: usage_type != Some(0),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        FnKeyConflict {
            usage_type: None,
            conflict: false,
        }
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

// NSPasteboard is thread-safe (XPC-backed; cmd_restore already runs off-main
// in the data-provider callback). Run these off the main thread — snapshotting
// a large clipboard (screenshots, files) can take seconds and must not beachball.
#[tauri::command(async)]
fn snapshot_clipboard() {
    #[cfg(target_os = "macos")]
    {
        clipboard::cmd_snapshot();
    }
}

#[tauri::command(async)]
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

#[tauri::command(async)]
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

// Deletes multi-GB model files — must not run on the main thread.
#[tauri::command(async)]
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

    // Unload any local model from memory
    #[cfg(feature = "local-stt")]
    {
        state.unload_local_models();
        if let Ok(mut name) = state.local_model_filename.lock() {
            *name = None;
        }
        state.local_model_last_used_at.store(0, Ordering::Relaxed);
        eprintln!("[reset] Unloaded local model");
    }
    #[cfg(not(feature = "local-stt"))]
    {
        let _ = &state;
    }

    eprintln!("[reset] All data cleared — app will reload");
    Ok(())
}

// ── Local STT commands ──

/// App icons for the given bundle ids as PNG data URLs (None when unresolvable).
/// Synchronous on purpose: it runs on the main thread, where AppKit's
/// NSWorkspace/NSImage calls belong. Results are cached for the app's lifetime.
#[tauri::command]
fn get_app_icons(
    state: tauri::State<'_, AppState>,
    bundle_ids: Vec<String>,
) -> std::collections::HashMap<String, Option<String>> {
    use base64::Engine as _;
    let mut cache = state
        .app_icon_cache
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut icons = std::collections::HashMap::with_capacity(bundle_ids.len());
    for bundle_id in bundle_ids {
        let icon = cache
            .entry(bundle_id.clone())
            .or_insert_with(|| {
                application::app_icon_png(&bundle_id).map(|png| {
                    format!(
                        "data:image/png;base64,{}",
                        base64::engine::general_purpose::STANDARD.encode(png)
                    )
                })
            })
            .clone();
        icons.insert(bundle_id, icon);
    }
    icons
}

#[tauri::command]
fn get_available_models() -> Vec<transcribe::ModelInfo> {
    #[cfg(feature = "parakeet")]
    let parakeet_supported = parakeet::is_supported();
    #[cfg(not(feature = "parakeet"))]
    let parakeet_supported = false;
    transcribe::available_models(parakeet_supported)
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
    let model_path = models_dir(&app)?.join(&filename);
    if transcribe::is_parakeet_model(&filename) {
        // A Parakeet bundle is a directory of CoreML models; only count it
        // when every required file is present (a partial download is not usable).
        #[cfg(feature = "parakeet")]
        return Ok(parakeet::models_exist(&model_path));
        #[cfg(not(feature = "parakeet"))]
        return Ok(false);
    }
    Ok(model_path.exists())
}

#[tauri::command]
async fn download_model_file(
    app: tauri::AppHandle,
    url: String,
    filename: String,
) -> Result<String, String> {
    let dest = models_dir(&app)?.join(&filename);

    if transcribe::is_parakeet_model(&filename) {
        #[cfg(feature = "parakeet")]
        {
            // FluidAudio fetches the multi-file CoreML bundle itself and
            // reports a 0–1 fraction covering download + Neural Engine compile.
            let _ = url;
            let app_progress = app.clone();
            let dir = dest.clone();
            tokio::task::spawn_blocking(move || {
                let mut last_pct: i64 = -1;
                parakeet::download(&dir, |fraction| {
                    let pct = (fraction.clamp(0.0, 1.0) * 100.0) as i64;
                    if pct != last_pct {
                        last_pct = pct;
                        let _ = app_progress.emit(
                            "model-download-progress",
                            serde_json::json!({
                                "downloaded": pct,
                                "total": 100,
                                "progress": pct,
                            }),
                        );
                    }
                })
            })
            .await
            .map_err(|e| format!("Task join error: {}", e))??;
            let _ = app.emit("model-download-complete", ());
            return Ok(dest.to_string_lossy().to_string());
        }
        #[cfg(not(feature = "parakeet"))]
        {
            let _ = url;
            return Err("This build does not include Parakeet support".to_string());
        }
    }

    transcribe::download_model(&app, &url, &dest).await?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command(async)]
fn delete_model_file(app: tauri::AppHandle, filename: String) -> Result<(), String> {
    let model_path = models_dir(&app)?.join(&filename);
    if model_path.is_dir() {
        // Parakeet bundles are directories of .mlmodelc packages.
        std::fs::remove_dir_all(&model_path)
            .map_err(|e| format!("Failed to delete {}: {}", filename, e))?;
        eprintln!("[cmd] Deleted model bundle: {}", filename);
    } else if model_path.exists() {
        std::fs::remove_file(&model_path)
            .map_err(|e| format!("Failed to delete {}: {}", filename, e))?;
        eprintln!("[cmd] Deleted model: {}", filename);
    }
    Ok(())
}

/// Remove model binaries that are no longer offered in the catalog
/// (tiny/base, plus the 3.1 GB Large V3 and 1.6 GB full-precision Turbo
/// dropped in favour of Turbo Q5 + Parakeet).
fn cleanup_deprecated_models(app: &tauri::AppHandle) {
    let data_dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(_) => return,
    };
    let models_dir = data_dir.join("models");
    for filename in &[
        "ggml-tiny.bin",
        "ggml-base.bin",
        "ggml-large-v3.bin",
        "ggml-large-v3-turbo.bin",
    ] {
        let path = models_dir.join(filename);
        if path.exists() {
            match std::fs::remove_file(&path) {
                Ok(()) => eprintln!("[cleanup] Removed deprecated model: {}", filename),
                Err(e) => eprintln!("[cleanup] Failed to remove {}: {}", filename, e),
            }
        }
    }
}

/// Load a local model (whisper .bin or the Parakeet bundle) into memory and make
/// it the active engine for transcribe_buffer.
#[tauri::command]
async fn load_local_model(
    #[allow(unused_variables)] app: tauri::AppHandle,
    #[allow(unused_variables)] state: tauri::State<'_, AppState>,
    #[allow(unused_variables)] filename: String,
) -> Result<(), String> {
    eprintln!("[cmd] load_local_model: {}", filename);
    #[cfg(feature = "local-stt")]
    {
        // Serialize with transcribe_buffer's lazy reload — never two loads at once
        let _load_guard = state.local_model_load_lock.lock().await;
        let engine = load_local_engine(&app, &state, &filename).await?;
        {
            let mut name_guard = state
                .local_model_filename
                .lock()
                .map_err(|e| e.to_string())?;
            *name_guard = Some(filename.clone());
        }
        state
            .local_model_last_used_at
            .store(now_epoch_ms(), Ordering::Relaxed);

        warm_up_local_engine(engine);

        eprintln!("[cmd] Local model loaded successfully: {}", filename);
        Ok(())
    }
    #[cfg(not(feature = "local-stt"))]
    Err("Local STT not available — rebuild with `local-stt` feature".into())
}

/// Remember which model to use for local STT WITHOUT loading it into memory.
/// Used when the user's engine preference is Cloud — the model lazy-loads in
/// transcribe_buffer if they switch to Local.
#[tauri::command]
fn register_local_model(
    #[allow(unused_variables)] state: tauri::State<'_, AppState>,
    #[allow(unused_variables)] filename: String,
) -> Result<(), String> {
    #[cfg(feature = "local-stt")]
    {
        eprintln!("[cmd] register_local_model: {} (lazy, not loaded)", filename);
        let mut guard = state
            .local_model_filename
            .lock()
            .map_err(|e| e.to_string())?;
        *guard = Some(filename);
    }
    Ok(())
}

/// Configure after how many minutes of inactivity the local model is unloaded
/// from memory (0 = never). Synced from the Settings UI on load and on change.
#[tauri::command]
fn set_model_idle_unload_minutes(
    #[allow(unused_variables)] state: tauri::State<'_, AppState>,
    #[allow(unused_variables)] minutes: u64,
) {
    #[cfg(feature = "local-stt")]
    {
        eprintln!("[cmd] set_model_idle_unload_minutes: {}", minutes);
        state
            .model_idle_unload_secs
            .store(minutes * 60, Ordering::Relaxed);
    }
}

#[tauri::command]
fn is_local_stt_available() -> bool {
    cfg!(feature = "local-stt")
}

// ── macOS: activation policy (Dock + menu bar visibility) ──

#[cfg(target_os = "macos")]
#[allow(deprecated)]
pub(crate) fn set_activation_policy_regular() {
    use cocoa::appkit::{NSApp, NSApplication, NSApplicationActivationPolicy};
    unsafe {
        let app = NSApp();
        app.setActivationPolicy_(
            NSApplicationActivationPolicy::NSApplicationActivationPolicyRegular,
        );
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn set_activation_policy_regular() {}

#[cfg(target_os = "macos")]
#[allow(deprecated)]
pub(crate) fn set_activation_policy_accessory() {
    use cocoa::appkit::{NSApp, NSApplication, NSApplicationActivationPolicy};
    unsafe {
        let app = NSApp();
        app.setActivationPolicy_(
            NSApplicationActivationPolicy::NSApplicationActivationPolicyAccessory,
        );
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn set_activation_policy_accessory() {}

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
        // Must be the first plugin registered. A second launch (double-open,
        // updater relaunch overlapping the old process) would run its own
        // fn-key monitors and paste pipeline — an independent double-paste
        // vector. Instead, surface the already-running instance.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            eprintln!("[single-instance] Second launch blocked — focusing existing window");
            set_activation_policy_regular();
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
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
            let settings = MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?;
            let app_submenu =
                Submenu::with_items(app, "Linty", true, &[&about, &check_updates, &sep, &settings, &reset, &sep2_app, &quit])?;

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
                "settings" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                    let _ = app.emit("menu-settings", ());
                }
                "reset-all-data" => { let _ = app.emit("menu-reset-all-data", ()); }
                "check-for-updates" => { let _ = app.emit("menu-check-for-updates", ()); }
                _ => {}
            }
        })
        .setup(|app| {

            // Tray icon (menu, engine selector, status)
            tray::init_tray(app)?;

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
            check_fn_key_conflict,
            set_trigger_modifier,
            open_system_settings,
            check_microphone,
            request_microphone,
            get_app_icons,
            get_available_models,
            get_models_dir,
            check_model_exists,
            download_model_file,
            delete_model_file,
            is_local_stt_available,
            set_model_idle_unload_minutes,
            register_local_model,
            load_local_model,
            reset_all_data,
            capsule::show_capsule,
            capsule::hide_capsule,
            capsule::emit_capsule_state,
            capsule::play_capsule_sound,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Linty");
}
