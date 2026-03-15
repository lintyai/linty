import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { useAppStore } from "@/store/app.store";
import { correctText } from "@/services/correction.service";
import type { TranscriptRecord } from "@/types/transcript.types";
import type { StopResult } from "./useRecording.hook";

const MODEL_LABELS: Record<string, string> = {
  "ggml-small.bin": "Small",
  "ggml-medium.bin": "Medium",
  "ggml-large-v3-turbo-q5_0.bin": "Large Turbo Q5",
  "ggml-large-v3-turbo.bin": "Large Turbo",
  "ggml-large-v3.bin": "Large V3",
};

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
    translateToEnglish,
    loadedModelFilename,
    setStatus,
    setRawTranscript,
    setCorrectedTranscript,
    setFinalText,
    setError,
    resetTranscription,
    addTranscript,
    addToast,
  } = useAppStore();

  const recordingStartRef = useRef<number>(0);
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

  const setRecordingStart = useCallback((ts: number) => {
    recordingStartRef.current = ts;
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

      const recordingDuration =
        recordingStartRef.current > 0
          ? (Date.now() - recordingStartRef.current) / 1000
          : result.duration_secs;

      processingStartRef.current = Date.now();

      // Determine effective STT mode
      let effectiveMode = sttMode;
      if (sttMode === "local") {
        try {
          const localAvailable = await invoke<boolean>("is_local_stt_available");
          if (!localAvailable) {
            effectiveMode = "cloud";
          }
        } catch {
          effectiveMode = "cloud";
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

        const sttStart = Date.now();
        if (effectiveMode === "local") {
          try {
            transcript = await invoke<string>("transcribe_buffer", {
              prompt: whisperPrompt || null,
              language: langParam,
              translate: translateToEnglish,
            });
          } catch (localErr) {
            const errMsg = String(localErr);
            if (errMsg.includes("not loaded") && groqApiKey) {
              transcript = await invoke<string>("transcribe_buffer_cloud", {
                apiKey: groqApiKey,
                prompt: whisperPrompt || null,
                language: langParam,
                translate: translateToEnglish,
              });
              effectiveMode = "cloud";
            } else {
              throw localErr;
            }
          }
        } else {
          transcript = await invoke<string>("transcribe_buffer_cloud", {
            apiKey: groqApiKey,
            prompt: whisperPrompt || null,
            language: langParam,
            translate: translateToEnglish,
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

        // Clipboard restore happens automatically in Rust via NSPasteboardItemDataProvider
        // callback — fires when the target app reads the pasted data (~50ms after paste)

        const processingTimeMs = Date.now() - processingStartRef.current;

        // Save to history
        const record: TranscriptRecord = {
          transcriptId: `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          rawText: transcript,
          finalText: finalResult,
          engine: effectiveMode,
          modelName:
            effectiveMode === "cloud"
              ? "Groq Whisper Large V3"
              : (loadedModelFilename && MODEL_LABELS[loadedModelFilename]) || "Local",
          durationSeconds: recordingDuration,
          processingTimeMs,
          sttTimeMs,
          correctionTimeMs: correctionTimeMs || undefined,
          pasteTimeMs,
          wordCount: finalResult.split(/\s+/).filter(Boolean).length,
          timestamp: Date.now(),
          corrected: correctionEnabled && groqApiKey !== "",
        };
        addTranscript(record);

        // Persist to store
        (async () => {
          try {
            const store = await load("linty-history.json", {
              defaults: { transcripts: [] },
              autoSave: true,
            });
            const current =
              (await store.get<TranscriptRecord[]>("transcripts")) || [];
            await store.set("transcripts", [record, ...current].slice(0, 500));
          } catch (err) {
            console.error("Failed to persist transcript:", err);
          }
        })();

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
        const errMsg = err instanceof Error ? err.message : String(err);
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
      translateToEnglish,
      loadedModelFilename,
      clearPendingTimers,
      setStatus,
      setRawTranscript,
      setCorrectedTranscript,
      setFinalText,
      setError,
      resetTranscription,
      addTranscript,
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
    setRecordingStart,
    clearPendingTimers,
  };
}
