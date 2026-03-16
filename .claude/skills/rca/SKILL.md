---
name: rca
user-invocable: true
disable-model-invocation: false
description: Root Cause Analysis for Linty issues. Investigates audio capture failures, transcription errors, macOS permission problems, clipboard/paste failures, capsule overlay issues, and build problems. Follows a systematic investigation workflow. Triggers on "investigate issue", "root cause", "why is this broken", "blank transcription", "mic not working", "paste not working".
---

# RCA — Root Cause Analysis

Systematic investigation of Linty issues: audio not capturing, transcription empty, mic permission denied, paste not working, capsule not showing, build broken.

## Core Concept: Trace the Signal Path

```
 fn key press (NSEvent)
     |
     v
 fnkey.rs -> Tauri event "fnkey-pressed"
     |
     v
 React hook (useRecording) -> invoke("start_recording")
     |
     v
 audio.rs -> cpal stream -> Arc<Mutex<Vec<f32>>> buffer
     |
     v (fn key release)
 invoke("stop_recording") -> std::mem::take(buffer)
     |
     v
 transcribe.rs -> whisper-rs (local) / Groq API (cloud)
     |
     v
 clipboard.rs -> snapshot -> write text
     |
     v
 paste.rs -> CGEvent Cmd+V -> restore clipboard
```

## Input Required

Ask the user for:
1. **What happened** — what they observed
2. **What should happen** — expected behavior
3. **When** — after a code change? Always? Intermittent?
4. **How launched** — Terminal (`yarn tauri dev`) or Finder (DMG install)?
5. **Screenshot** — if available

---

## Investigation Workflow

Execute steps IN ORDER. Run independent checks in PARALLEL.

### Step 1: Check Build State

```bash
# Frontend builds?
yarn build 2>&1 | tail -20

# Rust builds?
cd src-tauri && cargo check --features local-stt 2>&1 | tail -20
```

If build fails, the issue is likely a compilation error — fix that first.

---

### Step 2: Check Recent Changes

```bash
git log --oneline -10
git diff HEAD~1 --name-only
git status
```

Most issues are regressions from the last commit.

---

### Step 3: Check macOS Permissions

**This is the #1 cause of "it doesn't work" issues.**

| Check | How |
|-------|-----|
| Entitlements correct? | `cat src-tauri/Entitlements.plist` — must have `device.audio-input` |
| Info.plist clean? | Must NOT have `LSUIElement` — check `src-tauri/Info.plist` |
| TCC state? | System Settings > Privacy > Microphone — is Linty listed? |
| Launched correctly? | Terminal launch bypasses entitlements — test from Finder/DMG |

```bash
# Check entitlements
cat src-tauri/Entitlements.plist

# Reset TCC for fresh test
tccutil reset Microphone ai.linty.desktop
```

**Critical knowledge:**
- Wrong entitlement (`device.microphone` instead of `device.audio-input`) = TCC silently denies
- `LSUIElement=true` = TCC prompts never appear on macOS Sequoia
- Once denied, `requestAccessForMediaType:` returns false without prompting
- Terminal launch bypasses entitlement checks entirely

---

### Step 4: Check Audio Pipeline

**Key file**: `src-tauri/src/audio.rs`

| Check | What to look for |
|-------|-----------------|
| Input device | Is `default_input_device()` returning a device? |
| Sample rate | Is audio captured at 16kHz mono? |
| Buffer content | Is `Arc<Mutex<Vec<f32>>>` non-empty after recording? |
| Recording state | Is `is_recording` flag set/cleared correctly? |
| Watchdog | Is `watchdog.rs` killing runaway recordings? |

**Common audio issues:**
- No input device → user has no mic or wrong device selected
- Buffer empty → cpal stream not starting (permission issue?)
- All zeros → mic is muted at system level
- Buffer grows forever → `stop_recording` not called

---

### Step 5: Check Transcription

**Key file**: `src-tauri/src/transcribe.rs`

| Mode | Check |
|------|-------|
| Local (whisper-rs) | Is model file present? Is `local-stt` feature enabled? |
| Cloud (Groq) | Is API key set in settings? Is network available? |

**Common transcription issues:**
- Empty result → audio buffer was empty (go back to Step 4)
- Whisper crash → model file corrupted, re-download
- Groq 401 → invalid API key
- Groq timeout → audio too long or network issue

---

