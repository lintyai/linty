import { useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/store/app.store";
import type { ApplicationIdentity } from "@/types/transcript.types";
import { beginDictation, currentDictation, finishEmptyDictation, GROQ_SETUP_ERROR, isRecoveringDictation, ownsDictation, recoverDictation } from "@/services/dictation-recovery.service";
import type { DictationSession } from "@/lib/dictation-session";
import { prepareDictation } from "@/services/dictation-preparation.service";

export interface StopResult {
  sample_count: number;
  duration_secs: number;
  application?: ApplicationIdentity | null;
}

// The hotkey and microphone-test widget control the same native recording.
let starting: { session: DictationSession; promise: Promise<boolean>; phase: "preparing" | "microphone" } | null = null;
let startedAt = 0;

export function useRecording() {
  const isRecording = useAppStore((s) => s.isRecording);
  const recordingDuration = useAppStore((s) => s.recordingDuration);

  const startRecording = useCallback(() => {
    if (starting && ownsDictation(starting.session) && !starting.session.cancelled) return starting.promise;
    const state = useAppStore.getState();
    if (isRecoveringDictation() || state.isRecording || ["preparing", "transcribing", "correcting", "pasting"].includes(state.status)) return Promise.resolve(false);
    const session = beginDictation();
    const promise = (async () => {
      try {
        const settings = useAppStore.getState();
        if (settings.sttMode === "cloud" && !settings.groqApiKey.trim()) throw new Error(GROQ_SETUP_ERROR);
        useAppStore.getState().setStatus("preparing");
        if (!document.hasFocus()) void invoke("show_capsule").then(() => {
          if (ownsDictation(session) && !session.cancelled && useAppStore.getState().status === "preparing") {
            return invoke("emit_capsule_state", { state: "preparing" });
          }
        }).catch(() => {});
        await session.run(prepareDictation, 180_000, "Dictation preparation timed out. Please try again.");
        if (starting?.session === session) starting.phase = "microphone";
        const generation = await session.run(() => invoke<number>("start_recording", { trackApplication: settings.settingsLoaded && settings.trackApplicationUsage }), 10_000, "Microphone did not start. Check your input and try again.");
        useAppStore.getState().setRecordingGeneration(generation);
        startedAt = Date.now();
        useAppStore.getState().setIsRecording(true);
        useAppStore.getState().setStatus("recording");
        return true;
      } catch (error) {
        if (!session.cancelled) await recoverDictation(error instanceof Error ? error.message : String(error), session);
        return false;
      }
    })();
    starting = { session, promise, phase: "preparing" };
    void promise.finally(() => { if (starting?.session === session) starting = null; });
    return promise;
  }, []);

  const stopRecording = useCallback(async (options?: { deferEmpty?: boolean }): Promise<StopResult> => {
    const session = currentDictation();
    const empty = { sample_count: 0, duration_secs: 0 };
    if (starting?.session === session && starting.phase === "preparing") {
      // Releasing a hold-to-talk key while warming must never open the mic
      // later or produce a phantom empty dictation. Keep the preparation work.
      finishEmptyDictation(session);
      session.cancel();
      return empty;
    }
    if (starting?.session === session && !(await starting.promise)) return empty;
    if (session.cancelled) return empty;
    try {
      const result = await session.run(() => invoke<StopResult>("stop_recording"), 5000, "Microphone did not stop. Please try again.");
      useAppStore.getState().setIsRecording(false);
      useAppStore.getState().setHandsFree(false);
      useAppStore.getState().setQuietSeconds(0);
      if (result.sample_count > 0) useAppStore.getState().setStatus("transcribing");
      else if (!options?.deferEmpty) finishEmptyDictation(session);
      return result;
    } catch (error) {
      if (!session.cancelled) await recoverDictation(error instanceof Error ? error.message : String(error), session);
      return empty;
    }
  }, []);

  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(() => useAppStore.getState().setRecordingDuration((Date.now() - startedAt) / 1000), 100);
    return () => clearInterval(timer);
  }, [isRecording]);

  return { isRecording, recordingDuration, startRecording, stopRecording, getRecordingStartTime: () => startedAt };
}
