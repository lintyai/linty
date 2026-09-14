//! Side-by-side latency benchmark for Linty's local speech engines.
//!
//! Runs every WAV given on the command line through Whisper (whisper.cpp,
//! Metal) and Parakeet TDT v3 (FluidAudio, Neural Engine) using the exact
//! transcription code paths the app uses, and prints per-file timings.
//!
//! ```bash
//! cd src-tauri
//! cargo run --release --example stt_bench --features local-stt,parakeet -- \
//!     [--models-dir DIR] [--whisper FILE.bin] [--runs N] clip1.wav clip2.wav ...
//! ```
//!
//! Defaults: models dir = Linty's app data models dir, whisper file =
//! ggml-large-v3-turbo-q5_0.bin, 3 runs per file (first run reported separately
//! as the cold run). WAVs must be 16 kHz mono PCM; make one with
//! `say -o clip.aiff "text" && afconvert -f WAVE -d LEI16@16000 -c 1 clip.aiff clip.wav`.
//! The Parakeet bundle is downloaded into the models dir if missing.

use std::path::{Path, PathBuf};
use std::time::Instant;

use linty_lib::transcribe;

struct Args {
    models_dir: PathBuf,
    whisper_file: String,
    runs: usize,
    wavs: Vec<PathBuf>,
}

fn parse_args() -> Args {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut args = Args {
        models_dir: PathBuf::from(home)
            .join("Library/Application Support/ai.linty.desktop/models"),
        whisper_file: "ggml-large-v3-turbo-q5_0.bin".to_string(),
        runs: 3,
        wavs: Vec::new(),
    };
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--models-dir" => args.models_dir = PathBuf::from(it.next().expect("--models-dir DIR")),
            "--whisper" => args.whisper_file = it.next().expect("--whisper FILE"),
            "--runs" => args.runs = it.next().expect("--runs N").parse().expect("runs"),
            other => args.wavs.push(PathBuf::from(other)),
        }
    }
    if args.wavs.is_empty() {
        eprintln!("usage: stt_bench [--models-dir DIR] [--whisper FILE.bin] [--runs N] clip.wav ...");
        std::process::exit(2);
    }
    args
}

fn read_wav_16k_mono(path: &Path) -> Vec<f32> {
    let mut reader = hound::WavReader::open(path)
        .unwrap_or_else(|e| panic!("cannot open {}: {e}", path.display()));
    let spec = reader.spec();
    assert!(
        spec.sample_rate == 16000 && spec.channels == 1,
        "{} must be 16 kHz mono (got {} Hz, {} ch)",
        path.display(),
        spec.sample_rate,
        spec.channels
    );
    match spec.sample_format {
        hound::SampleFormat::Int => {
            let max = (1i64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .samples::<i32>()
                .map(|s| s.expect("sample") as f32 / max)
                .collect()
        }
        hound::SampleFormat::Float => reader.samples::<f32>().map(|s| s.expect("sample")).collect(),
    }
}

struct Timing {
    cold_ms: f64,
    warm_ms: Vec<f64>,
    text: String,
}

fn median(xs: &[f64]) -> f64 {
    if xs.is_empty() {
        return f64::NAN;
    }
    let mut v = xs.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[v.len() / 2]
}

fn bench<F: FnMut() -> Result<String, String>>(runs: usize, mut f: F) -> Timing {
    let t = Instant::now();
    let text = f().unwrap_or_else(|e| format!("<error: {e}>"));
    let cold_ms = t.elapsed().as_secs_f64() * 1000.0;
    let mut warm_ms = Vec::new();
    for _ in 1..runs {
        let t = Instant::now();
        let _ = f();
        warm_ms.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    Timing { cold_ms, warm_ms, text }
}

fn main() {
    let args = parse_args();
    let clips: Vec<(String, Vec<f32>)> = args
        .wavs
        .iter()
        .map(|p| (p.file_name().unwrap().to_string_lossy().into_owned(), read_wav_16k_mono(p)))
        .collect();

    // ── Whisper ──
    let whisper_path = args.models_dir.join(&args.whisper_file);
    let whisper_ctx = if whisper_path.exists() {
        let t = Instant::now();
        let mut params = whisper_rs::WhisperContextParameters::default();
        params.use_gpu(true);
        let ctx = whisper_rs::WhisperContext::new_with_params(
            whisper_path.to_str().unwrap(),
            params,
        )
        .expect("load whisper");
        println!(
            "whisper  : loaded {} in {:.0} ms",
            args.whisper_file,
            t.elapsed().as_secs_f64() * 1000.0
        );
        Some(ctx)
    } else {
        println!("whisper  : {} not found, skipping", whisper_path.display());
        None
    };

    // ── Parakeet ──
    let parakeet_dir = args.models_dir.join(transcribe::PARAKEET_V3_ID);
    if !linty_lib::parakeet::models_exist(&parakeet_dir) {
        println!("parakeet : downloading bundle into {} ...", parakeet_dir.display());
        let t = Instant::now();
        linty_lib::parakeet::download(&parakeet_dir, |f| {
            eprint!("\r  download+compile {:>3.0}%", f * 100.0);
        })
        .expect("download parakeet");
        eprintln!();
        println!("parakeet : download took {:.1} s", t.elapsed().as_secs_f64());
    }
    let t = Instant::now();
    let parakeet = linty_lib::parakeet::ParakeetEngine::load(&parakeet_dir).expect("load parakeet");
    println!(
        "parakeet : loaded in {:.0} ms (includes Neural Engine compile on first load)",
        t.elapsed().as_secs_f64() * 1000.0
    );

    println!();
    println!(
        "{:<28} {:>7} {:<9} {:>9} {:>9}  text",
        "clip", "audio", "engine", "cold ms", "warm ms"
    );
    for (name, samples) in &clips {
        let audio_s = samples.len() as f64 / 16000.0;
        if let Some(ctx) = &whisper_ctx {
            let timing = bench(args.runs, || {
                transcribe::transcribe_local(ctx, samples, None, Some("en"), false, |_| {}, |_| {})
            });
            println!(
                "{:<28} {:>6.1}s {:<9} {:>9.0} {:>9.0}  {}",
                name,
                audio_s,
                "whisper",
                timing.cold_ms,
                median(&timing.warm_ms),
                timing.text
            );
        }
        let timing = bench(args.runs, || {
            transcribe::transcribe_parakeet(&parakeet, samples, Some("en"))
        });
        println!(
            "{:<28} {:>6.1}s {:<9} {:>9.0} {:>9.0}  {}",
            name,
            audio_s,
            "parakeet",
            timing.cold_ms,
            median(&timing.warm_ms),
            timing.text
        );
    }
}
