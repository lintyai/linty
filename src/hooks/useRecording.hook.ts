import { useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/store/app.store";
import type { ApplicationIdentity } from "@/types/transcript.types";
import { beginDictation, currentDictation, finishEmptyDictation, GROQ_SETUP_ERROR, isRecoveringDictation, ownsDictation, recoverDictation } from "@/services/dictation-recovery.service";
import type { DictationSession } from "@/lib/dictation-session";

export interface StopResult {
  sample_count: number;
  duration_secs: number;
  application?: ApplicationIdentity | null;
}

// The hotkey and microphone-test widget control the same native recording.
let starting: { session: DictationSession; promise: Promise<boolean> } | null = null;
let startedAt = 0;

export function useRecording() {
  const isRecording = useAppStore((s) => s.isRecording);
  const recordingDuration = useAppStore((s) => s.recordingDuration);
  const amplitude = useAppStore((s) => s.amplitude);

  const startRecording = useCallback(() => {
    if (starting && ownsDictation(starting.session) && !starting.session.cancelled) return starting.promise;
    const state = useAppStore.getState();
    if (isRecoveringDictation() || state.isRecording || ["transcribing", "correcting", "pasting"].includes(state.status)) return Promise.resolve(false);
    const session = beginDictation();
    const promise = (async () => {
      try {
        const settings = useAppStore.getState();
        if (settings.sttMode === "cloud" && !settings.groqApiKey.trim()) throw new Error(GROQ_SETUP_ERROR);
        await session.run(() => invoke("start_recording", { trackApplication: settings.settingsLoaded && settings.trackApplicationUsage }), 10_000, "Microphone did not start. Check your input and try again.");
        startedAt = Date.now();
        useAppStore.getState().setIsRecording(true);
        useAppStore.getState().setStatus("recording");
        return true;
      } catch (error) {
        if (!session.cancelled) await recoverDictation(error instanceof Error ? error.message : String(error), session);
        return false;
      }
    })();
    starting = { session, promise };
    void promise.finally(() => { if (starting?.session === session) starting = null; });
    return promise;
  }, []);

  const stopRecording = useCallback(async (): Promise<StopResult> => {
    const session = currentDictation();
    const empty = { sample_count: 0, duration_secs: 0 };
    if (starting?.session === session && !(await starting.promise)) return empty;
    if (session.cancelled) return empty;
    try {
      const result = await session.run(() => invoke<StopResult>("stop_recording"), 5000, "Microphone did not stop. Please try again.");
      useAppStore.getState().setIsRecording(false);
      if (result.sample_count > 0) useAppStore.getState().setStatus("transcribing");
      else finishEmptyDictation(session);
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

  useEffect(() => {
    const unlisten = listen<number>("audio-amplitude", ({ payload }) => {
      if (useAppStore.getState().isRecording) useAppStore.getState().setAmplitude(payload);
    });
    return () => { void unlisten.then((off) => off()); };
  }, []);

  return { isRecording, recordingDuration, amplitude, startRecording, stopRecording, getRecordingStartTime: () => startedAt };
}
