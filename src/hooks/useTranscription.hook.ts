import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { useAppStore } from "@/store/app.store";
import { correctText } from "@/services/correction.service";
import type { TranscriptRecord } from "@/types/transcript.types";

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
    setStatus,
    setRawTranscript,
    setCorrectedTranscript,
    setFinalText,
    setError,
    resetTranscription,
    addTranscript,
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
    async (samples: number[]) => {
      // Cancel any pending hide/reset from a previous session
      clearPendingTimers();

      if (!samples.length) {
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
          : samples.length / 16000;

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

      try {
        // Step 1: Transcribe
        setStatus("transcribing");
        emitCapsule("transcribing");
        let transcript: string;

        const langParam = transcriptionLanguage === "auto" ? null : transcriptionLanguage;

        const sttStart = Date.now();
        if (effectiveMode === "local") {
          try {
            transcript = await invoke<string>("transcribe_local_audio", {
              samples,
              prompt: whisperPrompt || null,
              language: langParam,
              translate: translateToEnglish,
            });
          } catch (localErr) {
            const errMsg = String(localErr);
            if (errMsg.includes("not loaded") && groqApiKey) {
              transcript = await invoke<string>("transcribe_audio", {
                samples,
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
          transcript = await invoke<string>("transcribe_audio", {
            samples,
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
        await invoke("write_transient_text", { text: finalResult });

        try {
          await invoke("paste_text");
        } catch (pasteErr) {
          console.warn("Paste failed (accessibility?):", pasteErr);
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
            effectiveMode === "cloud" ? "whisper-large-v3" : "whisper.cpp",
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
            await store.set("transcripts", [record, ...current]);
          } catch (err) {
            console.error("Failed to persist transcript:", err);
          }
        })();

        setStatus("done");
        emitCapsule("done");
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
      clearPendingTimers,
      setStatus,
      setRawTranscript,
      setCorrectedTranscript,
      setFinalText,
      setError,
      resetTranscription,
      addTranscript,
    ],
  );

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
