import { useEffect, useMemo } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { useAppStore } from "@/store/app.store";
import type { SttMode } from "@/store/slices/settings.slice";
import { formatTriggerLabel } from "@/lib/trigger.util";
import { TRANSCRIPTION_LANGUAGES } from "@/lib/languages.util";

export function useTraySync(
  saveSttMode: (mode: SttMode) => Promise<void>,
  saveTranscriptionLanguage: (language: string) => Promise<void>,
) {
  const status = useAppStore((s) => s.status);
  const sttMode = useAppStore((s) => s.sttMode);
  const selectedModelFilename = useAppStore((s) => s.selectedModelFilename);
  const loadedModelFilename = useAppStore((s) => s.loadedModelFilename);
  const settingsLoaded = useAppStore((s) => s.settingsLoaded);
  const triggerKey = useAppStore((s) => s.triggerKey);
  const transcriptionLanguage = useAppStore((s) => s.transcriptionLanguage);
  const setupComplete = useAppStore((s) => s.onboardingComplete);
  const cloudReady = useAppStore((s) => !!s.groqApiKey.trim());
  const localReady = !!loadedModelFilename && (!selectedModelFilename || selectedModelFilename === loadedModelFilename);
  useEffect(() => {
    const unlisten = listen<string>("audio-input-error", ({ payload }) => {
      useAppStore.getState().addToast({ type: "error", message: payload });
    });
    return () => { unlisten.then((off) => off()); };
  }, []);
  // The menu names the local engine that will actually run: the selection, else what is loaded.
  const localEngine = (selectedModelFilename ?? loadedModelFilename) === "parakeet-tdt-0.6b-v3" ? "Parakeet" : "Whisper";
  const transcripts = useAppStore((s) => s.transcripts);
  const recentTranscripts = useMemo(
    () =>
      transcripts
        .filter((transcript) => transcript.finalText.trim())
        .slice(0, 5)
        .map(({ transcriptId, finalText }) => ({ transcriptId, finalText })),
    [transcripts],
  );

  // Keep the menu in sync with new, restored, and deleted transcripts.
  useEffect(() => {
    if (!settingsLoaded) return;
    const snapshot = { status, sttMode, localEngine, recentTranscripts, localReady, cloudReady,
      setupComplete, triggerLabel: formatTriggerLabel(triggerKey),
      transcriptionLanguage, languages: TRANSCRIPTION_LANGUAGES };
    emit("tray-state-changed", snapshot).catch((err) => {
      console.error("Failed to update tray menu:", err);
    });
  }, [status, sttMode, localEngine, settingsLoaded, recentTranscripts, localReady, cloudReady, setupComplete, triggerKey, transcriptionLanguage]);

  useEffect(() => {
    const unlisten = listen<string>("tray-language-changed", async ({ payload }) => {
      let error: string | null = null;
      try {
        await saveTranscriptionLanguage(payload);
      } catch (reason) {
        error = reason instanceof Error ? reason.message : String(reason);
        useAppStore.getState().addToast({ type: "error", message: error });
      }
      // Native checkmarks toggle before saving; restore the confirmed selection on failure.
      await emit("tray-language-result", { error }).catch(() => {});
    });
    return () => { void unlisten.then((off) => off()); };
  }, [saveTranscriptionLanguage]);

  useEffect(() => {
    const unlisten = listen<string>("tray-navigate", ({ payload }) => {
      const state = useAppStore.getState();
      if (payload === "settings" || payload === "history") state.setCurrentView(payload);
      // “Open Linty” keeps the user's current page and scroll position.
    });
    return () => { unlisten.then((off) => off()); };
  }, []);

  useEffect(() => {
    const unlisten = listen<string | null>("tray-copy-result", ({ payload }) => {
      useAppStore.getState().addToast(payload
        ? { type: "error", message: payload }
        : { type: "success", message: "Copied to clipboard" });
    });
    return () => { unlisten.then((off) => off()); };
  }, []);

  // Listen for engine changes from the tray menu
  useEffect(() => {
    const unlisten = listen<string>("tray-engine-changed", async (event) => {
      const mode = event.payload as SttMode;
      if (mode === "cloud" || mode === "local") {
        let error: string | null = null;
        try {
          const state = useAppStore.getState();
          if (state.isRecording || ["transcribing", "correcting", "pasting"].includes(state.status)) {
            throw new Error("Finish dictating before changing engines.");
          }
          await saveSttMode(mode);
        } catch (reason) {
          error = reason instanceof Error ? reason.message : String(reason);
          useAppStore.getState().addToast({ type: "error", message: error });
        }
        await emit("tray-engine-result", { error });
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [saveSttMode]);
}
