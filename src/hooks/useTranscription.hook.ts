import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { saveTranscript } from "@/services/history.service";
import { useAppStore } from "@/store/app.store";
import { correctText } from "@/services/correction.service";
import type { TranscriptRecord } from "@/types/transcript.types";
import type { StopResult } from "./useRecording.hook";
import { modelLabel } from "@/lib/model-labels.util";
import { applyDictionary, promptWithDictionary } from "@/lib/dictionary.util";
import { noteDictionaryApplied } from "@/services/dictionary.service";


function emitCapsule(state: string, text?: string, error?: string) {
  invoke("emit_capsule_state", { state, text: text ?? null, error: error ?? null }).catch(() => {});
}

export function useTranscription() {
  const {
    status,
    rawTranscript,
    correctedTranscript,
    finalText,
    error,
    groqApiKey,
    sttMode,
    correctionEnabled,
    whisperPrompt,
    correctionPrompt,
    transcriptionLanguage,
    loadedModelFilename,
    dictionaryEnabled,
    dictionaryEntries,
    setStatus,
    setRawTranscript,
    setCorrectedTranscript,
    setFinalText,
    setError,
    resetTranscription,
    addToast,
  } = useAppStore();

  const processingStartRef = useRef<number>(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingTimers = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  const processAudio = useCallback(
    async (result: StopResult) => {
      // Cancel any pending hide/reset from a previous session
      clearPendingTimers();

      if (!result.sample_count) {
        setError("No audio recorded");
        emitCapsule("error", undefined, "No audio recorded");
        invoke("play_capsule_sound", { sound: "error" }).catch(() => {});
        setTimeout(() => {
          invoke("hide_capsule").catch(() => {});
        }, 3000);
        return;
      }

      // Captured audio is authoritative; wall time includes device/IPC delays.
      const recordingDuration = result.duration_secs;

      processingStartRef.current = Date.now();

      // Always honor the user's chosen engine — never silently switch modes.
      const effectiveMode = sttMode;
      if (effectiveMode === "local") {
        let localAvailable = false;
        try {
          localAvailable = await invoke<boolean>("is_local_stt_available");
        } catch {
          localAvailable = false;
        }
        if (!localAvailable) {
          const msg = "Local transcription isn't available in this build. Switch engine to Cloud in Settings.";
          setError(msg);
          emitCapsule("error", undefined, msg);
          invoke("play_capsule_sound", { sound: "error" }).catch(() => {});
          hideTimerRef.current = setTimeout(() => {
            invoke("hide_capsule").catch(() => {});
          }, 5000);
          return;
        }
      }

      if (effectiveMode === "cloud" && !groqApiKey) {
        setError("Groq API key not set. Open Settings to configure.");
        return;
      }

      let clipboardDirty = false;
      try {
        // Step 1: Transcribe (samples stay in Rust — no IPC transfer)
        setStatus("transcribing");
        emitCapsule("transcribing");
        let transcript: string;

        const langParam = transcriptionLanguage === "auto" ? null : transcriptionLanguage;
        // The vocabulary prompt: what the person typed, then the dictionary's
        // most-used words as spelling hints (Whisper and Groq honour it).
        const enginePrompt = dictionaryEnabled
          ? promptWithDictionary(whisperPrompt, dictionaryEntries)
          : whisperPrompt;

        const sttStart = Date.now();
        if (effectiveMode === "local") {
          // No cloud fallback — the user chose local; surface errors instead
          // of silently sending audio to the cloud.
          transcript = await invoke<string>("transcribe_buffer", {
            prompt: enginePrompt || null,
            language: langParam,
          });
        } else {
          transcript = await invoke<string>("transcribe_buffer_cloud", {
            apiKey: groqApiKey,
            prompt: enginePrompt || null,
            language: langParam,
          });
        }
        const sttTimeMs = Date.now() - sttStart;

        if (!transcript.trim() || transcript.trim() === "[BLANK_AUDIO]") {
          resetTranscription();
          emitCapsule("idle");
          invoke("hide_capsule").catch(() => {});
          addToast({ type: "warning", message: "No speech detected — try speaking louder or closer to the mic" });
          return;
        }

        setRawTranscript(transcript);

        // Step 2: LLM correction (cloud mode only)
        let finalResult = transcript;
        let correctionTimeMs = 0;
        if (correctionEnabled && groqApiKey && effectiveMode === "cloud") {
          setStatus("correcting");
          emitCapsule("correcting");
          const correctionStart = Date.now();
          try {
            const corrected = await correctText(transcript, groqApiKey, correctionPrompt || undefined);
            setCorrectedTranscript(corrected);
            finalResult = corrected;
            correctionTimeMs = Date.now() - correctionStart;
          } catch {
            correctionTimeMs = Date.now() - correctionStart;
            finalResult = transcript;
          }
        }

        // Step 2b: personal dictionary — whole-word fixes for words the engine still misses
        let dictionaryApplied: { from: string; to: string }[] = [];
        if (dictionaryEnabled && dictionaryEntries.length) {
          const applied = applyDictionary(finalResult, dictionaryEntries);
          if (applied.applied.length) {
            finalResult = applied.text;
            dictionaryApplied = applied.applied.map(({ from, to }) => ({ from, to }));
            noteDictionaryApplied(applied.applied.map((a) => a.entryId)).catch((err) => {
              console.error("Failed to record dictionary use:", err);
            });
          }
        }

        setFinalText(finalResult);

        // Step 3: Paste into focused app
        setStatus("pasting");
        emitCapsule("pasting");
        const pasteStart = Date.now();

        // Snapshot ALL clipboard content (images, files, RTF, etc.) via NSPasteboard
        await invoke("snapshot_clipboard");
        clipboardDirty = true;
        await invoke("write_transient_text", { text: finalResult });

        try {
          await invoke("paste_text");
        } catch (pasteErr) {
          console.warn("Paste failed (accessibility?):", pasteErr);
          addToast({
            type: "error",
            message: "Paste failed — check Accessibility permission in System Settings",
          });
        }
        const pasteTimeMs = Date.now() - pasteStart;

        // Clipboard restore is scheduled in Rust ~800ms after the Cmd+V keystroke —
        // time-based rather than read-based, so clipboard managers reading the
        // pasteboard can't trigger an early restore that beats the target app's read

        const processingTimeMs = Date.now() - processingStartRef.current;

        // Save to history
        const record: TranscriptRecord = {
          transcriptId: `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          rawText: transcript,
          finalText: finalResult,
          engine: effectiveMode,
          modelName:
            effectiveMode === "cloud"
              ? "Groq Whisper Large V3 Turbo"
              : modelLabel(loadedModelFilename),
          durationSeconds: recordingDuration,
          processingTimeMs,
          sttTimeMs,
          correctionTimeMs: correctionTimeMs || undefined,
          pasteTimeMs,
          wordCount: finalResult.split(/\s+/).filter(Boolean).length,
          timestamp: Date.now(),
          corrected: correctionEnabled && groqApiKey !== "",
          application: result.application ?? null,
          dictionaryApplied: dictionaryApplied.length ? dictionaryApplied : undefined,
        };
        saveTranscript(record).catch((err) => {
          console.error("Failed to persist transcript:", err);
          addToast({ type: "error", message: "Text transcribed, but history could not be saved on this Mac." });
        });

        setStatus("done");
        emitCapsule("done", finalResult);
        invoke("play_capsule_sound", { sound: "success" }).catch(() => {});
        // Safety fallback — CapsulePanel handles primary hide via dismiss callback
        hideTimerRef.current = setTimeout(() => {
          invoke("hide_capsule").catch(() => {});
        }, 5000);

        // Reset after showing result
        resetTimerRef.current = setTimeout(() => {
          resetTranscription();
        }, 3000);
      } catch (err) {
        // Restore clipboard if we snapshotted but failed before paste completed
        if (clipboardDirty) {
          invoke("restore_clipboard").catch(() => {});
        }
        const rawMsg = err instanceof Error ? err.message : String(err);
        const errMsg = rawMsg.includes("not loaded")
          ? "No local model loaded — download a model in Settings, or switch engine to Cloud."
          : rawMsg;
        setError(errMsg);
        emitCapsule("error", undefined, errMsg);
        invoke("play_capsule_sound", { sound: "error" }).catch(() => {});
        // Safety fallback — CapsulePanel handles primary hide via dismiss callback
        hideTimerRef.current = setTimeout(() => {
          invoke("hide_capsule").catch(() => {});
        }, 10000);
      }
    },
    [
      groqApiKey,
      sttMode,
      correctionEnabled,
      whisperPrompt,
      correctionPrompt,
      transcriptionLanguage,
      loadedModelFilename,
      dictionaryEnabled,
      dictionaryEntries,
      clearPendingTimers,
      setStatus,
      setRawTranscript,
      setCorrectedTranscript,
      setFinalText,
      setError,
      resetTranscription,
      addToast,
    ],
  );

  // Clear pending timers on unmount to prevent firing against stale state
  useEffect(() => {
    return () => clearPendingTimers();
  }, [clearPendingTimers]);

  return {
    status,
    rawTranscript,
    correctedTranscript,
    finalText,
    error,
    processAudio,
    resetTranscription,
    clearPendingTimers,
  };
}
