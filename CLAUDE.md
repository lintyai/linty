## Project Overview

Linty is a macOS voice-to-text desktop app built with Tauri v2 + React 19 + Rust. Hold the fn key to record, release to transcribe (local Whisper or Groq cloud), and auto-paste the result.

## Commands

```bash
yarn dev              # Start Vite dev server (HMR on port 1420) — don't restart, changes auto-reload
yarn build            # TypeScript check + Vite production build
yarn tauri dev        # Run Tauri app in dev mode (frontend + Rust backend)
yarn build:mac        # Full release build: sign + notarize .app + .dmg (requires source ~/.tokens first)

# Rust only
cd src-tauri
cargo check --features local-stt            # Type check Rust code (Whisper only, no Swift needed)
cargo check --features local-stt,parakeet   # + Parakeet bridge (compiles swift/ via SwiftPM, slow first time)
cargo build --features local-stt,parakeet   # Build Rust backend as shipped

# Engine benchmark (uses the app's real transcription code paths)
cargo run --release --example stt_bench --features local-stt,parakeet -- clip.wav
```

Release builds (`build:mac`, CI) use `--features local-stt,parakeet`.

Tauri CLI bundle syntax: `--bundles dmg,app` (comma-separated, NOT space-separated).

## Architecture

### Core Flow
1. Fn key press → `fnkey.rs` emits `fnkey-pressed` event → frontend starts recording
2. Audio thread (cpal) captures to shared `Arc<Mutex<Vec<f32>>>` buffer
3. Fn key release → `stop_recording` moves samples via `std::mem::take` (zero-copy, no IPC)
4. `transcribe_buffer` reads samples directly from Rust state → returns text
5. Clipboard snapshot → write text → simulate Cmd+V paste → auto-restore clipboard

### Key Design Decisions
- **Zero-copy audio**: Samples never cross IPC — stay in Rust, transcribed in-place
- **macOS FFI over plugins**: Permissions, fn key, clipboard use raw ObjC FFI for reliability
- **Two windows**: Main app + capsule overlay (NSPanel, always-on-top, separate Z-order)
- **Feature-gated STT**: `local-stt` Cargo feature enables whisper-rs with Metal GPU; `parakeet` (implies `local-stt`) adds NVIDIA Parakeet TDT v3 on the Neural Engine through a Swift bridge (`src-tauri/swift/`, built by `build.rs`, wraps FluidAudio 0.14.8). Only one local engine is resident at a time; `transcribe_buffer` dispatches on the selected model id (`parakeet-tdt-0.6b-v3` = Parakeet bundle dir, anything else = whisper .bin). Parakeet needs macOS 14+ and Apple Silicon, has no vocabulary prompt or translation, and its bundle is a directory FluidAudio downloads into the models dir.
- **Activation policy**: Programmatic `set_activation_policy_accessory/regular()` for tray behavior (NOT `LSUIElement` in Info.plist)

### State Management
- **Frontend**: Zustand store split into slices (recording, transcription, settings, navigation, history, toast)
- **Backend**: `AppState` struct managed by Tauri — `Arc<Mutex<>>` for audio buffer, whisper context, recording state
- **Persistence**: `tauri-plugin-store` saves settings + history to JSON files in app data dir

## macOS Entitlements & TCC

Linty uses **Hardened Runtime** (not App Sandbox). Critical distinction:

| Permission | Hardened Runtime (correct) | App Sandbox (wrong) |
|---|---|---|
| Microphone | `com.apple.security.device.audio-input` | `com.apple.security.device.microphone` |

**Wrong entitlement key = macOS TCC silently denies without ever showing a prompt.**

- Do NOT set `LSUIElement=true` in Info.plist — prevents TCC prompts on macOS Sequoia
- Terminal launch (`./Linty.app/Contents/MacOS/linty`) bypasses entitlement checks — always test TCC from Finder/DMG install
- `tccutil reset Microphone ai.linty.desktop` clears stale TCC entries after entitlement changes
- Once denied, `requestAccessForMediaType:` returns false without prompting — guide user to System Settings

## Build & Notarization

- Tauri auto-notarizes `.app` when `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` env vars are set
- `.dmg` must be notarized separately (`xcrun notarytool submit` + `xcrun stapler staple`)
- Both handled by `scripts/build-mac.sh` and CI workflow (`.github/workflows/build-dmg.yml`)
- CI auto-bumps patch version, builds, notarizes, creates GitHub Release
