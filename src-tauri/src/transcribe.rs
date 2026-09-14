use reqwest::multipart;
use serde::Deserialize;
use std::sync::OnceLock;
use std::time::Duration;

/// Shared HTTP client for Groq API calls — avoids rebuilding TLS state
/// and connection pools per transcription.
fn api_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60))
            .build()
            .expect("Failed to build HTTP client")
    })
}

/// Shared HTTP client for model downloads (longer timeout).
fn download_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(600))
            .build()
            .expect("Failed to build HTTP client")
    })
}

// ── Silence & hallucination guards ──

/// Minimum RMS energy threshold for f32 samples in [-1.0, 1.0].
/// Audio below this is considered silence.
const SILENCE_RMS_THRESHOLD: f32 = 0.01;

/// Minimum fraction of 50ms windows that must contain speech-level energy.
/// Kept very low (2%) — only rejects truly blank/muted recordings.
/// Natural speech with long pauses easily exceeds this.
/// Whisper hallucination guard handles false positives from near-silent audio.
const MIN_SPEECH_RATIO: f32 = 0.02;

/// Returns true if enough of the audio contains speech-level energy.
pub(crate) fn audio_has_speech(samples: &[f32]) -> bool {
    // 800 samples = 50ms at 16kHz
    let window_size = 800;
    let total_windows = samples.len() / window_size;
    if total_windows == 0 {
        return false;
    }
    let active_windows = samples
        .chunks(window_size)
        .filter(|chunk| {
            let sum_sq: f64 = chunk.iter().map(|&s| (s as f64) * (s as f64)).sum();
            let rms = (sum_sq / chunk.len() as f64).sqrt() as f32;
            rms > SILENCE_RMS_THRESHOLD
        })
        .count();
    (active_windows as f32 / total_windows as f32) >= MIN_SPEECH_RATIO
}

/// Known Whisper hallucination phrases on silent/near-silent audio.
const HALLUCINATION_PHRASES: &[&str] = &[
    "you",
    "thank you",
    "thanks",
    "thanks for watching",
    "thank you for watching",
    "the end",
    "bye",
    "bye bye",
    "so",
    "okay",
    "the",
    "subtitles by the amara.org community",
    "subtitles by",
    "thanks for listening",
    "please subscribe",
    "subscribe",
    "like and subscribe",
    "see you next time",
];

/// Returns true if the text is a known Whisper hallucination (or degenerate
/// output any engine can produce on near-silence: empty, 1–2 chars, or one
/// word repeated).
pub(crate) fn is_hallucination(text: &str) -> bool {
    let normalized = text.trim().to_lowercase();
    if normalized.is_empty() || normalized.len() <= 2 {
        return true;
    }
    if HALLUCINATION_PHRASES.iter().any(|&phrase| normalized == phrase) {
        return true;
    }
    // Detect repetition: same word repeated 3+ times
    let words: Vec<&str> = normalized.split_whitespace().collect();
    if words.len() >= 3 {
        let first = words[0];
        if words.iter().all(|&w| w == first) {
            return true;
        }
    }
    false
}

#[derive(Deserialize)]
struct GroqTranscription {
    text: String,
}

/// Encode f32 PCM samples (16kHz mono) into a WAV byte buffer.
pub fn encode_wav(samples: &[f32]) -> Vec<u8> {
    let sample_rate: u32 = 16000;
    let bits_per_sample: u16 = 16;
    let num_channels: u16 = 1;
    let byte_rate = sample_rate * (bits_per_sample as u32 / 8) * num_channels as u32;
    let block_align = num_channels * (bits_per_sample / 8);
    let data_size = (samples.len() * 2) as u32;
    let file_size = 36 + data_size;

    let mut buf = Vec::with_capacity(file_size as usize + 8);

    // RIFF header
    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&file_size.to_le_bytes());
    buf.extend_from_slice(b"WAVE");

    // fmt chunk
    buf.extend_from_slice(b"fmt ");
    buf.extend_from_slice(&16u32.to_le_bytes());
    buf.extend_from_slice(&1u16.to_le_bytes());
    buf.extend_from_slice(&num_channels.to_le_bytes());
    buf.extend_from_slice(&sample_rate.to_le_bytes());
    buf.extend_from_slice(&byte_rate.to_le_bytes());
    buf.extend_from_slice(&block_align.to_le_bytes());
    buf.extend_from_slice(&bits_per_sample.to_le_bytes());

    // data chunk
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&data_size.to_le_bytes());

    for &sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let val = (clamped * 32767.0) as i16;
        buf.extend_from_slice(&val.to_le_bytes());
    }

    buf
}

