use std::sync::atomic::AtomicU64;
use std::sync::{mpsc, Arc, Mutex};

/// Default idle time before the local whisper model is unloaded (15 minutes).
#[cfg(feature = "local-stt")]
pub const DEFAULT_MODEL_IDLE_UNLOAD_SECS: u64 = 15 * 60;

#[derive(Default)]
pub struct RecordingState {
    pub is_recording: bool,
    pub samples: Vec<f32>,
}

/// Commands sent to the dedicated audio thread.
pub enum AudioCommand {
    Start,
    Stop,
}

pub struct AppState {
    pub recording: Mutex<RecordingState>,
    /// Shared buffer that the audio callback writes into.
    pub audio_buffer: Arc<Mutex<Vec<f32>>>,
    /// Channel to send commands to the audio thread.
    pub audio_tx: Mutex<Option<mpsc::Sender<AudioCommand>>>,
    /// whisper-rs context for local STT (loaded once, reused).
    /// Wrapped in Arc so we can clone it out of the mutex before blocking inference.
    #[cfg(feature = "local-stt")]
    pub whisper_ctx: Mutex<Option<Arc<whisper_rs::WhisperContext>>>,
    /// Filename of the currently/last loaded model — lets transcribe_buffer
    /// transparently reload after the watchdog's idle unload.
    #[cfg(feature = "local-stt")]
    pub whisper_model_filename: Mutex<Option<String>>,
    /// Epoch millis of last whisper use (load/recording/transcription), 0 = never.
    /// Read by the watchdog to unload the model after idle.
    #[cfg(feature = "local-stt")]
    pub whisper_last_used_at: AtomicU64,
    /// Seconds of inactivity after which the model is unloaded (0 = never).
    /// Configurable from Settings; synced via set_model_idle_unload_minutes.
    #[cfg(feature = "local-stt")]
    pub model_idle_unload_secs: AtomicU64,
    /// Incremented by audio callback, read+reset by watchdog to detect runaway callbacks.
    pub audio_callback_count: Arc<AtomicU64>,
    /// Epoch millis when recording started, 0 when idle. Used by watchdog for max-duration check.
    /// No Arc needed — accessed only through AppState (already Arc-wrapped by Tauri).
    pub recording_started_at: AtomicU64,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            recording: Mutex::new(RecordingState::default()),
            audio_buffer: Arc::new(Mutex::new(Vec::new())),
            audio_tx: Mutex::new(None),
            #[cfg(feature = "local-stt")]
            whisper_ctx: Mutex::new(None),
            #[cfg(feature = "local-stt")]
            whisper_model_filename: Mutex::new(None),
            #[cfg(feature = "local-stt")]
            whisper_last_used_at: AtomicU64::new(0),
            #[cfg(feature = "local-stt")]
            model_idle_unload_secs: AtomicU64::new(DEFAULT_MODEL_IDLE_UNLOAD_SECS),
            audio_callback_count: Arc::new(AtomicU64::new(0)),
            recording_started_at: AtomicU64::new(0),
        }
    }
}
