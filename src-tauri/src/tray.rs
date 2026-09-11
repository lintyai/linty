use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState},
    Emitter, Listener, Manager,
};

/// The config-created tray icon always has id "main" in Tauri v2.
const TRAY_ID: &str = "main";
const RECENT_TRANSCRIPT_LIMIT: usize = 10;
const TRANSCRIPT_PREVIEW_LENGTH: usize = 60;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrayTranscript {
    transcript_id: String,
    final_text: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrayState {
    status: String,
    stt_mode: String,
    #[serde(default)]
    recent_transcripts: Vec<TrayTranscript>,
}

fn transcript_preview(text: &str) -> String {
    let single_line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = single_line.chars();
    let mut preview: String = chars.by_ref().take(TRANSCRIPT_PREVIEW_LENGTH).collect();
    if chars.next().is_some() {
        preview.push('…');
    }
    // Native menus treat ampersands as mnemonic markers; preserve literal text.
    preview.replace('&', "&&")
}

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
    recent_transcripts: &[TrayTranscript],
) -> Result<Menu<tauri::Wry>, tauri::Error> {
    let latest_item = match recent_transcripts.first() {
        Some(transcript) => MenuItem::with_id(
            app,
            format!("copy-latest-{}", transcript.transcript_id),
            transcript_preview(&transcript.final_text),
            true,
            None::<&str>,
        )?,
        None => MenuItem::with_id(
            app,
            "copy-latest-empty",
            "No transcriptions yet",
            false,
            None::<&str>,
        )?,
    };
    let recent_menu = Submenu::new(app, "Recent", !recent_transcripts.is_empty())?;
    for (index, transcript) in recent_transcripts
        .iter()
        .take(RECENT_TRANSCRIPT_LIMIT)
        .enumerate()
    {
        let item = MenuItem::with_id(
            app,
            format!("copy-recent-{}", transcript.transcript_id),
            format!(
                "{}. {}",
                index + 1,
                transcript_preview(&transcript.final_text)
            ),
            true,
            None::<&str>,
        )?;
        recent_menu.append(&item)?;
    }
    let history_sep = PredefinedMenuItem::separator(app)?;
    let status_item = MenuItem::with_id(app, "status", status_label(status), false, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;

    let cloud_checked = stt_mode != "local";
    let local_checked = stt_mode == "local";
    let cloud_item = CheckMenuItem::with_id(
        app,
        "engine-cloud",
        "Cloud (Groq)",
        true,
        cloud_checked,
        None::<&str>,
    )?;
    let local_item = CheckMenuItem::with_id(
        app,
        "engine-local",
        "Local (Whisper)",
        true,
        local_checked,
        None::<&str>,
    )?;

    let sep2 = PredefinedMenuItem::separator(app)?;
    let show_item = MenuItem::with_id(app, "show", "Show Linty", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit Linty", true, None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &latest_item,
            &recent_menu,
            &history_sep,
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
    // Attach to the tray icon already created by tauri.conf.json (id = "main").
    // Do NOT create a second tray with TrayIconBuilder — that produces a ghost icon
    // where handlers are attached to an invisible duplicate instead of the real one.
    let tray = app
        .tray_by_id(TRAY_ID)
        .expect("tray icon must exist from tauri.conf.json trayIcon config");

    let menu = build_tray_menu(app.handle(), "idle", "cloud", &[])?;
    tray.set_menu(Some(menu))?;
    tray.set_show_menu_on_left_click(false)?; // left-click toggles window, right-click opens menu

    tray.on_menu_event(|app, event| match event.id.as_ref() {
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
        id => {
            if let Some(transcript_id) = id
                .strip_prefix("copy-latest-")
                .or_else(|| id.strip_prefix("copy-recent-"))
            {
                let _ = app.emit_to("main", "tray-copy-transcript", transcript_id);
            }
        }
    });

    tray.on_tray_icon_event(|tray, event| {
        if let tauri::tray::TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } = event
        {
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
    });

    // Listen for frontend state changes to update tray menu + tooltip
    let handle = app.handle().clone();
    app.listen("tray-state-changed", move |event| {
        let state: TrayState = match serde_json::from_str(event.payload()) {
            Ok(v) => v,
            Err(_) => return,
        };

        // Rebuild menu
        if let Ok(menu) = build_tray_menu(
            &handle,
            &state.status,
            &state.stt_mode,
            &state.recent_transcripts,
        ) {
            if let Some(tray) = handle.tray_by_id(TRAY_ID) {
                let _ = tray.set_menu(Some(menu));
                let _ = tray.set_tooltip(Some(&tooltip_text(&state.status, &state.stt_mode)));
            }
        }
    });

    Ok(())
}
