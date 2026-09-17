# Dictation pill and hands-free listening

The capsule uses the generated Linty favicon (`public/brand/favicon.png`). Its
234 × 40 px normal footprint stays fixed across listening, preparation,
processing and success. Input levels form a small scrolling waveform; silence
settles to dots. There is no continuous canvas draw loop. Processing uses a slow
ring, followed by a check and a short fade after 1.1 seconds. The favicon stays
in place. Content changes fade in over 160 ms; entry and exit take 180 ms.
Reduced motion disables these animations. Errors can expand for readability.

Neither partial nor final transcript text is sent to or displayed in the pill.
Text still goes to its target application and History as before. The stop button
finishes a recording, and error/empty-stop notices have a dismiss button. Stop
requests and inactivity events include the capture generation, so a queued event
cannot stop a later recording. A new state cancels an older pending fade-out.

## Trigger gestures

The configured modifier or accelerator and the alternate accelerator all use
one gesture interpreter:

- Hold to talk; release to finish.
- Two presses within 400 ms latch hands-free listening. Releasing the second
  press leaves listening on. A small lock beside the elapsed time identifies it.
- Double-press again to finish. Either registered trigger can turn it off, but
  two different triggers cannot combine into one accidental double-press.
- OS key repeat does not count as another press. A quick single tap waits only
  for the double-press window; a hold of at least 250 ms stops immediately on
  release. Changing the trigger finishes an active capture.

Latching works while the microphone is opening or the model is preparing.
Recovery, sleep, and a capture timeout clear the gesture state.

## Quiet-input rescue

After **20 seconds without detected input activity**, the pill says “Still
talking?” and shows seconds remaining. Input clears the warning. At **30
seconds**, the native audio worker drops the microphone stream before notifying
the frontend. Both held and hands-free recording use this safeguard. Continuous
input has no fixed recording-length limit.

The worker computes RMS and peak over 100 ms frames of the existing 16 kHz
mono audio. A rolling five-second lower envelope estimates steady room noise;
RMS above 1.6 times that floor and peak above 3 times it for two consecutive
frames count as activity. The floor can fall to 0.00001 RMS to preserve quiet
input. Isolated clicks cannot reset the deadline. Checks run every 250 ms while
recording and block on commands while idle; no additional speech model, GPU or
Neural Engine inference is used. Device-opening time is excluded.

These are **input activity measurements, not semantic speech detection**.
Varying background audio can keep capture alive, and sufficiently uniform or
very faint input can be treated as inactivity. The long warning gives a person
time to resume or finish before stopping. Existing ASR/VAD behavior is unchanged;
this guard never crops, normalizes, or removes words from recorded audio.

An auto-stop with detected input transcribes the full recording once. A capture
with no detected input frees its buffer and shows “No input · stopped”, without
calling ASR. Model residency still follows the existing idle-unload preference;
resident models do not continuously perform inference. If the frontend is
unresponsive, the mic is already closed and the existing missing-callback
watchdog subsequently discards the abandoned buffer.

## Validation

- `yarn test`: gesture tests cover modifier and accelerator holds, double presses,
  repeats, mismatched triggers, alternate stopping and recovery.
- `yarn test:dictation` (also `UI_BROWSER=webkit`): configured shortcuts, delayed
  startup, warning/resume, empty stop without ASR, stale events, a single paste,
  no transcript payload, favicon, stable layout, fading and accessibility.
- `yarn test:recovery`: microphone errors, cancelled startup, deadlines and late
  inference suppression remain covered.
- `cargo test --features local-stt,parakeet --lib`: native silence, quiet input,
  click rejection and steady-background tests alongside the existing suite.

Input tests use deterministic sample frames and UI tests use injected native
signals. They do not claim physical keyboard/microphone or real-room validation.
