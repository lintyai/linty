//! Cmd+V simulation via raw CoreGraphics FFI.
//!
//! Resolves the virtual keycode that types "v" on the keyboard layout macOS uses
//! for Cmd shortcuts (so QWERTY, Dvorak, Colemak and non-Latin layouts all work),
//! then posts four keyboard events (Cmd down, V down, V up, Cmd up) with the
//! Command modifier flag set explicitly on every event. Same raw-FFI approach as
//! `fnkey.rs` and `clipboard.rs`.
//!
//! Threading: the Text Input Sources lookup must run on the main thread (macOS 26
//! asserts main-queue access — issue #26), so it hops there via
//! `run_on_main_thread` and hands the keycode back over a channel. CGEvent
//! creation and posting are thread-safe and stay on the calling worker thread,
//! keeping the pre-paste and inter-key delays off the main thread.
//!
//! Why not enigo (removed): enigo 0.2 created the "v" keystroke without setting
//! flags and relied on the event source's session state to have already
//! registered the asynchronously posted Cmd-down. Under load that state lagged,
//! the "v" event went out without Command, and the target app typed a literal
//! "v" instead of pasting.

use tauri::AppHandle;

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::c_void;
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;
    use tauri::AppHandle;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceCreate(state_id: i32) -> *mut c_void;
        fn CGEventCreateKeyboardEvent(
            source: *mut c_void,
            virtual_key: u16,
            key_down: bool,
        ) -> *mut c_void;
        fn CGEventGetFlags(event: *mut c_void) -> u64;
        fn CGEventSetFlags(event: *mut c_void, flags: u64);
        fn CGEventPost(tap: u32, event: *mut c_void);
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const c_void);
        fn CFDataGetBytePtr(data: *const c_void) -> *const u8;
    }

    #[link(name = "Carbon", kind = "framework")]
    extern "C" {
        static kTISPropertyUnicodeKeyLayoutData: *const c_void;
        fn TISCopyCurrentASCIICapableKeyboardLayoutInputSource() -> *const c_void;
        fn TISGetInputSourceProperty(source: *const c_void, key: *const c_void) -> *const c_void;
        fn LMGetKbdType() -> u8;
        fn UCKeyTranslate(
            layout: *const c_void,
            virtual_key: u16,
            key_action: u16,
            modifier_state: u32,
            keyboard_type: u32,
            options: u32,
            dead_key_state: *mut u32,
            max_len: usize,
            actual_len: *mut usize,
            unicode_string: *mut u16,
        ) -> i32;
    }

    /// kCGEventSourceStateHIDSystemState — synthetic events that behave like hardware input.
    const EVENT_SOURCE_STATE_HID_SYSTEM: i32 = 1;
    /// kCGHIDEventTap — insert at the HID level so every app sees the events.
    const HID_EVENT_TAP: u32 = 0;
    /// kCGEventFlagMaskNonCoalesced — present on real keyboard events.
    const FLAG_NON_COALESCED: u64 = 0x0000_0100;
    /// kCGEventFlagMaskCommand plus NX_DEVICELCMDKEYMASK, as a real left-Cmd press carries.
    const FLAG_COMMAND: u64 = 0x0010_0000 | 0x0000_0008;
    /// Every modifier bit: device-independent masks (0x00FF_0000) and device-specific
    /// left/right masks (0x0000_00FF). Cleared before applying ours so a modifier the
    /// user happens to be holding cannot turn the chord into e.g. Cmd+Shift+V.
    const ALL_MODIFIER_BITS: u64 = 0x00FF_00FF;
    /// kVK_Command
    const VK_COMMAND: u16 = 0x37;
    /// kVK_ANSI_V — the QWERTY position, used only when the layout lookup fails.
    const VK_ANSI_V: u16 = 0x09;
    /// kUCKeyActionDown
    const UC_KEY_ACTION_DOWN: u16 = 0;
    /// kUCKeyTranslateNoDeadKeysMask
    const UC_KEY_TRANSLATE_NO_DEAD_KEYS: u32 = 1;

    /// Settle time after the pasteboard write before the keystroke lands.
    const PRE_PASTE_DELAY: Duration = Duration::from_millis(20);
    /// Spacing between the four key events, roughly a hardware cadence.
    const INTER_KEY_DELAY: Duration = Duration::from_millis(10);

    pub fn simulate_paste(app: &AppHandle) -> Result<(), String> {
        eprintln!("[paste] Simulating Cmd+V via CGEvent...");

        // CGEventPost silently drops keyboard events from untrusted processes,
        // so surface that as an error the frontend can turn into a toast.
        if !crate::fnkey::is_accessibility_granted() {
            eprintln!("[paste] Accessibility not granted — cannot post key events");
            return Err("Accessibility permission not granted".into());
        }

        // Settle after the pasteboard write — on the worker thread, not main.
        thread::sleep(PRE_PASTE_DELAY);

        // The layout lookup is main-thread-only; hand the keycode back over a channel.
        let (tx, rx) = mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(resolve_v_keycode());
        })
        .map_err(|e| format!("Main thread dispatch failed: {}", e))?;
        let v_keycode = rx
            .recv()
            .map_err(|e| format!("Keycode channel closed: {}", e))?;
        if v_keycode != VK_ANSI_V {
            eprintln!(
                "[paste] active layout types 'v' at keycode 0x{:02X}",
                v_keycode
            );
        }

        // (virtual keycode, key down?, flags) in posting order.
        let chord = [
            (VK_COMMAND, true, FLAG_NON_COALESCED | FLAG_COMMAND),
            (v_keycode, true, FLAG_NON_COALESCED | FLAG_COMMAND),
            (v_keycode, false, FLAG_NON_COALESCED | FLAG_COMMAND),
            (VK_COMMAND, false, FLAG_NON_COALESCED),
        ];
        unsafe { post_chord(&chord)? };

        eprintln!("[paste] Cmd+V posted successfully");
        Ok(())
    }

    /// Find the virtual keycode that types "v" on the layout macOS consults for Cmd
    /// shortcuts. `TISCopyCurrentASCIICapableKeyboardLayoutInputSource` returns the
    /// active layout when it is ASCII-capable (QWERTY, Dvorak, Colemak, ...) and the
    /// ASCII fallback layout otherwise (Russian, Hindi, ...), matching AppKit's own
    /// key-equivalent resolution. Falls back to `kVK_ANSI_V` if the lookup fails.
    ///
    /// Must run on the main thread: TIS asserts main-queue access on macOS 26.
    fn resolve_v_keycode() -> u16 {
        unsafe {
            let source = TISCopyCurrentASCIICapableKeyboardLayoutInputSource();
            if source.is_null() {
                eprintln!("[paste] no ASCII-capable layout found, using kVK_ANSI_V");
                return VK_ANSI_V;
            }

            let layout_data = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData);
            let keycode = if layout_data.is_null() {
                eprintln!("[paste] layout has no key layout data, using kVK_ANSI_V");
                VK_ANSI_V
            } else {
                let layout = CFDataGetBytePtr(layout_data) as *const c_void;
                let kbd_type = u32::from(LMGetKbdType());
                let mut found = None;
                for candidate in 0u16..128 {
                    let mut dead_key_state: u32 = 0;
                    let mut chars = [0u16; 4];
                    let mut len: usize = 0;
                    let status = UCKeyTranslate(
                        layout,
                        candidate,
                        UC_KEY_ACTION_DOWN,
                        0,
                        kbd_type,
                        UC_KEY_TRANSLATE_NO_DEAD_KEYS,
                        &mut dead_key_state,
                        chars.len(),
                        &mut len,
                        chars.as_mut_ptr(),
                    );
                    if status == 0 && len == 1 && chars[0] == u16::from(b'v') {
                        found = Some(candidate);
                        break;
                    }
                }
                found.unwrap_or_else(|| {
                    eprintln!("[paste] no key types 'v' on this layout, using kVK_ANSI_V");
                    VK_ANSI_V
                })
            };

            CFRelease(source);
            keycode
        }
    }

    /// Create all four events up front (so a failure never leaves Cmd held down),
    /// stamp explicit modifier flags on each, then post them in order.
    unsafe fn post_chord(chord: &[(u16, bool, u64); 4]) -> Result<(), String> {
        // A null source is permitted by CGEventCreateKeyboardEvent; log and continue.
        let source = CGEventSourceCreate(EVENT_SOURCE_STATE_HID_SYSTEM);
        if source.is_null() {
            eprintln!("[paste] CGEventSourceCreate returned NULL, using default source");
        }

        let mut events: [*mut c_void; 4] = [std::ptr::null_mut(); 4];
        for (i, (keycode, key_down, flags)) in chord.iter().enumerate() {
            let event = CGEventCreateKeyboardEvent(source, *keycode, *key_down);
            if event.is_null() {
                for created in events.iter().take(i) {
                    CFRelease(*created);
                }
                if !source.is_null() {
                    CFRelease(source);
                }
                return Err(format!(
                    "CGEventCreateKeyboardEvent failed (keycode=0x{:02X}, down={})",
                    keycode, key_down
                ));
            }
            // Keep whatever non-modifier bits macOS stamped on the event, but own
            // the modifier state outright — this is the bit enigo 0.2 left to chance.
            let base = CGEventGetFlags(event) & !ALL_MODIFIER_BITS;
            CGEventSetFlags(event, base | *flags);
            events[i] = event;
        }

        for (i, event) in events.iter().enumerate() {
            if i > 0 {
                thread::sleep(INTER_KEY_DELAY);
            }
            CGEventPost(HID_EVENT_TAP, *event);
        }

        for event in events {
            CFRelease(event);
        }
        if !source.is_null() {
            CFRelease(source);
        }
        Ok(())
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use tauri::AppHandle;

    pub fn simulate_paste(_app: &AppHandle) -> Result<(), String> {
        Err("Paste simulation is only supported on macOS".into())
    }
}

/// Simulate a Cmd+V keystroke to paste from the clipboard into the focused app.
pub fn simulate_paste(app: &AppHandle) -> Result<(), String> {
    imp::simulate_paste(app)
}
