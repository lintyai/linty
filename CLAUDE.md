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

`node scripts/policy/publish.mjs --show` prints the live update policy (see `docs/runbooks/update-policy.md`).

`scripts/check-rust-logging.sh` fails on `println!`/`eprintln!`/`dbg!` in `src-tauri/src` (runs on every PR via `.github/workflows/checks.yml`).

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
- **Feature-gated STT**: `local-stt` Cargo feature enables whisper-rs with Metal GPU; `parakeet` (implies `local-stt`) adds NVIDIA Parakeet TDT v3 on the Neural Engine through a Swift bridge (`src-tauri/swift/`, built by `build.rs`, wraps FluidAudio 0.14.8). Only one local engine is resident at a time; `transcribe_buffer` dispatches on the selected model id (`parakeet-tdt-0.6b-v3` = Parakeet bundle dir, anything else = whisper .bin). Parakeet needs macOS 14+ and Apple Silicon, has no vocabulary prompt, and its bundle is a directory FluidAudio downloads into the models dir. The Settings language list (`src/lib/languages.util.ts`) is the intersection both engines support (Parakeet's 25 European languages); there is no translate-to-English option. It is the recommended default: the catalog lists it first and onboarding auto-downloads the first catalog entry (falls back to whisper Turbo Q5 where Parakeet is unsupported).
- **Activation policy**: Programmatic `set_activation_policy_accessory/regular()` for tray behavior (NOT `LSUIElement` in Info.plist)

### Corrections & personal dictionary
- Editing a transcript in History diffs the pasted text against the edit (`src/lib/correction-diff.util.ts`), stores a `CorrectionRecord` (`linty-corrections.json`) and feeds word swaps into suggestions (`src/lib/dictionary.util.ts`, `linty-dictionary.json`). Suggestions become dictionary entries when accepted on the Dictionary page, or automatically when "Learn new words automatically" is on (off by default).
- Dictionary entries are applied in `useTranscription.hook.ts` before paste (whole-word, case-matching; counted as `timesApplied`, shown as "Corrected"; engine-side fixes returned in `Transcription.vocabulary_applied` count as `timesRecognized`, shown as "Recognised") and the most-used entries seed the Whisper/Groq vocabulary prompt. Parakeet has no prompt: the same entries go to `transcribe_buffer` as `vocabulary` terms and FluidAudio's CTC keyword spotter rescores the transcript (`linty_parakeet_transcribe_vocab`); `src-tauri/src/vocabulary.rs` applies only candidates that resemble the term or one of its known wrong spellings (similarity ≥ 0.6), because the rescorer over-applies. The CTC bundle (`parakeet-ctc-110m-coreml`, ~100 MB) is fetched by `prepare_parakeet_vocabulary` (called by `useParakeetVocabulary.hook.ts` once the dictionary has words) and loaded with the engine on later loads. "Apply my dictionary" (Settings → Privacy & storage) turns all of this off. `reset_all_data` deletes both JSON stores.
- Rewrites (more than 40 % of words changed) are recorded for the corrections-per-100-words metric but never learned from.
- "Learn from corrections in other apps" (off by default) makes `paste_text` start a 60 s Accessibility watch (`src-tauri/src/corrections.rs`, raw AX FFI) on the focused field: it locates the pasted words, diffs only that span, and emits `correction-observed`; `useCorrectionObserver.hook.ts` records it with `source: "observed"`. A newer paste ends the previous watch; fields that empty on submit keep what was seen before; unreadable fields (some editors) simply learn nothing.

### Logging (local only)
- The backend logs through the `log` crate. `src-tauri/src/logging.rs` registers `tauri-plugin-log` and writes `~/Library/Logs/ai.linty.desktop/linty.log` (rotated at 5 MB, five files kept) plus stderr. Debug level in dev builds, info in release. Nothing is uploaded.
- **Redaction rule:** never log transcript text, clipboard contents, API keys or dictionary words. Log counts, lengths (`chars().count()`), durations, engine and model names. Check error strings too: serde_json errors, for example, quote the value they failed on. The log formatter replaces the home folder with `~` in every line.
- Messages keep a `[subsystem]` prefix (`[stt]`, `[paste]`, `[fnkey]`, ...). Per-dictation summaries are `info`; per-event detail is `debug`.
- A panic hook logs the message and backtrace, then writes `crash.marker` (time, version, thread, location) to the app data dir. The next launch logs a warning while the marker exists; `reset_all_data` deletes it. Native crashes still go to `~/Library/Logs/DiagnosticReports`.
- Startup removes the legacy `~/linty-fnkey.log` that older builds wrote.

### Update policy (remote update control)
- `src-tauri/src/policy.rs` gates every updater check. The updater plugin is built with `default_version_comparator`, which asks `PolicyStore::allows_release`. `useUpdater.hook.ts` calls the `check_policy` command (fetch, verify, decide) before each `check()`; a manual check skips the staged-rollout bucket for two minutes.
- The policy host serves `{"payload": "<policy JSON text>", "signature": "<tauri signer sign output>"}` at `https://updates.linty.ai/v1/policy/<channel>/<platform>/<version>`; 204 means no policy. The request carries nothing else. Debug builds honour `LINTY_POLICY_URL`.
- Policy fields: `seq`, `issued`/`expires` (RFC 3339), `channel`, `target.version` + `target.signatures` (per platform, copied from that release's `latest.json`), `action` (`prompt` | `force` | `rollback` | `pause`), optional `min_supported_version`, `blocked_versions`, `rollout.percent`/`rollout.force_bypasses`, `message`, `config.cloud_stt_enabled`/`config.banner`.
- A policy is adopted only if its signature verifies with `keys::POLICY_PUBLIC_KEY`, it is for this channel, it has not expired, and `seq` is higher than any accepted before (equal only if byte-identical). Installs it directs must match the pinned tarball signature, which is what makes downgrades safe. Once a policy has expired, its target stays a ceiling: only newer releases up to that target are offered. A copy that never accepted a policy offers any newer release. Blocked versions are never offered. An `action` this build does not know is treated as `pause`.
- State lives in `linty-policy.json` (app data dir): highest `seq`, the last policy and signature (re-verified on load), the sticky blocked versions and ceiling, and a local 0–99 rollout bucket that is never sent. `reset_all_data` keeps it.
- Host: `infra/updates` is a Cloudflare Worker at `updates.linty.ai`. It serves the policy envelope from KV (`policy:<channel>`) and, at `/v1/manifest/<channel>/<platform>/<version>`, the target release's `latest.json` from GitHub (204 when already on the target, 404 without a policy so the updater falls back to GitHub). The updater's first endpoint in `tauri.conf.json` is this route. The worker stores only per-request counts (route, channel, platform, version) in Analytics Engine; Workers Logs are off.
- Publishing: `node scripts/policy/publish.mjs` (`--show`, `--dry-run`, `--action`, `--version`, `--percent`, `--block`, `--min`, `--cloud-stt`, `--banner`, `--refresh`). It carries blocked versions, the minimum and remote config over, signs with `tauri signer`, verifies against `keys.rs`, and uploads with Wrangler. Operations: `docs/runbooks/update-policy.md`. Once a policy is published, a new GitHub release reaches no one until a policy targets it.
- Keys: `src-tauri/src/keys.rs` holds the policy and root public keys. The maintainer holds the private halves outside the repository and CI; they must never be regenerated, because installed copies trust only the keys they shipped with.

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
