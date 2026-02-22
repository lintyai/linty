use reqwest::multipart;
use serde::Deserialize;

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
pub async fn transcribe_cloud(samples: &[f32], api_key: &str) -> Result<String, String> {
    let wav_data = encode_wav(samples);

    let file_part = multipart::Part::bytes(wav_data)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| e.to_string())?;

    let form = multipart::Form::new()
        .text("model", "whisper-large-v3")
        .text("response_format", "json")
        .text("language", "en")
        .part("file", file_part);

    let client = reqwest::Client::new();
    let response = client
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

    Ok(result.text)
}

// ── Local STT via whisper-rs ──

#[cfg(feature = "local-stt")]
pub fn transcribe_local(
    ctx: &whisper_rs::WhisperContext,
    samples: &[f32],
) -> Result<String, String> {
    use whisper_rs::{FullParams, SamplingStrategy};

    let mut state = ctx.create_state().map_err(|e| format!("Failed to create state: {}", e))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en"));
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_single_segment(false);
    params.set_no_context(true);
    // Slightly suppress non-speech tokens for cleaner output
    params.set_suppress_blank(true);

    state
        .full(params, samples)
        .map_err(|e| format!("Transcription failed: {}", e))?;

    let num_segments = state.full_n_segments().map_err(|e| format!("Segment error: {}", e))?;
    let mut text = String::new();

    for i in 0..num_segments {
        if let Ok(segment) = state.full_get_segment_text(i) {
            text.push_str(&segment);
        }
    }

    Ok(text.trim().to_string())
}

// ── Model download ──

/// Available model variants with HuggingFace URLs and sizes.
#[derive(serde::Serialize, Clone)]
pub struct ModelInfo {
    pub name: String,
    pub filename: String,
    pub url: String,
    pub size_mb: u64,
}

pub fn available_models() -> Vec<ModelInfo> {
    vec![
        ModelInfo {
            name: "Tiny (75 MB)".into(),
            filename: "ggml-tiny.bin".into(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin".into(),
            size_mb: 75,
        },
        ModelInfo {
            name: "Base (142 MB)".into(),
            filename: "ggml-base.bin".into(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin".into(),
            size_mb: 142,
        },
        ModelInfo {
            name: "Small (466 MB)".into(),
            filename: "ggml-small.bin".into(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin".into(),
            size_mb: 466,
        },
        ModelInfo {
            name: "Medium (1.5 GB)".into(),
            filename: "ggml-medium.bin".into(),
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin".into(),
            size_mb: 1500,
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

    let client = reqwest::Client::new();
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
