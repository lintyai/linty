use std::sync::{mpsc, Arc, Mutex};

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
    #[cfg(feature = "local-stt")]
    pub whisper_ctx: Mutex<Option<whisper_rs::WhisperContext>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            recording: Mutex::new(RecordingState::default()),
            audio_buffer: Arc::new(Mutex::new(Vec::new())),
            audio_tx: Mutex::new(None),
            #[cfg(feature = "local-stt")]
            whisper_ctx: Mutex::new(None),
        }
    }
}
