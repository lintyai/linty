import { useEffect, useCallback } from "react";
import { useAppStore } from "@/store/app.store";
import {
  initializeHistory,
  saveTranscript,
  updateHistory,
} from "@/services/history.service";
import type { TranscriptRecord } from "@/types/transcript.types";

export function useHistory() {
  const transcripts = useAppStore((s) => s.transcripts);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const selectedTranscriptId = useAppStore((s) => s.selectedTranscriptId);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const setSelectedTranscriptId = useAppStore((s) => s.setSelectedTranscriptId);
  useEffect(() => {
    initializeHistory().catch((error) =>
      console.error("Failed to load history:", error),
    );
  }, []);

  const persistTranscripts = useCallback(
    (records: TranscriptRecord[]) => updateHistory(() => records),
    [],
  );
  const deleteTranscript = useCallback(async (id: string) => {
    const record = useAppStore.getState().transcripts.find((item) => item.transcriptId === id);
    await updateHistory((records) => records.filter((t) => t.transcriptId !== id));
    if (!record) return;
    let restored = false;
    useAppStore.getState().addToast({
      type: "success", message: "Transcript deleted", action: {
        label: "Undo", onClick: async function undoTranscript() {
          if (restored) return;
          restored = true;
          try {
            await updateHistory((records) => records.some((item) => item.transcriptId === id) ? records : [...records, record].sort((a, b) => b.timestamp - a.timestamp));
            const state = useAppStore.getState();
            state.toasts.filter((toast) => toast.action?.onClick === undoTranscript).forEach((toast) => state.removeToast(toast.toastId));
            state.addToast({ type: "success", message: "Transcript restored" });
          } catch {
            restored = false;
            useAppStore.getState().addToast({ type: "error", message: "Could not restore transcript. Try Undo again." });
          }
        },
      },
    });
  }, []);
  const clearAll = useCallback(() => updateHistory(() => []), []);
  const query = searchQuery.trim().toLowerCase();
  const filteredTranscripts = query
    ? transcripts.filter((t) =>
        `${t.finalText} ${t.application?.name ?? ""} ${t.application?.bundleId ?? ""}`
          .toLowerCase()
          .includes(query),
      )
    : transcripts;

  return {
    transcripts: filteredTranscripts,
    allTranscripts: transcripts,
    searchQuery,
    selectedTranscriptId,
    setSearchQuery,
    setSelectedTranscriptId,
    saveTranscript,
    deleteTranscript,
    clearAll,
    persistTranscripts,
  };
}
