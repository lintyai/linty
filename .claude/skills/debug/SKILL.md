---
name: debug
user-invocable: true
disable-model-invocation: false
description: Systematic debugging for the Linty desktop app using Google SRE methodology. Traces issues through audio capture, Rust backend, Tauri IPC, React frontend, macOS permissions/FFI, and transcription pipeline. Runs build verification after fix. Triggers on "debug this", "debug the app", "why is this failing", "find the bug", "debug error".
---

# Debug — Systematic Application Debugging

Strategic, methodical debugging modeled after Google SRE's troubleshooting methodology. Follows the **hypothetico-deductive method**: observe, theorize, test, confirm, fix, verify.

## Core Principle: Trace Correlation

Debug traces signals across every layer to reconstruct the full lifecycle:

```
 User Action (fn key press)
     |
     v
 [macOS FFI]  fnkey.rs → NSEvent monitor → Tauri event
     |
     v
 [Frontend]   React hook → Zustand store → invoke() IPC
     |
     v
 [Tauri IPC]  Command handler → AppState
     |
     v
 [Audio]      cpal capture → Arc<Mutex<Vec<f32>>> buffer
     |
     v
 [Transcribe] whisper-rs (local) or Groq API (cloud) → text
     |
     v
 [Clipboard]  snapshot → write text → Cmd+V paste → restore
```

## When to Use

- Fn key not triggering recording
- Audio not capturing or sounds wrong
- Transcription fails (local Whisper or Groq)
- Auto-paste not working (clipboard, Cmd+V simulation)
- Microphone permission issues (TCC)
- Capsule overlay not showing
- Build failures after code changes
- Tray icon or window behavior issues

## When NOT to Use

- You know the exact bug and just need to fix it — fix directly
- Code style/quality issues — use `/code-optimizer` instead

---

## Phase 1: INTAKE — Problem Report

Collect structured information before touching code. Use `AskUserQuestion` if not provided.

### Required Context

| Field | Description | Example |
|-------|-------------|---------|
| **Symptom** | What the user observes | "Nothing happens when I press fn key" |
| **Expected** | What should happen | "Should start recording and show capsule" |
| **Steps to reproduce** | How to trigger | "Press and hold fn key for 2 seconds" |
| **Scope** | Which layer | Audio / Transcription / Clipboard / macOS / UI |
| **Recency** | When it started | "After last commit" / "Always" / "Intermittent" |

### Quick Classification

| Type | Signals | Start At |
|------|---------|----------|
| **Audio Issue** | No sound, distorted, wrong device | Phase 3A (Audio) |
| **Transcription** | Empty text, wrong text, timeout | Phase 3B (Transcription) |
| **macOS Permission** | No mic prompt, "denied", silent fail | Phase 3C (Permissions) |
| **IPC Issue** | Frontend not responding, command errors | Phase 3D (Tauri IPC) |
| **UI Bug** | Component not rendering, wrong state | Phase 3E (Frontend) |
| **Clipboard/Paste** | Text not pasting, wrong text pasted | Phase 3F (Clipboard) |
| **Build Failure** | TypeScript errors, Rust errors | Phase 3G (Build) |
| **Unknown** | Can't classify | Phase 2 (full triage) |

---

## Phase 2: TRIAGE — Stabilize Before Diagnosing

### 2.1 Check System Health (Parallel)

```bash
# 1. TypeScript compilation
yarn build 2>&1 | tail -20

# 2. Rust compilation
cd src-tauri && cargo check --features local-stt 2>&1 | tail -20

# 3. Check Tauri config
cat src-tauri/tauri.conf.json | head -30

# 4. Check entitlements
cat src-tauri/Entitlements.plist
```

### 2.2 Check Recent Changes

```bash
git log --oneline -10
git diff HEAD~1 --name-only
git status
git diff
```

---

## Phase 3: EXAMINE — Systematic Signal Collection

### 3A. Audio Layer

**Key file**: `src-tauri/src/audio.rs`

| Check | What to look for |
|-------|-----------------|
| Device selection | Is default input device found? |
| Sample rate | Is it resampling to 16kHz mono? |
| Buffer state | Is `Arc<Mutex<Vec<f32>>>` being populated? |
| Recording flag | Is `is_recording` state correct? |
| Stream lifecycle | Is cpal stream starting/stopping cleanly? |

**Common issues:**
- Device not found → no input device available
- Buffer empty → stream not capturing
- Samples all zeros → wrong device or muted
- Buffer growing forever → stop_recording not called (watchdog should catch)

### 3B. Transcription Pipeline

**Key file**: `src-tauri/src/transcribe.rs`

| Check | What to look for |
|-------|-----------------|
| Local (Whisper) | Is model loaded? Is `whisper-rs` returning results? |
| Cloud (Groq) | Is API key set? Is network request succeeding? |
| Input format | Is audio buffer non-empty, correct sample rate? |
| Feature flag | Is `local-stt` feature enabled for local mode? |

**Common issues:**
- Empty buffer → recording didn't capture audio
- Whisper returns empty → model not loaded or audio too short
- Groq 401 → invalid API key
- Groq timeout → network issue or audio too long

### 3C. macOS Permissions (TCC)

**Key file**: `src-tauri/src/permissions.rs`

