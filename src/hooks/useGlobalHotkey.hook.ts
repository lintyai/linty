import { useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  register,
  unregister,
  isRegistered,
} from "@tauri-apps/plugin-global-shortcut";
import { currentDictation, ownsDictation, isRecoveringDictation, recoverDictation } from "@/services/dictation-recovery.service";
import { useRecording } from "./useRecording.hook";
import { useTranscription } from "./useTranscription.hook";
import { useAppStore } from "@/store/app.store";
import { FALLBACK_TRIGGER_ACCELERATOR } from "@/store/slices/settings.slice";
import { isModifierHoldTrigger, triggerModifierName, formatTriggerLabel } from "@/lib/trigger.util";

export function useGlobalHotkey() {
  const { startRecording, stopRecording } = useRecording();
  const { processAudio, clearPendingTimers } = useTranscription();
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const resetRecording = useAppStore((s) => s.resetRecording);

  // Latest-ref pattern: always hold current callback references so
  // event listeners never go stale and effects don't need to re-register.
  const stopRecordingRef = useRef(stopRecording);
  const processAudioRef = useRef(processAudio);
  const startRecordingRef = useRef(startRecording);
  const clearPendingTimersRef = useRef(clearPendingTimers);
  const setCurrentViewRef = useRef(setCurrentView);
  useEffect(() => {
    stopRecordingRef.current = stopRecording;
    processAudioRef.current = processAudio;
    startRecordingRef.current = startRecording;
    clearPendingTimersRef.current = clearPendingTimers;
    setCurrentViewRef.current = setCurrentView;
  }, [stopRecording, processAudio, startRecording, clearPendingTimers, setCurrentView]);

  const isRecordingRef = useRef(false);
  const isRecording = useAppStore((s) => s.isRecording);
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  // Synchronous lock — prevents concurrent release handling / duplicate pastes
  const processingRef = useRef(false);

  const handlePress = useCallback(async () => {
    if (isRecordingRef.current || processingRef.current || isRecoveringDictation()) return;
    // Synchronously mark as recording BEFORE any async work — prevents a fast
    // fn-release from seeing isRecordingRef as false and being silently dropped.
    isRecordingRef.current = true;
    // Cancel any stale hide/reset timers from a previous recording session
    clearPendingTimersRef.current();

    const inFocus = document.hasFocus();

    try {
      if (inFocus) setCurrentViewRef.current("system-check");
      const started = await startRecordingRef.current();
      if (!started) { isRecordingRef.current = false; return; }
      // A quick release may already be stopping the stream. Never overwrite its state.
      if (!inFocus && isRecordingRef.current && !processingRef.current) {
        void invoke("show_capsule").then(() => {
          if (isRecordingRef.current && !processingRef.current) return invoke("emit_capsule_state", { state: "recording" });
        }).catch(() => {});
        void invoke("play_capsule_sound", { sound: "start" }).catch(() => {});
      }
    } catch (error) {
      isRecordingRef.current = false;
      await recoverDictation(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const handleRelease = useCallback(async () => {
    if (!isRecordingRef.current || processingRef.current) return;
    // Immediately lock to prevent any concurrent entry
    processingRef.current = true;
    isRecordingRef.current = false;

    const session = currentDictation();
    try {
      const result = await stopRecordingRef.current();
      if (result.sample_count > 0 && !session.cancelled) {
        await processAudioRef.current(result);
      }
    } catch (error) {
      if (!session.cancelled) await recoverDictation(error instanceof Error ? error.message : String(error), session);
    } finally {
      if (ownsDictation(session)) processingRef.current = false;
    }
  }, []);

  // ── Ensure fn key monitor is active (handles dev rebuilds losing accessibility) ──
  useEffect(() => {
    invoke("reinit_fn_key_monitor").catch(() => {});
  }, []);

  // Recover both the native capture and every frontend lock. A late result
  // from a cancelled dictation cannot paste or change the next attempt's UI.
  useEffect(() => {
    const recover = async (message: string) => {
      await recoverDictation(message);
      processingRef.current = false;
      isRecordingRef.current = false;
      resetRecording();
    };
    const listeners = [
      listen<string>("audio-stream-error", ({ payload }) => { void recover(payload); }),
      listen<string>("watchdog-recovery", ({ payload }) => { void recover(payload); }),
      listen("system-wake", () => {
        const state = useAppStore.getState();
        if (isRecordingRef.current || processingRef.current || state.isRecording || ["transcribing", "correcting", "pasting"].includes(state.status)) {
          void recover("Dictation interrupted by sleep. Please try again.");
        }
        void invoke("force_reinit_fn_key_monitor").catch(() => {});
      }),
    ];
    return () => { for (const listener of listeners) void listener.then((off) => off()); };
  }, [resetRecording]);

  // ── Primary: modifier-hold push-to-talk (fn or a bare modifier key) ──
  // The Rust flagsChanged monitor emits fnkey-pressed/released for whichever
  // modifier bit set_trigger_modifier points it at.
  const triggerKey = useAppStore((s) => s.triggerKey);
  useEffect(() => {
    if (!isModifierHoldTrigger(triggerKey)) return;

    invoke("set_trigger_modifier", {
      modifier: triggerModifierName(triggerKey),
    }).catch((err) => console.error("Failed to set trigger modifier:", err));

    const unlistenPress = listen("fnkey-pressed", handlePress);
    const unlistenRelease = listen("fnkey-released", handleRelease);

    return () => {
      unlistenPress.then((fn) => fn());
      unlistenRelease.then((fn) => fn());
    };
  }, [triggerKey, handlePress, handleRelease]);

  // ── Accelerator trigger: the configured combo, or Cmd+Shift+Space as
  //    an alternate alongside modifier-hold triggers ──
  useEffect(() => {
    const accelerator = isModifierHoldTrigger(triggerKey)
      ? FALLBACK_TRIGGER_ACCELERATOR
      : triggerKey;
    let mounted = true;

    const setup = async () => {
      try {
        const alreadyRegistered = await isRegistered(accelerator);
        if (alreadyRegistered) {
          await unregister(accelerator);
        }

        await register(accelerator, async (event) => {
          if (!mounted) return;

          if (event.state === "Pressed") {
            await handlePress();
          } else if (event.state === "Released") {
            await handleRelease();
          }
        });
      } catch (err) {
        console.error("Failed to register hotkey:", err);
        // Only toast for a user-chosen trigger — the silent fallback combo
        // failing shouldn't interrupt anyone.
        if (!isModifierHoldTrigger(triggerKey)) {
          useAppStore.getState().addToast({
            type: "error",
            message: `Could not register ${formatTriggerLabel(accelerator)} — another app may be using it. Pick a different trigger in Shortcuts.`,
          });
        }
      }
    };

    setup();

    return () => {
      mounted = false;
      unregister(accelerator).catch(() => {});
    };
  }, [triggerKey, handlePress, handleRelease]);
}
