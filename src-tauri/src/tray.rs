use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIconBuilder, TrayIconId},
    Emitter, Listener, Manager,
};

const TRAY_ID: &str = "linty-tray";

fn status_label(status: &str) -> &str {
    match status {
        "recording" => "Recording...",
        "transcribing" => "Transcribing...",
        "correcting" => "Correcting...",
        "pasting" => "Pasting...",
        _ => "Ready",
    }
}

fn tooltip_text(status: &str, stt_mode: &str) -> String {
    let engine = if stt_mode == "local" {
        "Local (Whisper)"
    } else {
        "Cloud (Groq)"
    };
    match status {
        "recording" => format!("Linty — Recording... [{}]", engine),
        "transcribing" => format!("Linty — Transcribing... [{}]", engine),
        "correcting" => format!("Linty — Correcting... [{}]", engine),
        "pasting" => format!("Linty — Pasting... [{}]", engine),
        _ => format!("Linty — Hold fn to record [{}]", engine),
    }
}

fn build_tray_menu(
    app: &tauri::AppHandle,
    status: &str,
    stt_mode: &str,
) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let status_item = MenuItem::with_id(app, "status", status_label(status), false, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;

    let cloud_checked = stt_mode != "local";
    let local_checked = stt_mode == "local";
    let cloud_item =
        CheckMenuItem::with_id(app, "engine-cloud", "Cloud (Groq)", true, cloud_checked, None::<&str>)?;
    let local_item =
        CheckMenuItem::with_id(app, "engine-local", "Local (Whisper)", true, local_checked, None::<&str>)?;

    let sep2 = PredefinedMenuItem::separator(app)?;
    let show_item = MenuItem::with_id(app, "show", "Show Linty", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit Linty", true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &status_item,
            &sep1,
            &cloud_item,
            &local_item,
            &sep2,
            &show_item,
            &quit_item,
        ],
    )
}

pub fn init_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let menu = build_tray_menu(app.handle(), "idle", "cloud")?;

    TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("Linty — Hold fn to record")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    super::set_activation_policy_regular();
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.center();
                }
            }
            "quit" => {
                app.exit(0);
            }
            "engine-cloud" => {
                let _ = app.emit("tray-engine-changed", "cloud");
            }
            "engine-local" => {
                let _ = app.emit("tray-engine-changed", "local");
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click { .. } = event {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                        super::set_activation_policy_accessory();
                    } else {
                        super::set_activation_policy_regular();
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.center();
                    }
                }
            }
        })
        .build(app)?;

    // Listen for frontend state changes to update tray menu + tooltip
    let handle = app.handle().clone();
    app.listen("tray-state-changed", move |event| {
        let payload: serde_json::Value = match serde_json::from_str(event.payload()) {
            Ok(v) => v,
            Err(_) => return,
        };
        let status = payload
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("idle");
        let stt_mode = payload
            .get("sttMode")
            .and_then(|v| v.as_str())
            .unwrap_or("cloud");

        // Rebuild menu
        if let Ok(menu) = build_tray_menu(&handle, status, stt_mode) {
            if let Some(tray) = handle.tray_by_id(&TrayIconId::new(TRAY_ID)) {
                let _ = tray.set_menu(Some(menu));
                let _ = tray.set_tooltip(Some(&tooltip_text(status, stt_mode)));
            }
        }
    });

    Ok(())
}
