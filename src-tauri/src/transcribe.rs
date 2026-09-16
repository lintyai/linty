use reqwest::multipart;
use serde::Deserialize;
use std::sync::OnceLock;
use std::time::Duration;

#[cfg(test)]
#[path = "transcribe_tests.rs"]
mod tests;

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

// ── Audio and decoder evidence ──

/// Only short-circuit effectively digital silence (the same 1e-10 floor used
/// by FluidAudio's VAD). This is NOT a speech detector: noise can pass it.
/// A volume threshold or active-window ratio can discard quiet speech and
/// short answers surrounded by pauses, before the model gets to hear them.
pub(crate) fn audio_has_signal(samples: &[f32]) -> bool {
    samples.iter().any(|s| s.is_finite() && s.abs() > 1e-10)
}

// whisper.cpp's paired defaults. Neither a phrase nor low confidence alone
// proves silence. These thresholds do not apply to Parakeet's token confidence.
const WHISPER_NO_SPEECH_THRESHOLD: f32 = 0.6;
const WHISPER_LOGPROB_THRESHOLD: f32 = -1.0;

/// Repetition is diagnostic only; intentional emphasis and stutters are valid.
fn has_repeated_word(text: &str) -> bool {
    let normalized = text.to_lowercase();
    let mut words = normalized
        .split_whitespace()
        .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()))
        .filter(|w| !w.is_empty());
    let Some(first) = words.next() else {
        return false;
    };
    let mut count = 1;
    for word in words {
        if word != first {
            return false;
        }
        count += 1;
    }
    count >= 3
}

/// Never reject a transcript based on its words, byte length, or repetition.
fn finish_transcript(text: &str, engine: &str) -> String {
    let text = text.trim();
    if has_repeated_word(text) {
        log::info!("[transcribe] {engine}: repeated words retained; repetition alone is not evidence of silence");
    }
    text.to_string()
}

#[derive(Deserialize)]
struct GroqTranscription {
    text: String,
    #[serde(default)]
    segments: Option<Vec<GroqSegment>>,
}

#[derive(Deserialize)]
struct GroqSegment {
    #[serde(default)]
    text: String,
    no_speech_prob: Option<f32>,
    avg_logprob: Option<f32>,
}

impl GroqSegment {
    fn is_no_speech(&self) -> bool {
        match (self.no_speech_prob, self.avg_logprob) {
            (Some(silence), Some(confidence)) => {
                silence.is_finite()
                    && (0.0..=1.0).contains(&silence)
                    && confidence.is_finite()
                    && silence > WHISPER_NO_SPEECH_THRESHOLD
                    && confidence < WHISPER_LOGPROB_THRESHOLD
            }
            // Missing confidence is uncertainty, not permission to delete text.
            _ => false,
        }
    }
}

