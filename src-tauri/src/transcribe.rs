use reqwest::multipart;
use serde::Deserialize;
use std::time::Duration;

// ── Silence & hallucination guards ──

/// Minimum RMS energy threshold for f32 samples in [-1.0, 1.0].
/// Audio below this is considered silence.
const SILENCE_RMS_THRESHOLD: f32 = 0.02;

/// Minimum fraction of 50ms windows that must contain speech-level energy.
const MIN_SPEECH_RATIO: f32 = 0.10;

/// Returns true if enough of the audio contains speech-level energy.
fn audio_has_speech(samples: &[f32]) -> bool {
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

/// Returns true if the text is a known Whisper hallucination.
fn is_hallucination(text: &str) -> bool {
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

/// Transcribe audio via Groq Whisper Large v3 API.
pub async fn transcribe_cloud(
    samples: &[f32],
    api_key: &str,
    prompt: Option<&str>,
    language: Option<&str>,
    translate: bool,
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

    let mut form = multipart::Form::new()
        .text("model", "whisper-large-v3")
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

    // Use translations endpoint when translate is enabled
    let endpoint = if translate {
        "https://api.groq.com/openai/v1/audio/translations"
    } else {
        "https://api.groq.com/openai/v1/audio/transcriptions"
    };

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
    let response = client
        .post(endpoint)
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

#[cfg(feature = "local-stt")]
pub fn transcribe_local_with_events(
    ctx: &whisper_rs::WhisperContext,
    samples: &[f32],
    prompt: Option<&str>,
    language: Option<&str>,
    translate: bool,
    app: tauri::AppHandle,
) -> Result<String, String> {
    use tauri::Emitter;
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

    params.set_translate(translate);
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

    // ── Streaming segment callback — emit partial text to capsule as words appear ──
    let app_seg = app.clone();
    let mut accumulated = String::new();
    params.set_segment_callback_safe_lossy(move |data: whisper_rs::SegmentCallbackData| {
        accumulated.push_str(&data.text);
        let _ = app_seg.emit_to("capsule", "capsule-partial-text", &accumulated);
    });

    // ── Progress callback — emit 0-100% to capsule ──
    let app_prog = app;
    params.set_progress_callback_safe(move |progress: i32| {
        let _ = app_prog.emit_to("capsule", "capsule-stt-progress", progress);
    });

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

// ── Model download ──

/// Available model variants with HuggingFace URLs and sizes.
#[derive(serde::Serialize, Clone)]
pub struct ModelInfo {
    pub name: String,
    pub filename: String,
    pub url: String,
    pub size_mb: u64,
    pub description: String,
}

pub fn available_models() -> Vec<ModelInfo> {
    vec![
        ModelInfo {
            name: "Medium (1.5 GB)".into(),
            filename: "ggml-medium.bin".into(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin".into(),
            size_mb: 1500,
            description: "High accuracy, great for technical or multilingual speech".into(),
        },
        ModelInfo {
            name: "Large Turbo Q5 (574 MB) ★ Recommended".into(),
            filename: "ggml-large-v3-turbo-q5_0.bin".into(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin".into(),
            size_mb: 574,
            description: "2-3x faster than Large, near-identical accuracy, quantized for speed".into(),
        },
        ModelInfo {
            name: "Large Turbo (1.6 GB)".into(),
            filename: "ggml-large-v3-turbo.bin".into(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin".into(),
            size_mb: 1600,
            description: "2-3x faster than Large, full precision turbo variant".into(),
        },
        ModelInfo {
            name: "Large (3.1 GB)".into(),
            filename: "ggml-large-v3.bin".into(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin".into(),
            size_mb: 3100,
            description: "Best accuracy, same model as Cloud mode but runs locally".into(),
        },
    ]
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

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
    let response = client
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
