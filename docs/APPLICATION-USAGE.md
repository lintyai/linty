# Application usage and dashboard metrics

Linty can identify the active macOS application with AppKit’s [`NSWorkspace.frontmostApplication`](https://developer.apple.com/documentation/appkit/nsworkspace/frontmostapplication), which returns the app receiving keyboard events. This is a direct operating-system query; CPU utilization cannot tell us which app a person is using.

## Implemented behavior

- At the start of recording, Rust copies the active app’s display name and bundle identifier into the recording state. The nonactivating capsule is designed to preserve the foreground application.
- The stop result carries that identity alongside the captured audio duration. Successful nonempty transcriptions save it with their final output word count to `~/Library/Application Support/ai.linty.desktop/linty-history.json`.
- The dashboard groups by bundle identifier (falling back to name), reports words, dictation duration, and completed sessions, and allows sorting by words or duration. Selecting an app searches its name in History.
- This metadata stays local even when the user selects cloud transcription. App identity is not included in the speech or correction API requests.
- Settings → Privacy & Storage → **Attribute dictations to apps** enables or disables capture for future recordings. It defaults on. Disabling it does not erase existing history.
- Older records and sessions with missing/disabled attribution appear as **Unattributed**. They remain in overall totals; historical app attribution cannot be reconstructed.
- Stats use the latest 500 saved transcriptions. **All time** means all retained history, not a permanent lifetime counter. Deleting a transcript also removes its contribution to statistics.

## Metric definitions and limits

**Dictation time** is the captured audio duration, not CPU time, processing time, or total time spent using an application. It is attributed to the app active when the recording started. If the user switches apps during recording or transcription, this remains the original app. It is not proof of the destination of a successful paste; generated words count even when an automatic paste fails.

**Words** counts the final transcription output, including any correction or translation. The existing transcription pipeline uses whitespace-separated words, so it is not a linguistic word counter for languages without spaces.

**Average turnaround** averages the time from transcription processing to the paste attempt, including correction when used. **Words per minute** divides total output words by total recorded minutes. Neither is an estimate of time saved.

**Local share** measures the fraction of successful saved dictations that used the local speech engine. App-usage metadata stays local for both engines.

The 7-day and 30-day filters use local calendar days including today. Activity charts use the selected period and aggregate longer retained history by month. Empty periods display zeros and empty states.

Browsers are identified as applications (for example, Safari or Chrome), not individual websites. Site-level attribution would require a separate browser integration and its own controls.

## Feasibility of total active-app hours

Tracking total foreground time while Linty runs is also feasible, but is a separate feature from dictation attribution. Use [`NSWorkspace.didActivateApplicationNotification`](https://developer.apple.com/documentation/appkit/nsworkspace/didactivateapplicationnotification) through the workspace notification center to close the previous app’s interval and open the next one. Avoid CPU/process sampling.

A production implementation should account for idle time, sleep/wake, locked or inactive sessions, app shutdown, and crash recovery. Use monotonic clocks for elapsed intervals and local daily aggregates for persistence. Make background activity tracking a separate explicit setting and provide clear/delete controls. Do not label the elapsed time between two activations as active human usage without handling inactivity.

No continuous activity tracking or site attribution is implemented in this change. Basic app identity uses AppKit; it does not read window contents or request additional screen-recording/automation permissions. Linty’s microphone and accessibility permissions remain necessary for its existing recording and paste features.

## Validation

- `yarn build`: frontend type checking and production build.
- `cargo check --features local-stt` and `cargo check --no-default-features`: native implementation compilation.
- `cargo run --manifest-path src-tauri/Cargo.toml --example app_attribution_probe --no-default-features`: live macOS foreground-app lookup and IPC serialization, without logging app identity.
- `node --test tests/usage.test.mjs` (Node 22.18+): period boundaries, aggregation, application identity, old records, time formatting, and daylight-saving behavior.
- Isolated browser QA uses synthetic fixtures and mocked Tauri IPC, without accessing real local history. Real microphone → native capture → paste attribution still needs a macOS application smoke test.
