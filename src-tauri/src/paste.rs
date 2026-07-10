use enigo::{Enigo, Key, Keyboard, Settings};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use tauri::AppHandle;

/// Simulate Cmd+V keystroke to paste from clipboard.
///
/// The pre-paste delay runs on the calling (worker) thread, but the key
/// events hop to the main thread: enigo's `Key::Unicode` resolves the
/// keycode via the Text Input Sources API, which macOS 26 asserts is
/// called on the main queue (SIGTRAP otherwise — issue #26).
pub fn simulate_paste(app: &AppHandle) -> Result<(), String> {
    eprintln!("[paste] Simulating Cmd+V...");

    // Small delay to ensure clipboard is ready
    thread::sleep(Duration::from_millis(50));

    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(send_cmd_v());
    })
    .map_err(|e| format!("Main thread dispatch failed: {}", e))?;

    rx.recv()
        .map_err(|e| format!("Paste result channel closed: {}", e))??;

    eprintln!("[paste] Cmd+V simulated successfully");
    Ok(())
}

fn send_cmd_v() -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| {
        eprintln!("[paste] Enigo init failed (accessibility?): {}", e);
        format!("Enigo init failed: {}", e)
    })?;

    enigo
        .key(Key::Meta, enigo::Direction::Press)
        .map_err(|e| format!("Key press failed: {}", e))?;
    enigo
        .key(Key::Unicode('v'), enigo::Direction::Click)
        .map_err(|e| format!("Key click failed: {}", e))?;
    enigo
        .key(Key::Meta, enigo::Direction::Release)
        .map_err(|e| format!("Key release failed: {}", e))
}
