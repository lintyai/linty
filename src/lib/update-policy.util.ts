import type { PolicyDecision, PolicyUpdateReason } from "@/types/policy.types";

/** Shown when the policy pauses cloud transcription. Matches the Rust message. */
export const CLOUD_STT_PAUSED =
  "Cloud transcription is paused by Linty right now. Switch to on-device in Settings to keep dictating.";

/** Transcription states during which an update must not restart the app. */
const BUSY_STATUSES = new Set(["recording", "transcribing", "correcting", "pasting"]);

export function isDictationBusy(state: { isRecording: boolean; status: string }): boolean {
  return state.isRecording || BUSY_STATUSES.has(state.status);
}

/** The found update is the one the policy requires. */
export function isRequiredUpdate(policy: PolicyDecision | null, version: string): boolean {
  return policy?.update === "required" && policy.targetVersion === version;
}

export function cloudTranscriptionPaused(policy: PolicyDecision | null): boolean {
  return policy?.cloudSttEnabled === false;
}

export function requiredUpdateTitle(reason: PolicyUpdateReason | null): string {
  return reason === "rollback" || reason === "blockedVersion"
    ? "Linty needs to switch versions"
    : "Linty needs to update";
}

export function requiredUpdateExplanation(reason: PolicyUpdateReason | null): string {
  switch (reason) {
    case "blockedVersion":
      return "This version has a problem that can affect your dictation. Linty will move to a version without it.";
    case "rollback":
      return "A recent update caused problems. Linty will go back to the previous version.";
    case "belowMinimum":
      return "This version is no longer supported. Linty will install the current version.";
    default:
      return "An important update is ready. Linty will install it now.";
  }
}

export interface IdleTimers {
  set: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clear: (timer: ReturnType<typeof setTimeout>) => void;
}

// Wrapped: WebKit and Chromium throw "Illegal invocation" when setTimeout is
// called as a method of another object.
const browserTimers: IdleTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (timer) => clearTimeout(timer),
};

/**
 * Resolves once `isBusy()` has been false for `quietMs` without interruption.
 * `subscribe` is a store subscription (returns its unsubscribe function); the
 * timer restarts only when dictation starts, not on unrelated store changes.
 */
export function waitUntilIdle(
  isBusy: () => boolean,
  subscribe: (listener: () => void) => () => void,
  quietMs: number,
  timers: IdleTimers = browserTimers,
): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: () => void = () => {};
    const finish = () => {
      unsubscribe();
      resolve();
    };
    const update = () => {
      if (isBusy()) {
        if (timer !== undefined) timers.clear(timer);
        timer = undefined;
      } else if (timer === undefined) {
        timer = timers.set(finish, quietMs);
      }
    };
    unsubscribe = subscribe(update);
    update();
  });
}
