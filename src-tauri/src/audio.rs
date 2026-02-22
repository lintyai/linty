use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{mpsc, Arc, Mutex};
use tauri::{AppHandle, Emitter};

use crate::state::AudioCommand;

/// Spawns a dedicated audio thread that owns the cpal::Stream.
/// Returns a Sender to control it. The thread blocks on recv(),
/// so it stays alive for the lifetime of the app.
pub fn spawn_audio_thread(
    app: AppHandle,
    buffer: Arc<Mutex<Vec<f32>>>,
) -> mpsc::Sender<AudioCommand> {
    let (tx, rx) = mpsc::channel::<AudioCommand>();

    std::thread::spawn(move || {
        let host = cpal::default_host();
        let mut active_stream: Option<cpal::Stream> = None;

        loop {
            match rx.recv() {
                Ok(AudioCommand::Start) => {
                    // Drop any existing stream
                    active_stream.take();

                    // Clear buffer
                    if let Ok(mut buf) = buffer.lock() {
                        buf.clear();
                    }

                    let device = match host.default_input_device() {
                        Some(d) => d,
                        None => {
                            eprintln!("No input device available");
                            continue;
                        }
                    };

                    let config = cpal::StreamConfig {
                        channels: 1,
                        sample_rate: cpal::SampleRate(16000),
                        buffer_size: cpal::BufferSize::Default,
                    };

                    let buf_clone = buffer.clone();
                    let app_clone = app.clone();

                    let stream = match device.build_input_stream(
                        &config,
                        move |data: &[f32], _: &cpal::InputCallbackInfo| {
                            if let Ok(mut buf) = buf_clone.lock() {
                                buf.extend_from_slice(data);
                            }
                            if !data.is_empty() {
                                let rms: f32 = (data.iter().map(|s| s * s).sum::<f32>()
                                    / data.len() as f32)
                                    .sqrt();
                                let _ = app_clone.emit("audio-amplitude", rms);
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
