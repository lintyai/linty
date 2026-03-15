use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use tauri::{AppHandle, Emitter};

use crate::state::AudioCommand;

/// Spawns a dedicated audio thread that owns the cpal::Stream.
/// Returns a Sender to control it. The thread blocks on recv(),
/// so it stays alive for the lifetime of the app.
pub fn spawn_audio_thread(
    app: AppHandle,
    buffer: Arc<Mutex<Vec<f32>>>,
    callback_count: Arc<AtomicU64>,
) -> mpsc::Sender<AudioCommand> {
    let (tx, rx) = mpsc::channel::<AudioCommand>();

    std::thread::spawn(move || {
        let mut active_stream: Option<cpal::Stream> = None;

        loop {
            match rx.recv() {
                Ok(AudioCommand::Start) => {
                    // Drop any existing stream
                    active_stream.take();

                    // Fresh host per recording — stale CoreAudio handles die after sleep
                    let host = cpal::default_host();

                    // Release previous buffer memory (not just clear — avoids
                    // retaining a large allocation from a prior long recording).
                    if let Ok(mut buf) = buffer.lock() {
                        *buf = Vec::new();
                    }

                    let device = match host.default_input_device() {
                        Some(d) => d,
                        None => {
                            eprintln!("No input device available");
                            continue;
                        }
                    };

                    // Use device's default config, then downsample to 16kHz mono
                    let default_config = match device.default_input_config() {
                        Ok(c) => c,
                        Err(e) => {
                            eprintln!("No default input config: {}", e);
                            continue;
                        }
                    };

                    let device_sample_rate = default_config.sample_rate().0;
                    let device_channels = default_config.channels();

                    let config = cpal::StreamConfig {
                        channels: device_channels,
                        sample_rate: cpal::SampleRate(device_sample_rate),
                        buffer_size: cpal::BufferSize::Default,
                    };

                    eprintln!(
                        "[audio] Using device config: {}Hz, {} ch (will resample to 16kHz mono)",
                        device_sample_rate, device_channels
                    );

                    let buf_clone = buffer.clone();
                    let app_clone = app.clone();
                    let cb_count = callback_count.clone();

                    // Pre-allocate reusable scratch buffers — avoids heap allocs
                    // per callback (~93/sec). Capacity grows once, reused forever.
                    let mut mono_buf: Vec<f32> = Vec::with_capacity(4096);
                    let mut resample_buf: Vec<f32> = Vec::with_capacity(4096);

                    let stream = match device.build_input_stream(
                        &config,
                        move |data: &[f32], _: &cpal::InputCallbackInfo| {
                            let tick = cb_count.fetch_add(1, Ordering::Relaxed);

                            // Downmix to mono, reusing scratch buffer
                            mono_buf.clear();
                            if device_channels > 1 {
                                mono_buf.extend(
                                    data.chunks(device_channels as usize)
                                        .map(|frame| {
                                            frame.iter().sum::<f32>() / device_channels as f32
                                        }),
                                );
                            } else {
                                mono_buf.extend_from_slice(data);
                            }

                            // Resample to 16kHz, reusing scratch buffer
                            let samples: &[f32] = if device_sample_rate != 16000 {
                                let ratio = device_sample_rate as f64 / 16000.0;
                                let output_len =
                                    (mono_buf.len() as f64 / ratio).ceil() as usize;
                                resample_buf.clear();
                                for i in 0..output_len {
                                    let src_idx = i as f64 * ratio;
                                    let idx = src_idx as usize;
                                    let frac = (src_idx - idx as f64) as f32;
                                    let s0 = mono_buf.get(idx).copied().unwrap_or(0.0);
                                    let s1 = mono_buf.get(idx + 1).copied().unwrap_or(s0);
                                    resample_buf.push(s0 + frac * (s1 - s0));
                                }
                                &resample_buf
                            } else {
                                &mono_buf
                            };

                            if let Ok(mut buf) = buf_clone.lock() {
                                buf.extend_from_slice(samples);
                            }

                            // Throttle amplitude events to ~15fps (every 6th callback
                            // at ~93/sec) — UI can't display faster than this.
                            if !samples.is_empty() && tick % 6 == 0 {
                                let rms: f32 = (samples
                                    .iter()
                                    .map(|s| s * s)
                                    .sum::<f32>()
                                    / samples.len() as f32)
                                    .sqrt();
                                let _ = app_clone.emit("audio-amplitude", rms);
                                let _ = app_clone.emit_to("capsule", "capsule-amplitude", rms);
                            }
                        },
                        |err| eprintln!("Audio stream error: {}", err),
                        None,
                    ) {
                        Ok(s) => s,
                        Err(e) => {
                            eprintln!("Failed to build stream: {}", e);
                            continue;
                        }
                    };

                    if let Err(e) = stream.play() {
                        eprintln!("Failed to play stream: {}", e);
                        continue;
                    }

                    active_stream = Some(stream);
                    let _ = app.emit("recording-started", ());
                }
                Ok(AudioCommand::Stop) => {
                    // Drop the stream to stop recording
                    active_stream.take();
                    let _ = app.emit("recording-stopped", ());
                }
                Err(_) => {
                    // Channel closed — exit thread
                    break;
                }
            }
        }
    });

    tx
}
