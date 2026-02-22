import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
import { useAppStore } from "@/store/app.store";
import { correctText } from "@/services/correction.service";

export function useTranscription() {
  const {
    status,
    rawTranscript,
    correctedTranscript,
    finalText,
    error,
    groqApiKey,
    correctionEnabled,
    setStatus,
    setRawTranscript,
    setCorrectedTranscript,
    setFinalText,
    setError,
    resetTranscription,
  } = useAppStore();

  const processAudio = useCallback(
    async (samples: number[]) => {
      if (!samples.length) {
        setError("No audio recorded");
        return;
      }

      if (!groqApiKey) {
        setError("Groq API key not set. Open settings to configure.");
        return;
      }

      try {
        // Step 1: Transcribe
        setStatus("transcribing");
        const transcript = await invoke<string>("transcribe_audio", {
          samples,
          apiKey: groqApiKey,
        });

        if (!transcript.trim()) {
          setError("No speech detected");
          return;
        }

        setRawTranscript(transcript);

        // Step 2: LLM correction (optional)
        let finalResult = transcript;
        if (correctionEnabled) {
          setStatus("correcting");
          try {
            const corrected = await correctText(transcript, groqApiKey);
            setCorrectedTranscript(corrected);
            finalResult = corrected;
          } catch {
            // Correction failed — use raw transcript
            finalResult = transcript;
          }
        }

        setFinalText(finalResult);

        // Step 3: Paste into focused app
        setStatus("pasting");
        const originalClipboard = await readText().catch(() => "");
        await writeText(finalResult);

        try {
          await invoke("paste_text");
        } catch (pasteErr) {
          console.warn("Paste failed (accessibility?):", pasteErr);
        }

        // Restore original clipboard after a short delay
        setTimeout(async () => {
          if (originalClipboard) {
            await writeText(originalClipboard).catch(() => {});
          }
        }, 500);

        setStatus("done");

        // Reset after showing result briefly
        setTimeout(() => {
          resetTranscription();
        }, 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [
      groqApiKey,
      correctionEnabled,
      setStatus,
      setRawTranscript,
      setCorrectedTranscript,
      setFinalText,
      setError,
      resetTranscription,
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
  };
}