/// Transcribe audio via Groq's Whisper Large v3 Turbo API.
pub async fn transcribe_cloud(
    samples: &[f32],
    api_key: &str,
    prompt: Option<&str>,
    language: Option<&str>,
) -> Result<String, String> {
    if !audio_has_speech(samples) {
        eprintln!("[transcribe] Cloud: audio too quiet, skipping");
        return Ok(String::new());
    }

    let wav_data = encode_wav(samples);

    let file_part = multipart::Part::bytes(wav_data)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| e.to_string())?;

    // Turbo is ~3x cheaper and faster on Groq with comparable accuracy.
    let mut form = multipart::Form::new()
        .text("model", "whisper-large-v3-turbo")
        .text("response_format", "json")
        .part("file", file_part);

    // Only set language if explicitly specified (not "auto")
    match language {
        Some(lang) if lang != "auto" && !lang.is_empty() => {
            form = form.text("language", lang.to_string());
        }
        _ => {} // auto-detect: omit language field
    }

    if let Some(p) = prompt {
        if !p.is_empty() {
            form = form.text("prompt", p.to_string());
        }
    }

    let response = api_client()
        .post("https://api.groq.com/openai/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Groq API error {}: {}", status, body));
    }

    let result: GroqTranscription = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let text = result.text.trim().to_string();
    if is_hallucination(&text) {
        eprintln!("[transcribe] Cloud: filtered hallucination: {:?}", text);
        return Ok(String::new());
    }

    Ok(text)
}

// ── Local STT via whisper-rs ──

/// Run whisper.cpp over `samples`. `on_partial` receives the accumulated text
/// as each segment decodes; `on_progress` receives 0–100. Both may fire from
/// whisper's worker thread.
#[cfg(feature = "local-stt")]
pub fn transcribe_local<P, G>(
    ctx: &whisper_rs::WhisperContext,
    samples: &[f32],
    prompt: Option<&str>,
    language: Option<&str>,
    mut on_partial: P,
    on_progress: G,
) -> Result<String, String>
where
    P: FnMut(&str) + 'static,
    G: FnMut(i32) + 'static,
{
    use whisper_rs::{FullParams, SamplingStrategy};

    let duration_secs = samples.len() as f64 / 16000.0;
    eprintln!(
        "[transcribe] Starting local STT: {} samples ({:.1}s)",
        samples.len(),
        duration_secs
    );

    if samples.len() < 1600 {
        return Err(format!(
            "Audio too short ({:.1}s) — need at least 0.1s",
            duration_secs
        ));
    }

    if !audio_has_speech(samples) {
        eprintln!("[transcribe] Local: audio too quiet, skipping");
        return Ok(String::new());
    }

    let mut state = ctx.create_state().map_err(|e| format!("Failed to create state: {}", e))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });

    // ── Optimized thread count ──
    let n_threads = std::thread::available_parallelism()
        .map(|n| (n.get() / 2).clamp(4, 8) as i32)
        .unwrap_or(4);
    params.set_n_threads(n_threads);

    // Set language: None for auto-detect, Some(code) for explicit
    match language {
        Some(lang) if lang != "auto" && !lang.is_empty() => {
            params.set_language(Some(lang));
        }
        _ => {
            params.set_language(None);
        }
    }

    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_no_context(true);
    params.set_suppress_blank(true);
    params.set_no_timestamps(true);
    params.set_suppress_nst(true);
    params.set_no_speech_thold(0.6);
    params.set_entropy_thold(2.4);

    // Single segment for short recordings — avoids segment boundary overhead
    if duration_secs <= 20.0 {
        params.set_single_segment(true);
    }

    if let Some(p) = prompt {
        if !p.is_empty() {
            params.set_initial_prompt(p);
            params.set_no_context(false);
        }
    }

    // ── Streaming segment callback — partial text as words appear ──
    let mut accumulated = String::new();
    params.set_segment_callback_safe_lossy(move |data: whisper_rs::SegmentCallbackData| {
        accumulated.push_str(&data.text);
        on_partial(&accumulated);
    });

    // ── Progress callback — 0-100% ──
    params.set_progress_callback_safe(on_progress);

    eprintln!(
        "[transcribe] Params: threads={}, single_seg={}",
        n_threads,
        duration_secs <= 20.0
    );

    state
        .full(params, samples)
        .map_err(|e| format!("Transcription failed: {}", e))?;

    let num_segments = state.full_n_segments();
    eprintln!("[transcribe] Whisper produced {} segments", num_segments);

    let mut text = String::new();

    for i in 0..num_segments {
        if let Some(segment) = state.get_segment(i) {
            match segment.to_str_lossy() {
                Ok(s) => {
                    eprintln!("[transcribe] segment {}: {:?}", i, s.as_ref());
                    text.push_str(&s);
                }
                Err(e) => {
                    eprintln!("[transcribe] segment {} text error: {}", i, e);
                }
            }
        } else {
            eprintln!("[transcribe] segment {} returned None", i);
        }
    }

    let result = text.trim().to_string();
    eprintln!("[transcribe] Final text: {:?}", result);

    if is_hallucination(&result) {
        eprintln!("[transcribe] Local: filtered hallucination: {:?}", result);
        return Ok(String::new());
    }

    Ok(result)
}

