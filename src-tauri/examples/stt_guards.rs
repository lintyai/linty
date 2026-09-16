//! Compare the app's actual local transcription paths and optional VAD gates.
//! stt_guards <whisper|parakeet> <models-dir> <manifest.json> <report.json> [vad-model]
//! Models/audio must already exist. No recording, network, or app settings changes.
use linty_lib::{parakeet::ParakeetEngine, transcribe};
use serde::Deserialize;
use serde_json::json;
use std::{fs, path::Path, time::Instant};
use whisper_rs::{
    WhisperContext, WhisperContextParameters, WhisperVadContext, WhisperVadContextParams,
    WhisperVadParams,
};

#[derive(Deserialize)]
struct Manifest {
    cases: Vec<Case>,
}
#[derive(Deserialize)]
struct Case {
    name: String,
    wav: String,
    text: String,
    speech: bool,
    category: String,
    language: String,
}

fn normalized(text: &str) -> String {
    text.to_lowercase()
        .split_whitespace()
        .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()))
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if !(4..=5).contains(&args.len()) || !["whisper", "parakeet"].contains(&args[0].as_str()) {
        return Err("usage: stt_guards <whisper|parakeet> <models-dir> <manifest.json> <report.json> [vad-model]".into());
    }
    let manifest_path = Path::new(&args[2]);
    let manifest: Manifest = serde_json::from_slice(&fs::read(manifest_path)?)?;
    let models = Path::new(&args[1]);
    let whisper = if args[0] == "whisper" {
        Some(WhisperContext::new_with_params(
            models
                .join("ggml-large-v3-turbo-q5_0.bin")
                .to_str()
                .ok_or("invalid path")?,
            WhisperContextParameters::default(),
        )?)
    } else {
        None
    };
    let parakeet = if args[0] == "parakeet" {
        Some(ParakeetEngine::load(
            &models.join(transcribe::PARAKEET_V3_ID),
        )?)
    } else {
        None
    };
    let mut results = Vec::new();
    for case in manifest.cases {
        let mut reader = hound::WavReader::open(manifest_path.parent().unwrap().join(&case.wav))?;
        let spec = reader.spec();
        if spec.channels != 1
            || spec.sample_rate != 16000
            || spec.bits_per_sample != 16
            || spec.sample_format != hound::SampleFormat::Int
        {
            return Err("fixtures must be 16 kHz mono 16-bit PCM".into());
        }
        let samples = reader
            .samples::<i16>()
            .map(|s| s.map(|n| n as f32 / 32768.0))
            .collect::<Result<Vec<_>, _>>()?;
        let started = Instant::now();
        let text = if let Some(ctx) = &whisper {
            transcribe::transcribe_local(ctx, &samples, None, Some(&case.language), |_| {}, |_| {})?
        } else {
            transcribe::transcribe_parakeet(
                parakeet.as_ref().unwrap(),
                &samples,
                Some(&case.language),
            )?
        };
        let inference_ms = started.elapsed().as_secs_f64() * 1000.0;
        let mut vad_results = Vec::new();
        if let Some(model) = args.get(4) {
            // A fresh VAD context per file avoids recurrent-state carryover.
            let mut context_params = WhisperVadContextParams::default();
            context_params.set_use_gpu(false);
            let mut vad = WhisperVadContext::new(model, context_params)?;
            let start = Instant::now();
            vad.detect_speech(&samples)?;
            let max_probability = vad.probabilities().iter().copied().fold(0.0_f32, f32::max);
            for (name, threshold, min_ms) in [("default", 0.5, 250), ("lenient", 0.2, 100)] {
                let mut params = WhisperVadParams::default();
                params.set_threshold(threshold);
                params.set_min_speech_duration(min_ms);
                let segments = vad.segments_from_probabilities(params)?;
                let pass = segments.num_segments() > 0;
                vad_results.push(json!({"policy": name, "threshold": threshold,
                    "min_speech_ms": min_ms, "speech_segments": segments.num_segments(),
                    "max_probability": max_probability, "would_pass": pass,
                    "would_drop_valid_speech": case.speech && !pass,
                    "would_prevent_false_text": !case.speech && !text.is_empty() && !pass,
                    "ms": start.elapsed().as_secs_f64() * 1000.0}));
            }
        }
        let value = json!({"name": case.name, "category": case.category,
            "expected_text": case.text, "expected_speech": case.speech,
            "language": case.language, "seconds": samples.len() as f64 / 16000.0,
            "text": text, "exact_normalized_match": (case.speech || text.is_empty())
                && normalized(&text) == normalized(&case.text),
            "speech_presence_correct": !text.is_empty() == case.speech,
            "inference_ms": inference_ms, "vad": vad_results});
        println!("GUARD {}", value);
        results.push(value);
    }
    fs::write(
        &args[3],
        serde_json::to_vec_pretty(&json!({
            "engine": args[0], "manifest": args[2], "vad_model": args.get(4), "results": results
        }))?,
    )?;
    Ok(())
}
