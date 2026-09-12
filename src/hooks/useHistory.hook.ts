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
  const deleteTranscript = useCallback(
    (id: string) =>
      updateHistory((records) => records.filter((t) => t.transcriptId !== id)),
    [],
  );
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