// ── Local STT via Parakeet (Neural Engine) ──

/// Run Parakeet TDT over `samples` with the same silence and degenerate-output
/// guards as the whisper path. `language` is an ISO 639-1 hint; "auto"/None
/// lets the model detect it. Parakeet has no vocabulary prompt.
#[cfg(feature = "parakeet")]
pub fn transcribe_parakeet(
    engine: &crate::parakeet::ParakeetEngine,
    samples: &[f32],
    language: Option<&str>,
) -> Result<String, String> {
    let duration_secs = samples.len() as f64 / 16000.0;
    eprintln!(
        "[transcribe] Starting Parakeet: {} samples ({:.1}s)",
        samples.len(),
        duration_secs
    );

    if samples.len() < 1600 {
        return Err(format!(
            "Audio too short ({:.1}s) — need at least 0.1s",
            duration_secs
        ));
    }

    if !audio_has_speech(samples) {
        eprintln!("[transcribe] Parakeet: audio too quiet, skipping");
        return Ok(String::new());
    }

    let hint = language.filter(|l| *l != "auto" && !l.is_empty());
    let started = std::time::Instant::now();
    let result = engine.transcribe(samples, hint)?;
    eprintln!(
        "[transcribe] Parakeet done in {:.0}ms (inference {:.0}ms)",
        started.elapsed().as_millis(),
        result.processing_secs * 1000.0
    );

    let text = result.text.trim().to_string();
    eprintln!("[transcribe] Final text: {:?}", text);
    if is_hallucination(&text) {
        eprintln!("[transcribe] Parakeet: filtered degenerate output: {:?}", text);
        return Ok(String::new());
    }
    Ok(text)
}

/// What a local transcription produced: the text, plus any dictionary words the
/// engine itself corrected (Parakeet vocabulary), so the UI can count them.
#[derive(serde::Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Transcription {
    pub text: String,
    pub vocabulary_applied: Vec<crate::vocabulary::AppliedReplacement>,
}

impl From<String> for Transcription {
    fn from(text: String) -> Self {
        Self { text, vocabulary_applied: Vec::new() }
    }
}

/// Parakeet with dictionary terms: the TDT transcript is rescored against the
/// terms by FluidAudio's CTC keyword spotter, and only candidates that resemble a
/// term (or one of its known wrong spellings) are applied.
#[cfg(feature = "parakeet")]
pub fn transcribe_parakeet_with_vocabulary(
    engine: &crate::parakeet::ParakeetEngine,
    samples: &[f32],
    language: Option<&str>,
    terms: &[crate::vocabulary::VocabTerm],
) -> Result<Transcription, String> {
    let duration_secs = samples.len() as f64 / 16000.0;
    eprintln!(
        "[transcribe] Starting Parakeet with {} dictionary terms: {} samples ({:.1}s)",
        terms.len(),
        samples.len(),
        duration_secs
    );

    if samples.len() < 1600 {
        return Err(format!(
            "Audio too short ({:.1}s) — need at least 0.1s",
            duration_secs
        ));
    }

    if !audio_has_speech(samples) {
        eprintln!("[transcribe] Parakeet: audio too quiet, skipping");
        return Ok(Transcription::default());
    }

    let hint = language.filter(|l| *l != "auto" && !l.is_empty());
    let started = std::time::Instant::now();
    let result = engine.transcribe_with_vocabulary(samples, hint, terms)?;
    let (text, applied) =
        crate::vocabulary::apply_replacements(result.text.trim(), &result.replacements, terms);
    eprintln!(
        "[transcribe] Parakeet done in {:.0}ms (inference {:.0}ms); vocabulary candidates {}, applied {}",
        started.elapsed().as_millis(),
        result.processing_secs * 1000.0,
        result.replacements.len(),
        applied.len()
    );
    for change in &applied {
        eprintln!("[transcribe]   {} -> {}", change.from, change.to);
    }

    let text = text.trim().to_string();
    eprintln!("[transcribe] Final text: {:?}", text);
    if is_hallucination(&text) {
        eprintln!("[transcribe] Parakeet: filtered degenerate output: {:?}", text);
        return Ok(Transcription::default());
    }
    Ok(Transcription { text, vocabulary_applied: applied })
}

