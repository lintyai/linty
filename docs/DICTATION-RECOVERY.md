# Dictation recovery

## Incident: 17 September 2026

Two independent failures produced the reported capsule behavior:

- The saved input was a Continuity microphone. macOS removed its audio
  device during the session. Recording correctly refused to use that missing input,
  but the frontend hid the capsule and put the explanation in the main window.
- After switching to System Default, recording worked. The selected engine was
  Cloud with no Groq API key. `processAudio` set the main store's error and returned
  without replacing the capsule's `transcribing` state. No inference was running.

The process samples showed a live application and an idle audio command loop.
This incident was an orphaned UI state, not a native-process crash.

## Behavior

- Clicking Cloud in Speech engine settings selects its setup view. A dashed
  selection and **Setup required** status identify the provisional choice, with
  a message that Local remains active. **Save and use Cloud** persists a nonempty
  trimmed key and the Cloud preference, then changes the status to **Active**.
  **Cancel setup** or choosing Local discards the unsaved key draft. Typing or
  leaving the field does not activate Cloud.
- The key input is hidden in Local settings. With an existing saved key, choosing
  Cloud activates it directly. Native tray selection is disabled without a key,
  and the settings save function and recording preflight enforce the same rule.
  Onboarding also requires a key for Cloud. Presence is checked; authenticity is
  checked by Groq when transcribing, with failures shown in the capsule.
- Keys are saved in macOS Keychain. **Remove API key** clears the saved credential
  and switches to Local. Existing plaintext settings are migrated on load; see
  [Credential storage](CREDENTIAL-STORAGE.md) for the security boundaries.
- Startup, stop, configuration, and inference errors replace the spinner with an
  explanation in the capsule. Errors dismiss after six seconds. Empty recordings
  return to idle; no transcription spinner is started for zero samples.
- Recording becomes visible only after the microphone opens successfully. A quick
  key release waits for startup. The hotkey and System Check share startup state.
- Microphone disconnection cancels the active attempt and resets capture. The
  native watchdog also detects eight seconds of missing audio callbacks (ordinary
  silence still produces callbacks). Next recording opens a fresh audio stream.
- Startup is bounded to ten seconds in the frontend (eight seconds for native
  device opening); stop and routine IPC waits to five seconds. Transcription has
  at least sixty seconds, scaling to twice the recording duration plus thirty
  seconds. Recording duration itself remains unlimited.
- Cancelled sessions cannot resume the frontend pipeline and paste late inference
  results. Audio generations prevent abandoned capture from writing into the next
  recording and prevent cancelled Whisper progress from changing its capsule.
- No automatic engine switch, cloud upload, or transcription retry occurs.

## Process crashes

An exited process needs a separate supervisor. For the local development app:

```sh
python3 scripts/run-recoverable.py -- src-tauri/target/debug/linty
```

Keep the Vite development server running for that binary. The runner restarts
nonzero/crash exits with 1/2/4-second backoff, at most three restarts in sixty
seconds. Normal Quit, SIGTERM, and SIGINT stay quit. No login service is installed.
Use the supervisor's PID to stop both it and its child. Its log goes to stderr.
The same runner can wrap an installed app's executable, but it is not bundled as
an automatic production login/crash service.

This does not promise recovery from every failure: a frozen macOS main thread or
hung native inference cannot be forcibly unwound safely by a JavaScript timeout.
The UI can abandon a pending result while its native task is still running. Full
hard-hang isolation needs inference in a killable child process and an external
heartbeat watchdog. Unfinished audio remains in memory and is not preserved over
a restart. The recovery path discards the failed capture rather than pasting it
later into a different application.

## Validation

- `node tests/ui.recovery.mjs` (also with `UI_BROWSER=webkit`): setup/save gating,
  save failure, missing key preflight, errors in the capsule, empty audio, quick
  release, microphone disconnect, hung startup/inference, successful retry, and
  suppression of a late result.
- `python3 tests/supervisor.test.py`: clean quit, one crash followed by recovery,
  bounded crash loop, and intentional termination.
- `cargo test --features local-stt,parakeet --lib`, frontend type/build checks, and
  the existing UI smoke suite.

The failure cases above use injected IPC/device events and a controlled clock.
They do not claim a physical unplug or an actual production binary crash test.