| Check | What to look for |
|-------|-----------------|
| Entitlements | `com.apple.security.device.audio-input` (NOT `device.microphone`) |
| Info.plist | `NSMicrophoneUsageDescription` present |
| LSUIElement | Must NOT be set (prevents TCC prompts) |
| Launch method | Terminal launch bypasses entitlements — test from Finder |
| TCC state | Check if previously denied (requires System Settings) |

**Critical gotcha**: Wrong entitlement key = macOS TCC silently denies WITHOUT showing a prompt.

```bash
# Check entitlements
cat src-tauri/Entitlements.plist

# Reset TCC for testing
tccutil reset Microphone ai.linty.desktop
```

### 3D. Tauri IPC

**Key file**: `src-tauri/src/lib.rs`

| Check | What to look for |
|-------|-----------------|
| Command registration | Is the command registered in `.invoke_handler()`? |
| State management | Is `AppState` managed correctly? |
| Event emission | Are events emitting on the right channel? |
| Error types | Are commands returning `Result<T, String>`? |

**Common issues:**
- "command not found" → not registered in invoke_handler
- Serialization error → Rust type doesn't derive Serialize
- State panic → forgot to `.manage(state)` in builder

### 3E. Frontend Layer

| Check | What to look for |
|-------|-----------------|
| Zustand store | Is state updating correctly? Check slices. |
| Tauri events | Is `listen()` registered for backend events? |
| Recording hook | Is `useRecording` connecting to IPC correctly? |
| Navigation | Is the right page rendering? Check navigation slice. |

**Key files:**
- `src/hooks/useRecording.hook.ts` — recording lifecycle
- `src/hooks/useTranscription.hook.ts` — transcription flow
- `src/store/slices/recording.slice.ts` — recording state
- `src/store/slices/transcription.slice.ts` — transcription state

### 3F. Clipboard & Paste

**Key files**: `src-tauri/src/clipboard.rs`, `src-tauri/src/paste.rs`

| Check | What to look for |
|-------|-----------------|
| Snapshot | Is clipboard content saved before writing? |
| Write | Is transcribed text written to clipboard? |
| Paste simulation | Is CGEvent Cmd+V firing? |
| Restore | Is original clipboard content restored after paste? |
| Timing | Are there enough delays between clipboard ops? |

### 3G. Build & Compilation

```bash
# Frontend
yarn build

# Rust (with local STT)
cd src-tauri && cargo check --features local-stt

# Full Tauri build
yarn tauri build --bundles dmg,app -- --features local-stt
```

| Error Pattern | Cause | Fix |
|--------------|-------|-----|
| TypeScript error | Type mismatch | Fix the type |
| `cannot find crate` | Missing Cargo dependency | Add to Cargo.toml |
| Linking error | Missing system framework | Check build.rs or Cargo features |
| Entitlement error | Signing issue | Check Entitlements.plist |

---

## Phase 4: DIAGNOSE — Hypothesis Formation

### 4.1 Formulate Hypotheses

Based on signals from Phase 3, form 2-3 ranked hypotheses:

```
Hypothesis 1 (most likely): <description>
  Evidence for: <what supports this>
  Evidence against: <what contradicts this>
  Test: <how to confirm/refute>
```

### 4.2 Known Gotchas (Linty-Specific)

Check these FIRST — they explain most issues:

| Gotcha | Symptom |
|--------|---------|
| Wrong entitlement key (`device.microphone` vs `device.audio-input`) | TCC silently denies mic access |
| `LSUIElement=true` in Info.plist | TCC prompts never appear |
| Terminal launch bypasses entitlements | Works in dev, fails in release |
| `std::mem::take` on empty buffer | Transcription gets empty audio |
| Mutex held across await | Deadlock on async Tauri command |
| Capsule window z-order | Overlay doesn't appear above other windows |
| Watchdog timer race | Recording stops unexpectedly |

---

## Phase 5: TEST & TREAT

### 5.1 Apply Fix

Once root cause is confirmed:
1. Fix the root cause — not the symptom
2. No band-aids
3. Single fix — don't mix in refactoring
4. Remove any temporary debug code

---

## Phase 6: BUILD VERIFICATION (Mandatory)

```bash
# Frontend build
yarn build

# Rust check
cd src-tauri && cargo check --features local-stt
```

---

## Phase 7: REPORT

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  DEBUG COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Symptom:    <what was reported>
Root Cause: <confirmed cause>
Category:   <Audio/Transcription/macOS/IPC/UI/Clipboard/Build>
Fix:        <what was changed>

Files Modified:
- <file1>: <what changed>
- <file2>: <what changed>

Build:      PASS / FAIL
Verified:   <how the fix was confirmed>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Skill: /debug
File:  .claude/skills/debug/SKILL.md
```

---

## Error Handling

| Scenario | Action |
|----------|--------|
| Can't reproduce | Ask for exact steps, check if intermittent |
| Multiple root causes | Fix primary first, note secondary |
| Fix introduces new errors | Revert, re-analyze |
| Build fails after fix | Treat as Phase 3G |

---

## Tips

- Check recent `git log` FIRST — most bugs are regressions
- Read the error message completely before forming hypotheses
- Don't guess — read the actual code at the failure point
- For macOS permission issues, ALWAYS test from Finder, not Terminal
- Use `tccutil reset Microphone ai.linty.desktop` to clear stale TCC entries
