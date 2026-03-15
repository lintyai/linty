use enigo::{Enigo, Key, Keyboard, Settings};
use std::thread;
use std::time::Duration;

/// Simulate Cmd+V keystroke to paste from clipboard.
pub fn simulate_paste() -> Result<(), String> {
    eprintln!("[paste] Simulating Cmd+V...");
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| {
        eprintln!("[paste] Enigo init failed (accessibility?): {}", e);
        format!("Enigo init failed: {}", e)
    })?;

    // Small delay to ensure clipboard is ready
    thread::sleep(Duration::from_millis(50));

    enigo
        .key(Key::Meta, enigo::Direction::Press)
        .map_err(|e| format!("Key press failed: {}", e))?;
    enigo
        .key(Key::Unicode('v'), enigo::Direction::Click)
        .map_err(|e| format!("Key click failed: {}", e))?;
    enigo
        .key(Key::Meta, enigo::Direction::Release)
        .map_err(|e| format!("Key release failed: {}", e))?;

    eprintln!("[paste] Cmd+V simulated successfully");
    Ok(())
}

