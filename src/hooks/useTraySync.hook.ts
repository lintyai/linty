import { useEffect, useMemo } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useAppStore } from "@/store/app.store";
import type { SttMode } from "@/store/slices/settings.slice";

export function useTraySync(saveSttMode: (mode: SttMode) => Promise<void>) {
  const status = useAppStore((s) => s.status);
  const sttMode = useAppStore((s) => s.sttMode);
  const settingsLoaded = useAppStore((s) => s.settingsLoaded);
  const transcripts = useAppStore((s) => s.transcripts);
  const recentTranscripts = useMemo(
    () =>
      transcripts
        .filter((transcript) => transcript.finalText.trim())
        .slice(0, 10)
        .map(({ transcriptId, finalText }) => ({ transcriptId, finalText })),
    [transcripts],
  );

  // Keep the menu in sync with new, restored, and deleted transcripts.
  useEffect(() => {
    if (!settingsLoaded) return;
    emit("tray-state-changed", { status, sttMode, recentTranscripts }).catch((err) => {
      console.error("Failed to update tray menu:", err);
    });
  }, [status, sttMode, settingsLoaded, recentTranscripts]);

  useEffect(() => {
    const unlisten = listen<string>("tray-copy-transcript", async (event) => {
      // Resolve by ID so a history update cannot make a menu item copy another message.
      const { transcripts, addToast } = useAppStore.getState();
      const transcript = transcripts.find((t) => t.transcriptId === event.payload);
      if (!transcript) return;

      try {
        await writeText(transcript.finalText);
        addToast({ type: "success", message: "Copied to clipboard" });
      } catch (err) {
        console.error("Failed to copy transcript from tray:", err);
        addToast({ type: "error", message: "Could not copy transcript to clipboard" });
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for engine changes from the tray menu
  useEffect(() => {
    const unlisten = listen<string>("tray-engine-changed", (event) => {
      const mode = event.payload as SttMode;
      if (mode === "cloud" || mode === "local") {
        saveSttMode(mode);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [saveSttMode]);
}
