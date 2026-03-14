use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_nspanel::cocoa::appkit::{NSMainMenuWindowLevel, NSWindowCollectionBehavior};
use tauri_nspanel::cocoa::base::nil;
use tauri_nspanel::cocoa::foundation::NSRect;
use tauri_nspanel::cocoa::base::YES;
use tauri_nspanel::objc::{msg_send, sel, sel_impl};
use tauri_nspanel::{ManagerExt, WebviewWindowExt};

// Panel level above menu bar (Status level = 25)
const PANEL_LEVEL: i32 = NSMainMenuWindowLevel + 2;

// NSWindowStyleMask values as i32
const NS_BORDERLESS_WINDOW_MASK: i32 = 0;
const NS_NONACTIVATING_PANEL_MASK: i32 = 1 << 7;

// ── Capsule state payload ──

#[derive(Clone, Serialize)]
pub struct CapsuleState {
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ── Init ──

pub fn init_capsule_panel(app: &AppHandle) {
    let Some(capsule_window) = app.get_webview_window("capsule") else {
        eprintln!("[capsule] No 'capsule' window found — skipping panel init");
        return;
    };

    let panel = capsule_window
        .to_panel()
        .expect("Failed to convert capsule to NSPanel");

    apply_panel_properties(&panel);
    eprintln!("[capsule] NSPanel initialized");
}

/// Re-apply all native NSPanel properties. Called on init and after system wake
/// to ensure the panel remains visible above all windows.
pub fn reinit_capsule_properties(app: &AppHandle) {
    let Ok(panel) = app.get_webview_panel("capsule") else {
        eprintln!("[capsule] reinit_properties: panel not found — cannot refresh");
        return;
    };
    apply_panel_properties(&panel);
    eprintln!("[capsule] NSPanel properties re-applied after wake");
}

fn apply_panel_properties(panel: &tauri_nspanel::raw_nspanel::RawNSPanel) {
    // No delegate — avoids null-pointer crash when windowDidBecomeKey: fires
    // with an unset listener. We don't need delegate callbacks.
    panel.set_level(PANEL_LEVEL);
    panel.set_style_mask(NS_BORDERLESS_WINDOW_MASK | NS_NONACTIVATING_PANEL_MASK);
    panel.set_collection_behaviour(
        NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorStationary
            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorIgnoresCycle,
    );
    panel.set_floating_panel(true);
    panel.set_hides_on_deactivate(false);
    panel.set_becomes_key_only_if_needed(true);
    panel.set_opaque(false);
    panel.set_has_shadow(false);
}

// ── Show/Hide ──

#[tauri::command]
#[allow(unexpected_cfgs)]
pub fn show_capsule(app: AppHandle) {
    let Ok(panel) = app.get_webview_panel("capsule") else {
        eprintln!("[capsule] show_capsule: panel not found");
        return;
    };

    // Re-apply critical properties every show — macOS may reset them after
    // sleep/wake, display reconfiguration, or space changes.
    panel.set_level(PANEL_LEVEL);
    panel.set_floating_panel(true);
    panel.set_hides_on_deactivate(false);

    // Wake the capsule webview's JS context — macOS may suspend WKWebView
    // for hidden windows. Evaluating JS forces the content process to resume
    // before we send state events.
    if let Some(capsule_window) = app.get_webview_window("capsule") {
        let _ = capsule_window.eval("/* wake */");
    }

    // Position bottom-center of main screen
    unsafe {
        let main_screen = tauri_nspanel::cocoa::appkit::NSScreen::mainScreen(nil);
        let visible_frame: NSRect = msg_send![main_screen, visibleFrame];

        let panel_width: f64 = 380.0;
        let panel_height: f64 = 52.0;
        let x = visible_frame.origin.x + (visible_frame.size.width - panel_width) / 2.0;
        let y = visible_frame.origin.y + 32.0;

        panel.set_content_size(panel_width, panel_height);
        let frame = NSRect {
            origin: tauri_nspanel::cocoa::foundation::NSPoint { x, y },
            size: tauri_nspanel::cocoa::foundation::NSSize {
                width: panel_width,
                height: panel_height,
            },
        };
        let _: () = msg_send![&*panel, setFrame: frame display: YES];
    }

    // order_front_regardless avoids making the panel key (no focus steal)
    panel.order_front_regardless();
}

#[tauri::command]
pub fn hide_capsule(app: AppHandle) {
    let Ok(panel) = app.get_webview_panel("capsule") else {
        return;
    };
    panel.order_out(None);
}

// ── Emit state ──

#[tauri::command]
pub fn emit_capsule_state(
    app: AppHandle,
    state: String,
    text: Option<String>,
    error: Option<String>,
) {
    let payload = CapsuleState { state, text, error };
    let _ = app.emit_to("capsule", "capsule-state", &payload);
}

// ── Sound effects ──

#[tauri::command]
pub fn play_capsule_sound(sound: String) {
    let (path, volume) = match sound.as_str() {
        "start" => ("/System/Library/Sounds/Tink.aiff", "0.15"),
        "processing" => ("/System/Library/Sounds/Pop.aiff", "0.12"),
        "success" => ("/System/Library/Sounds/Tink.aiff", "0.2"),
        "error" => ("/System/Library/Sounds/Basso.aiff", "0.2"),
        _ => return,
    };

    std::thread::spawn(move || {
        let _ = std::process::Command::new("afplay")
            .args(["-v", volume, path])
            .output();
    });
}