### Step 6: Check Clipboard & Paste

**Key files**: `src-tauri/src/clipboard.rs`, `src-tauri/src/paste.rs`

| Check | What to look for |
|-------|-----------------|
| Snapshot | Is original clipboard content saved? |
| Write | Is transcription text written to clipboard? |
| Paste simulation | Is CGEvent Cmd+V executing? |
| Restore | Is clipboard restored after delay? |
| Accessibility | Does app have Accessibility permission for key simulation? |

---

### Step 7: Check Tauri IPC & State

**Key file**: `src-tauri/src/lib.rs`

| Check | What to look for |
|-------|-----------------|
| Command registration | Is the command in `.invoke_handler()`? |
| State management | Is `AppState` managed with `.manage()`? |
| Event listeners | Are frontend `listen()` handlers registered? |
| Error propagation | Do commands return `Result<T, String>`? |

---

### Step 8: Check Frontend

| Area | Key Files |
|------|-----------|
| Recording flow | `src/hooks/useRecording.hook.ts` |
| Transcription | `src/hooks/useTranscription.hook.ts` |
| State | `src/store/slices/recording.slice.ts`, `transcription.slice.ts` |
| Capsule | `src/components/CapsulePanel.component.tsx`, `src-tauri/src/capsule.rs` |

---

### Step 9: Formulate & Confirm Root Cause

| Priority | Principle |
|----------|-----------|
| 1st | Recent changes — what changed since it last worked? |
| 2nd | Simple explanations — typo > architecture flaw |
| 3rd | Known gotchas — entitlements, TCC, Terminal launch |
| 4th | Verify, don't assume |

---

### Step 10: Fix & Verify

1. Fix the root cause
2. Build check: `yarn build` + `cargo check --features local-stt`
3. If macOS permission issue: test from Finder, not Terminal

---

## Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  RCA COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Issue:      <what was reported>
Root Cause: <confirmed cause>
Category:   <Audio/Transcription/macOS Permission/Clipboard/IPC/UI/Build>
Fix:        <what was changed>

Evidence:
- <evidence 1>
- <evidence 2>

Files Modified:
- <file1>: <what changed>

Build: PASS / FAIL

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Skill: /rca
File:  .claude/skills/rca/SKILL.md
```

---

## Issue Categories

| Category | Description | Example |
|----------|-------------|---------|
| **Audio** | Capture pipeline issue | No sound, wrong device, empty buffer |
| **Transcription** | STT engine failure | Empty text, wrong text, timeout |
| **macOS Permission** | TCC/entitlement issue | No mic prompt, silently denied |
| **Clipboard** | Paste pipeline issue | Text not pasted, wrong text, clipboard corrupted |
| **IPC** | Tauri command/event issue | Command not found, serialization error |
| **UI** | React rendering issue | Component not showing, wrong state |
| **Build** | Compilation failure | TypeScript error, Rust error, linking error |
| **Config** | Settings/config issue | Wrong Tauri config, missing feature flag |

---

## Key Reference

### Project Structure

| Path | Purpose |
|------|---------|
| `src/` | React frontend |
| `src/hooks/` | Recording, transcription, settings hooks |
| `src/store/slices/` | Zustand state slices |
| `src/pages/` | App pages (Dashboard, Settings, etc.) |
| `src/services/` | Permissions, paste, correction services |
| `src-tauri/src/` | Rust backend |
| `src-tauri/src/audio.rs` | cpal audio capture |
| `src-tauri/src/transcribe.rs` | Whisper + Groq transcription |
| `src-tauri/src/fnkey.rs` | NSEvent fn key monitor |
| `src-tauri/src/permissions.rs` | AVFoundation mic FFI |
| `src-tauri/src/clipboard.rs` | NSPasteboard snapshot/restore |
| `src-tauri/src/paste.rs` | CGEvent Cmd+V simulation |
| `src-tauri/src/capsule.rs` | Overlay panel |
| `src-tauri/src/watchdog.rs` | Runaway recording recovery |

### Build Commands

| Command | Purpose |
|---------|---------|
| `yarn dev` | Vite dev server (HMR, port 1420) |
| `yarn build` | TypeScript + Vite production build |
| `yarn tauri dev` | Full Tauri dev mode |
| `cargo check --features local-stt` | Rust type check |
| `yarn build:mac` | Full release: sign + notarize DMG |
