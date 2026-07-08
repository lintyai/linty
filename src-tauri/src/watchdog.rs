use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager};

use crate::state::{AppState, AudioCommand};

const TICK_INTERVAL_SECS: u64 = 2;
/// Callbacks/sec threshold — CoreAudio typically fires ~93/sec at 16kHz.
/// 1000/sec sustained for 2 consecutive ticks indicates a runaway callback.
const MAX_CALLBACKS_PER_SEC: u64 = 1000;
/// Maximum recording duration before auto-stop (5 minutes).
const MAX_RECORDING_DURATION_SECS: u64 = 5 * 60;
/// Re-check fn-key monitor liveness every N ticks (15 × 2s = 30s).
#[cfg(target_os = "macos")]
const MONITOR_CHECK_EVERY_TICKS: u64 = 15;

pub fn start(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Resolve state once — AppState lives for the lifetime of the app.
        // Busy-wait only until Tauri has finished .manage(); in practice immediate.
        let state = loop {
            if let Some(s) = app.try_state::<AppState>() {
                break s;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        };

        let mut consecutive_high_ticks: u32 = 0;
        #[cfg(target_os = "macos")]
        let mut tick_count: u64 = 0;

        loop {
            tokio::time::sleep(std::time::Duration::from_secs(TICK_INTERVAL_SECS)).await;

            // ── Check 0: fn-key monitor liveness ──
            // If monitor creation failed (e.g., a wake reinit fired before the
            // window server was ready), the fn key stays dead until the next
            // wake. Retry from the main thread — NSEvent APIs are main-thread-only.
            // No-ops instantly while the monitor is active.
            #[cfg(target_os = "macos")]
            {
                tick_count += 1;
                if tick_count % MONITOR_CHECK_EVERY_TICKS == 0 {
                    let app_clone = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        crate::fnkey::reinit_monitor_if_needed(app_clone);
                    });
                }
            }

            // ── Check 1: Callback rate ──
            let count = state
                .audio_callback_count
                .swap(0, Ordering::Relaxed);
            let rate = count / TICK_INTERVAL_SECS;

            if rate > MAX_CALLBACKS_PER_SEC {
                consecutive_high_ticks += 1;
                eprintln!(
                    "[watchdog] High callback rate: {}/sec (tick {}/2)",
                    rate, consecutive_high_ticks
                );
            } else {
                consecutive_high_ticks = 0;
            }

            if consecutive_high_ticks >= 2 {
                eprintln!("[watchdog] Runaway audio callbacks detected — recovering");
                recover(&app, &state, "Abnormal audio activity detected").await;
                consecutive_high_ticks = 0;
                continue;
            }

            // ── Check 2: Recording duration ──
            let started_at = state.recording_started_at.load(Ordering::Relaxed);
            if started_at > 0 {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;
                let elapsed_secs = (now.saturating_sub(started_at)) / 1000;

                if elapsed_secs > MAX_RECORDING_DURATION_SECS {
                    eprintln!(
                        "[watchdog] Recording exceeded {}s limit ({}s) — recovering",
                        MAX_RECORDING_DURATION_SECS, elapsed_secs
                    );
                    recover(&app, &state, "Recording exceeded maximum duration").await;
                    continue;
                }
            }

            // ── Check 3: idle model unload (local STT) ──
            // The whisper model keeps 0.6–3.1 GB resident. Drop it after the
            // user-configured idle time (Settings; 0 = never); transcribe_buffer
            // reloads it transparently on the next dictation. An in-flight
            // inference is safe — it holds its own Arc clone.
            #[cfg(feature = "local-stt")]
            {
                let unload_secs = state.model_idle_unload_secs.load(Ordering::Relaxed);
                let last_used = state.whisper_last_used_at.load(Ordering::Relaxed);
                if unload_secs > 0 && last_used > 0 {
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;
                    let idle_secs = now.saturating_sub(last_used) / 1000;
                    if idle_secs > unload_secs {
                        let unloaded = state
                            .whisper_ctx
                            .lock()
                            .map(|mut guard| guard.take().is_some())
                            .unwrap_or(false);
                        state.whisper_last_used_at.store(0, Ordering::Relaxed);
                        if unloaded {
                            eprintln!(
                                "[watchdog] Whisper model idle for {}min — unloaded to free memory",
                                idle_secs / 60
                            );
                            let _ = app.emit("model-idle-unloaded", ());
                        }
                    }
                }
            }
        }
    });
}

async fn recover(app: &tauri::AppHandle, state: &AppState, reason: &str) {
    // 1. Send Stop command to audio thread
    if let Ok(tx_guard) = state.audio_tx.lock() {
        if let Some(tx) = tx_guard.as_ref() {
            let _ = tx.send(AudioCommand::Stop);
        }
    }

    // 2. Clear state
    state.recording_started_at.store(0, Ordering::Relaxed);
    state.audio_callback_count.store(0, Ordering::Relaxed);

    // Drop buffer contents and release memory (not just clear — avoids retaining
    // a potentially huge allocation from a runaway recording).
    if let Ok(mut buf) = state.audio_buffer.lock() {
        *buf = Vec::new();
    }

    if let Ok(mut rec) = state.recording.lock() {
        rec.is_recording = false;
        rec.samples = Vec::new();
    }

    // 3. Drop stale audio_tx so a fresh thread is spawned next recording
    if let Ok(mut tx_guard) = state.audio_tx.lock() {
        *tx_guard = None;
    }

    // 4. Emit recovery event to frontend
    let _ = app.emit("watchdog-recovery", reason);

    // 5. Hide capsule after a short delay
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        let _ = app_clone.emit("recording-stopped", ());
        #[cfg(target_os = "macos")]
        {
            use tauri_nspanel::ManagerExt;
            if let Ok(panel) = app_clone.get_webview_panel("capsule") {
                panel.order_out(None);
            }
        }
    });

    eprintln!("[watchdog] Recovery complete: {}", reason);
}
