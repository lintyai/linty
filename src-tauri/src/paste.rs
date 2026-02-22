use enigo::{Enigo, Key, Keyboard, Settings};
use std::thread;
use std::time::Duration;

/// Simulate Cmd+V keystroke to paste from clipboard.
pub fn simulate_paste() -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("Enigo init failed: {}", e))?;

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

    Ok(())
}

/// Check if accessibility permission is granted (macOS).
/// Uses a simple enigo operation to test — if it fails, permission is likely not granted.
pub fn check_accessibility_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        // On macOS, try to create an Enigo instance — it requires accessibility
        Enigo::new(&Settings::default()).is_ok()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}
