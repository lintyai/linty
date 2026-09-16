import { useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  register,
  unregister,
  isRegistered,
} from "@tauri-apps/plugin-global-shortcut";
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
  // Track whether the press originated while app was focused
  const inFocusPressRef = useRef(false);

  const handlePress = useCallback(async () => {
    if (isRecordingRef.current || processingRef.current) return;
    // Synchronously mark as recording BEFORE any async work — prevents a fast
    // fn-release from seeing isRecordingRef as false and being silently dropped.
    isRecordingRef.current = true;
    // Cancel any stale hide/reset timers from a previous recording session
    clearPendingTimersRef.current();

    const inFocus = document.hasFocus();
    inFocusPressRef.current = inFocus;

    try {
      if (inFocus) {
        // In-app: navigate to SystemCheck and start recording in the mic test widget
        setCurrentViewRef.current("system-check");
        await startRecordingRef.current();
      } else {
        // Out-of-app: show capsule overlay
        await invoke("show_capsule");
        await invoke("emit_capsule_state", { state: "recording" });
        await invoke("play_capsule_sound", { sound: "start" });
        await startRecordingRef.current();
      }
    } catch {
      // Start failed — reset synchronous lock so next press works
      isRecordingRef.current = false;
    }
  }, []);

  const handleRelease = useCallback(async () => {
    if (!isRecordingRef.current || processingRef.current) return;
    // Immediately lock to prevent any concurrent entry
    processingRef.current = true;
    isRecordingRef.current = false;

    try {
      if (!inFocusPressRef.current) {
        await invoke("emit_capsule_state", { state: "transcribing" });
        await invoke("play_capsule_sound", { sound: "processing" });
      }
      const result = await stopRecordingRef.current();
      if (result.sample_count > 0) {
        await processAudioRef.current(result);
      }
    } finally {
      processingRef.current = false;
    }
  }, []);

  // ── Ensure fn key monitor is active (handles dev rebuilds losing accessibility) ──
  useEffect(() => {
    invoke("reinit_fn_key_monitor").catch(() => {});
  }, []);

  // ── System wake: reset stale state and reinit monitors ──
  useEffect(() => {
    const unlisten = listen("system-wake", () => {
      console.log("[wake] System wake detected — resetting state");
      processingRef.current = false;
      isRecordingRef.current = false;
      inFocusPressRef.current = false;
      resetRecording();
      invoke("force_reinit_fn_key_monitor").catch(() => {});
    });

    return () => {
      unlisten.then((fn_) => fn_());
    };
  }, []);

  // ── Watchdog recovery: auto-stop from abnormal audio callbacks ──
  const addToast = useAppStore((s) => s.addToast);
  const addToastRef = useRef(addToast);
  useEffect(() => {
    addToastRef.current = addToast;
  }, [addToast]);

  useEffect(() => {
    const unlisten = listen<string>("watchdog-recovery", (event) => {
      console.warn("[watchdog] Recovery triggered:", event.payload);
      processingRef.current = false;
      isRecordingRef.current = false;
      inFocusPressRef.current = false;
      resetRecording();
      addToastRef.current({
        type: "warning",
        message: `Recording auto-stopped: ${event.payload}`,
      });
    });

    return () => {
      unlisten.then((fn_) => fn_());
    };
  }, []);

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
          addToastRef.current({
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
