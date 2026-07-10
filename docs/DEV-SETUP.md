# Linty — Development Setup Guide

How to set up Linty development on a fresh macOS machine.

## Prerequisites

### Required Tools

| Tool | Version | Install |
|------|---------|---------|
| Xcode CLT | Latest | `xcode-select --install` |
| Rust | Stable | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Node.js | 20+ | `brew install node@20` |
| Yarn | 1.x | `npm install -g yarn` |

### System Requirements

| Requirement | Value |
|------------|-------|
| macOS | 13.0+ (Ventura) |
| Recommended build machine | macOS 14+ (Sonoma) |
| Architecture | Apple Silicon or Intel |

## Getting Started

```bash
git clone git@github.com:lintyai/linty.git
cd linty
yarn install
```

### Dev Mode

```bash
yarn tauri dev     # Full app — frontend (HMR on :1420) + Rust backend
yarn dev           # Frontend only — useful for UI work
```

### Rust Only

```bash
cd src-tauri
cargo check --features local-stt    # Type check
cargo build --features local-stt    # Build
cargo fmt                           # Format
cargo clippy --features local-stt   # Lint
```

## Production Build (Signing + Notarization)

### 1. Apple Developer Certificate

Export your **Developer ID Application** certificate as a `.p12` from Keychain Access and import it on the new machine.

### 2. Environment Variables

Create `~/.tokens` with:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAM_ID)"
export APPLE_ID="your@email.com"
export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # App-specific password from appleid.apple.com
export APPLE_TEAM_ID="YOUR_TEAM_ID"
```

### 3. Build

```bash
source ~/.tokens && yarn build:mac
```

This runs `scripts/build-mac.sh` which:
- Builds with `tauri build --bundles dmg,app -- --features local-stt`
- Signs the `.app` bundle
- Notarizes both `.app` and `.dmg` via `xcrun notarytool`
- Staples the notarization ticket

## Testing Permissions

Launch from **Finder** (not terminal) to test TCC permission prompts. Terminal launch bypasses entitlement checks.

| Permission | Entitlement Key | Purpose |
|------------|----------------|---------|
| Microphone | `com.apple.security.device.audio-input` | Voice capture |
| Accessibility | System Preferences toggle | fn key monitoring + auto-paste |

If permissions get stuck, reset with:

```bash
tccutil reset Microphone ai.linty.desktop
```

## Cargo Feature Flags

| Feature | Purpose |
|---------|---------|
| `local-stt` | Enables whisper-rs with Metal GPU for on-device transcription |
| `custom-protocol` | Tauri custom protocol (enabled by default) |

Production builds use `--features local-stt`. Dev builds work without it (cloud-only transcription via Groq).

## CI/CD

GitHub Actions workflow at `.github/workflows/build-dmg.yml`:
- Triggers on push to `main` (skip with `[skip ci]` in commit message)
- Auto-bumps patch version across `package.json`, `tauri.conf.json`, `Cargo.toml`
- Builds, signs, notarizes, creates GitHub Release

### CI Secrets Required

| Secret | Purpose |
|--------|---------|
| `LINTY_APPLE_SIGNING_CERTIFICATE` | Base64-encoded .p12 certificate |
| `LINTY_APPLE_SIGNING_CERTIFICATE_PASSWORD` | Certificate password |
| `LINTY_APPLE_NOTARIZATION_APPLE_ID` | Apple ID email |
| `LINTY_APPLE_NOTARIZATION_PASSWORD` | App-specific password |
| `LINTY_APPLE_TEAM_ID` | Developer Team ID |
| `LINTY_TAURI_SIGNING_PRIVATE_KEY` | Update signature key |
| `LINTY_TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Key password |

## Architecture Quick Reference

```
Frontend (React 19 + Zustand)  <-- IPC -->  Backend (Rust + Tauri 2)
  src/pages/          (6 pages)              src-tauri/src/audio.rs       (cpal, 16kHz mono)
  src/hooks/                                 src-tauri/src/transcribe.rs  (Whisper/Groq)
  src/store/slices/   (Zustand)              src-tauri/src/fnkey.rs       (NSEvent monitor)
  src/components/                            src-tauri/src/permissions.rs (AVFoundation FFI)
                                             src-tauri/src/paste.rs       (CGEvent Cmd+V)
                                             src-tauri/src/watchdog.rs    (5-min max guard)
```

## Key Gotchas

- **Don't restart dev server** — Vite HMR picks up changes automatically
- **Don't set `LSUIElement=true`** in Info.plist — prevents TCC prompts on Sequoia
- **Entitlements**: Use `device.audio-input` not `device.microphone` (Hardened Runtime, not App Sandbox)
- **Tauri bundles**: `--bundles dmg,app` (comma-separated, not space-separated)
- **DMG notarization**: `.app` is auto-notarized by Tauri; `.dmg` needs separate `xcrun notarytool submit`
- **Watchdog**: Max recording is 5 minutes — auto-stops and clears buffer beyond that