impl GroqTranscription {
    fn into_text(self) -> String {
        if let Some(segments) = self.segments {
            let reconstructed: String = segments.iter().map(|s| s.text.as_str()).collect();
            // Only reconstruct a filtered response when the segments cover the
            // full transcript exactly. Partial or changed metadata must not
            // silently truncate the top-level text.
            if !segments.is_empty() && reconstructed.trim() == self.text.trim() {
                let retained: String = segments
                    .iter()
                    .filter_map(|segment| {
                        if segment.is_no_speech() {
                            log::info!("[transcribe] Cloud: omitted segment with high silence probability and low confidence");
                            None
                        } else {
                            Some(segment.text.as_str())
                        }
                    })
                    .collect();
                return finish_transcript(&retained, "Cloud");
            }
        }
        finish_transcript(&self.text, "Cloud")
    }
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
    if !audio_has_signal(samples) {
        log::info!("[transcribe] Cloud: empty or digitally silent audio, skipping");
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
        .text("response_format", "verbose_json")
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

    let started = std::time::Instant::now();
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

    let text = result.into_text();
    log::info!(
        "[transcribe] Cloud done in {}ms: {} chars",
        started.elapsed().as_millis(),
        text.chars().count()
    );
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
    log::debug!(
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

    if !audio_has_signal(samples) {
        log::info!("[transcribe] Local: empty or digitally silent audio, skipping");
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
    // Longer inputs need timestamp-guided window advancement. Disabling it
    // forces fixed jumps and can skip speech when a window ends mid-sentence.
    // Timestamp tokens remain internal; the returned transcript is plain text.
    params.set_no_timestamps(duration_secs <= 20.0);
    params.set_suppress_nst(true);
    // whisper.cpp skips only when BOTH silence probability is high and
    // average log probability is low. Keep its high-confidence override.
    params.set_no_speech_thold(WHISPER_NO_SPEECH_THRESHOLD);
    params.set_logprob_thold(WHISPER_LOGPROB_THRESHOLD);
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

    log::debug!(
        "[transcribe] Params: threads={}, single_seg={}",
        n_threads,
        duration_secs <= 20.0
    );

    let started = std::time::Instant::now();
    state
        .full(params, samples)
        .map_err(|e| format!("Transcription failed: {}", e))?;

    let num_segments = state.full_n_segments();

    let mut text = String::new();

    for i in 0..num_segments {
        if let Some(segment) = state.get_segment(i) {
            match segment.to_str_lossy() {
                Ok(s) => {
                    log::debug!("[transcribe] segment {}: {} chars", i, s.chars().count());
                    text.push_str(&s);
                }
                Err(e) => {
                    log::warn!("[transcribe] segment {} text error: {}", i, e);
                }
            }
        } else {
            log::warn!("[transcribe] segment {} returned None", i);
        }
    }

    let result = text.trim().to_string();
    log::info!(
        "[transcribe] Whisper done in {:.0}ms: {} segments, {} chars",
        started.elapsed().as_millis(),
        num_segments,
        result.chars().count()
    );

    Ok(finish_transcript(&result, "Whisper"))
}

// ── Local STT via Parakeet (Neural Engine) ──

/// Run Parakeet TDT over `samples`, short-circuiting only digital silence.
/// Whisper's phrase lists and confidence thresholds do not apply to this engine.
/// `language` is an ISO 639-1 hint; "auto"/None lets the model detect it.
/// Parakeet has no vocabulary prompt.
#[cfg(feature = "parakeet")]
pub fn transcribe_parakeet(
    engine: &crate::parakeet::ParakeetEngine,
    samples: &[f32],
    language: Option<&str>,
) -> Result<String, String> {
    let duration_secs = samples.len() as f64 / 16000.0;
    log::debug!(
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

    if !audio_has_signal(samples) {
        log::info!("[transcribe] Parakeet: empty or digitally silent audio, skipping");
        return Ok(String::new());
    }

    let hint = language.filter(|l| *l != "auto" && !l.is_empty());
    let started = std::time::Instant::now();
    let result = engine.transcribe(samples, hint)?;
    let text = result.text.trim().to_string();
    log::info!(
        "[transcribe] Parakeet done in {:.0}ms (inference {:.0}ms): {} chars",
        started.elapsed().as_millis(),
        result.processing_secs * 1000.0,
        text.chars().count()
    );

    Ok(finish_transcript(&text, "Parakeet"))
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
    log::debug!(
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

    if !audio_has_signal(samples) {
        log::info!("[transcribe] Parakeet: empty or digitally silent audio, skipping");
        return Ok(Transcription::default());
    }

    let hint = language.filter(|l| *l != "auto" && !l.is_empty());
    let started = std::time::Instant::now();
    let result = engine.transcribe_with_vocabulary(samples, hint, terms)?;
    let (text, applied) =
        crate::vocabulary::apply_replacements(result.text.trim(), &result.replacements, terms);
    let text = text.trim().to_string();
    log::info!(
        "[transcribe] Parakeet done in {:.0}ms (inference {:.0}ms): {} chars; vocabulary candidates {}, applied {}",
        started.elapsed().as_millis(),
        result.processing_secs * 1000.0,
        text.chars().count(),
        result.replacements.len(),
        applied.len()
    );

    Ok(Transcription {
        text: finish_transcript(&text, "Parakeet vocabulary"),
        vocabulary_applied: applied,
    })
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