// ── Model catalog & download ──

/// Which local inference engine a catalog entry runs on.
#[derive(serde::Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum ModelBackend {
    /// whisper.cpp GGML file (Metal GPU).
    Whisper,
    /// NVIDIA Parakeet TDT CoreML bundle (Neural Engine) via FluidAudio.
    Parakeet,
}

/// Bundle id (directory name inside the models dir) for Parakeet TDT 0.6B v3.
/// FluidAudio derives this name from its HuggingFace repo, so it must match.
pub const PARAKEET_V3_ID: &str = "parakeet-tdt-0.6b-v3";

/// Bundle id of the Parakeet CTC 110M keyword-spotter models that let Parakeet
/// recognise dictionary words. FluidAudio keeps the "-coreml" suffix for this one.
pub const PARAKEET_CTC_ID: &str = "parakeet-ctc-110m-coreml";

/// True when `filename` refers to the Parakeet bundle rather than a whisper file.
pub fn is_parakeet_model(filename: &str) -> bool {
    filename == PARAKEET_V3_ID
}

/// Available model variants with download URLs and sizes.
#[derive(serde::Serialize, Clone)]
pub struct ModelInfo {
    pub name: String,
    /// Whisper: GGML filename. Parakeet: bundle directory name.
    pub filename: String,
    /// Whisper: direct download URL. Parakeet: informational (FluidAudio fetches the bundle).
    pub url: String,
    pub size_mb: u64,
    pub description: String,
    pub backend: ModelBackend,
}

/// Catalog shown in Settings/Onboarding, best first. The first entry is the
/// recommended default that onboarding downloads automatically: Parakeet when
/// this build includes the bridge and the machine can run it (Apple Silicon),
/// otherwise whisper Turbo Q5.
pub fn available_models(parakeet_supported: bool) -> Vec<ModelInfo> {
    let mut models = Vec::with_capacity(2);
    if parakeet_supported {
        models.push(ModelInfo {
            name: "Parakeet TDT v3 (~500 MB)".into(),
            filename: PARAKEET_V3_ID.into(),
            url: "https://huggingface.co/FluidInference/parakeet-tdt-0.6b-v3-coreml".into(),
            size_mb: 500,
            description: "Runs on the Neural Engine · sub-second · 25 European languages · no vocabulary prompt".into(),
            backend: ModelBackend::Parakeet,
        });
    }
    models.push(ModelInfo {
        name: "Whisper Large Turbo Q5 (574 MB)".into(),
        filename: "ggml-large-v3-turbo-q5_0.bin".into(),
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin".into(),
        size_mb: 574,
        description: "Runs on the GPU · same languages · supports the vocabulary prompt".into(),
        backend: ModelBackend::Whisper,
    });
    models[0].name.push_str(" ★ Recommended");
    models
}

/// Download a model file with progress events.
pub async fn download_model(
    app: &tauri::AppHandle,
    url: &str,
    dest: &std::path::Path,
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tauri::Emitter;

    // Create parent dir
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {}", e))?;
    }

    let response = download_client()
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed: HTTP {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    let mut file =
        std::fs::File::create(dest).map_err(|e| format!("Failed to create file: {}", e))?;

    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {}", e))?;
        std::io::Write::write_all(&mut file, &chunk)
            .map_err(|e| format!("File write error: {}", e))?;
        downloaded += chunk.len() as u64;

        if total_size > 0 {
            let progress = (downloaded as f64 / total_size as f64 * 100.0) as u32;
            let _ = app.emit(
                "model-download-progress",
                serde_json::json!({
                    "downloaded": downloaded,
                    "total": total_size,
                    "progress": progress,
                }),
            );
        }
    }

    let _ = app.emit("model-download-complete", ());
    Ok(())
}
