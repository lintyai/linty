import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { saveTranscript } from "@/services/history.service";
import { useAppStore } from "@/store/app.store";
import { correctText } from "@/services/correction.service";
import type { TranscriptRecord } from "@/types/transcript.types";
import type { StopResult } from "./useRecording.hook";
import { modelLabel } from "@/lib/model-labels.util";
import { applyDictionary, engineTerms, promptWithDictionary } from "@/lib/dictionary.util";
import { currentDictation, ownsDictation, finishEmptyDictation, GROQ_SETUP_ERROR, recoverDictation } from "@/services/dictation-recovery.service";
import { transcriptionTimeoutMs } from "@/lib/dictation-session";
import { noteDictionaryUse } from "@/services/dictionary.service";
import { initialReformatMetrics, reformatApplied, reformatOptions } from "@/lib/reformat.util";
import type { ReformatResult } from "@/types/reformat.types";


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
    reformatEnabled,
    reformatStyle,
    reformatLists,
    reformatContext,
    whisperPrompt,
    correctionPrompt,
    transcriptionLanguage,
    loadedModelFilename,
    dictionaryEnabled,
    dictionaryEntries,
    observeCorrections,
    setStatus,
    setRawTranscript,
    setCorrectedTranscript,
    setFinalText,
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

      const session = currentDictation();
      if (session.cancelled) return;
      if (!result.sample_count) { finishEmptyDictation(session); return; }
      const run = <T,>(operation: () => Promise<T>, timeout = 5000, message = "Linty took too long to respond. Please try again.") =>
        session.run(operation, timeout, message);
      const recordingDuration = result.duration_secs;
      processingStartRef.current = Date.now();
      const effectiveMode = sttMode;
      let clipboardDirty = false;
      try {
        if (effectiveMode === "local" && !(await run(() => invoke<boolean>("is_local_stt_available")))) {
          throw new Error("Local transcription is unavailable in this build.");
        }
        if (effectiveMode === "cloud" && !groqApiKey.trim()) throw new Error(GROQ_SETUP_ERROR);

        // Step 1: Transcribe (samples stay in Rust — no IPC transfer)
        setStatus("transcribing");
        emitCapsule("transcribing");
        let transcript: string;
        // Dictionary words the engine itself corrected (Parakeet vocabulary).
        let engineApplied: { from: string; to: string }[] = [];

        const langParam = transcriptionLanguage === "auto" ? null : transcriptionLanguage;
        // The vocabulary prompt: what the person typed, then the dictionary's
        // most-used words as spelling hints (Whisper and Groq honour it).
        const enginePrompt = dictionaryEnabled
          ? promptWithDictionary(whisperPrompt, dictionaryEntries)
          : whisperPrompt;
        // Parakeet has no prompt: it gets the most-used dictionary words (with the
        // spellings they were heard as) as keyword-spotter terms instead.
        const vocabulary = dictionaryEnabled
          ? engineTerms(dictionaryEntries).map((e) => ({ text: e.right, aliases: e.wrong }))
          : [];

        const sttStart = Date.now();
        if (effectiveMode === "local") {
          // No cloud fallback — the user chose local; surface errors instead
          // of silently sending audio to the cloud.
          const output = await run(() => invoke<{ text: string; vocabularyApplied: { from: string; to: string }[] }>("transcribe_buffer", {
            prompt: enginePrompt || null,
            language: langParam,
            vocabulary: vocabulary.length ? vocabulary : null,
          }), transcriptionTimeoutMs(recordingDuration), "Transcription timed out. Please try again.");
          transcript = output.text;
          engineApplied = output.vocabularyApplied ?? [];
        } else {
          transcript = await run(() => invoke<string>("transcribe_buffer_cloud", {
            apiKey: groqApiKey,
            prompt: enginePrompt || null,
            language: langParam,
          }), transcriptionTimeoutMs(recordingDuration), "Transcription timed out. Please try again.");
        }
        const sttTimeMs = Date.now() - sttStart;

        if (!transcript.trim() || transcript.trim() === "[BLANK_AUDIO]") {
          resetTranscription();
          emitCapsule("idle");
          invoke("hide_capsule").catch(() => {});
          addToast({ type: "warning", message: "No transcript returned — try again or check your microphone" });
          return;
        }

        setRawTranscript(transcript);

        // Step 2: local reformatting takes precedence over cloud correction.
        let finalResult = transcript;
        let correctionTimeMs = 0;
        let reformatTimeMs = 0;
        let reformattedText: string | undefined;
        const options = reformatOptions(reformatStyle, reformatLists, reformatContext, result.application?.bundleId);
        let reformatting = initialReformatMetrics(transcript, reformatEnabled, transcriptionLanguage, options);
        let cloudRefinementStatus: NonNullable<TranscriptRecord["cloudRefinementStatus"]> = reformatEnabled ? "superseded-by-s1" : "disabled";
        if (reformatEnabled) {
          setStatus("correcting");
          emitCapsule("correcting");
          const started = performance.now();
          try {
            const output = await run(() => invoke<ReformatResult>("reformat_transcript", {
              text: transcript, language: transcriptionLanguage, options,
            }), 150_000, "Local reformatting timed out.");
            reformatting = { ...output.metrics, enabled: true };
            if (reformatApplied(reformatting)) {
              reformattedText = output.text;
              finalResult = output.text;
              setCorrectedTranscript(output.text);
            } else if (reformatting.status === "fallback") {
              addToast({ type: "warning", message: "S1-mini could not reformat this dictation. Your original text was kept." });
            }
          } catch {
            void invoke("cancel_reformatting").catch(() => {});
            if (session.cancelled) return;
            reformatting.reason = "native_request_failed_or_timed_out";
            addToast({ type: "warning", message: "S1-mini did not respond. Your original text was kept." });
          } finally {
            reformatTimeMs = performance.now() - started;
            reformatting.roundTripMs = reformatTimeMs;
          }
        } else if (correctionEnabled && groqApiKey && effectiveMode === "cloud") {
          setStatus("correcting");
          emitCapsule("correcting");
          const correctionStart = Date.now();
          try {
            const corrected = await run(() => correctText(transcript, groqApiKey, correctionPrompt || undefined), 20_000, "Text refinement timed out.");
            setCorrectedTranscript(corrected);
            finalResult = corrected;
            cloudRefinementStatus = corrected === transcript ? "unchanged" : "applied";
            correctionTimeMs = Date.now() - correctionStart;
          } catch {
            if (session.cancelled) return;
            correctionTimeMs = Date.now() - correctionStart;
            finalResult = transcript;
            cloudRefinementStatus = "fallback";
          }
        }

        // Step 2b: personal dictionary — whole-word fixes for words the engine still misses.
        // Engine-side fixes count too, so "Applied" reflects every time a word helped.
        const dictionaryApplied: { from: string; to: string }[] = engineApplied.map(({ from, to }) => ({ from, to }));
        const recognizedIds = engineApplied
          .map((a) => dictionaryEntries.find((e) => e.right === a.to)?.entryId)
          .filter((id): id is string => Boolean(id));
        const correctedIds: string[] = [];
        if (dictionaryEnabled && dictionaryEntries.length) {
          const applied = applyDictionary(finalResult, dictionaryEntries);
          if (applied.applied.length) {
            finalResult = applied.text;
            dictionaryApplied.push(...applied.applied.map(({ from, to }) => ({ from, to })));
            correctedIds.push(...applied.applied.map((a) => a.entryId));
          }
        }
        if (recognizedIds.length || correctedIds.length) {
          noteDictionaryUse({ recognized: recognizedIds, corrected: correctedIds }).catch((err) => {
            console.error("Failed to record dictionary use:", err);
          });
        }

        setFinalText(finalResult);

        // Step 3: Paste into focused app
        setStatus("pasting");
        emitCapsule("pasting");
        const pasteStart = Date.now();

        const transcriptId = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        let deliveryStatus: "pasted" | "failed" = "pasted";
        try {
          // Save the transcript even if preparing the clipboard fails.
          await run(() => invoke("snapshot_clipboard"));
          clipboardDirty = true;
          await run(() => invoke("write_transient_text", { text: finalResult }));
          // observe: let the Rust side watch the target field for fixes to this paste.
          await run(() => invoke("paste_text", { observe: observeCorrections, transcriptId }));
          clipboardDirty = false;
        } catch (pasteErr) {
          deliveryStatus = "failed";
          if (session.cancelled) return;
          void invoke("restore_clipboard").catch(() => {});
          clipboardDirty = false;
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
          transcriptId,
          rawText: transcript,
          finalText: finalResult,
          reformattedText,
          pastedText: deliveryStatus === "pasted" ? finalResult : undefined,
          reformatting,
          reformatTimeMs,
          transcriptionLanguage,
          speechModelId: effectiveMode === "cloud" ? "whisper-large-v3-turbo" : loadedModelFilename ?? undefined,
          audioSampleCount: result.sample_count,
          deliveryStatus,
          cloudRefinementStatus,
          originalWordCount: transcript.split(/\s+/).filter(Boolean).length,
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
          corrected: finalResult !== transcript,
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
          if (!ownsDictation(session) || session.cancelled) return;
          invoke("hide_capsule").catch(() => {});
        }, 5000);

        // Reset after showing result
        resetTimerRef.current = setTimeout(() => {
          if (!ownsDictation(session) || session.cancelled) return;
          resetTranscription();
        }, 3000);
      } catch (err) {
        if (session.cancelled || !ownsDictation(session)) return;
        if (clipboardDirty) void invoke("restore_clipboard").catch(() => {});
        const rawMsg = err instanceof Error ? err.message : String(err);
        const errMsg = rawMsg.includes("not loaded")
          ? "Download a local model in Settings → Speech engine."
          : rawMsg;
        await recoverDictation(errMsg, session);
      }
    },
    [
      groqApiKey,
      sttMode,
      correctionEnabled,
      reformatEnabled,
      reformatStyle,
      reformatLists,
      reformatContext,
      whisperPrompt,
      correctionPrompt,
      transcriptionLanguage,
      loadedModelFilename,
      dictionaryEnabled,
      dictionaryEntries,
      observeCorrections,
      clearPendingTimers,
      setStatus,
      setRawTranscript,
      setCorrectedTranscript,
      setFinalText,
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
