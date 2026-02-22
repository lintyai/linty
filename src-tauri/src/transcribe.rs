use reqwest::multipart;
use serde::Deserialize;
use std::time::Duration;

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

    Ok(result.text)
}

// ── Local STT via whisper-rs ──

#[cfg(feature = "local-stt")]
pub fn transcribe_local(
    ctx: &whisper_rs::WhisperContext,
    samples: &[f32],
    prompt: Option<&str>,
    language: Option<&str>,
    translate: bool,
) -> Result<String, String> {
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

    let mut state = ctx.create_state().map_err(|e| format!("Failed to create state: {}", e))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });

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
    params.set_single_segment(false);
    params.set_no_context(true);
    params.set_suppress_blank(true);

    if let Some(p) = prompt {
        if !p.is_empty() {
            params.set_initial_prompt(p);
            params.set_no_context(false);
        }
    }

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
            name: "Small (466 MB)".into(),
            filename: "ggml-small.bin".into(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin".into(),
            size_mb: 466,
            description: "Balanced speed and accuracy, handles accents well".into(),
        },
        ModelInfo {
            name: "Medium (1.5 GB)".into(),
            filename: "ggml-medium.bin".into(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin".into(),
            size_mb: 1500,
            description: "High accuracy, great for technical or multilingual speech".into(),
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
