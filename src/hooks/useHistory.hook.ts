import { useEffect, useCallback } from "react";
import { load } from "@tauri-apps/plugin-store";
import { useAppStore } from "@/store/app.store";
import type { TranscriptRecord } from "@/types/transcript.types";

const STORE_PATH = "linty-history.json";

let storeInstance: Awaited<ReturnType<typeof load>> | null = null;

async function getHistoryStore() {
  if (!storeInstance) {
    storeInstance = await load(STORE_PATH, {
      defaults: { transcripts: [] },
      autoSave: true,
    });
  }
  return storeInstance;
}

export function useHistory() {
  const {
    transcripts,
    searchQuery,
    selectedTranscriptId,
    setTranscripts,
    addTranscript,
    removeTranscript,
    clearTranscripts,
    setSearchQuery,
    setSelectedTranscriptId,
  } = useAppStore();

  useEffect(() => {
    (async () => {
      const store = await getHistoryStore();
      const saved = await store.get<TranscriptRecord[]>("transcripts");
      if (saved?.length) {
        setTranscripts(saved);
      }
    })();
  }, [setTranscripts]);

  const persistTranscripts = useCallback(async (records: TranscriptRecord[]) => {
    const store = await getHistoryStore();
    await store.set("transcripts", records);
  }, []);

  const saveTranscript = useCallback(
    async (transcript: TranscriptRecord) => {
      addTranscript(transcript);
      const store = await getHistoryStore();
      const current = await store.get<TranscriptRecord[]>("transcripts");
      await store.set("transcripts", [transcript, ...(current || [])]);
    },
    [addTranscript],
  );

  const deleteTranscript = useCallback(
    async (transcriptId: string) => {
      removeTranscript(transcriptId);
      const store = await getHistoryStore();
      const current = await store.get<TranscriptRecord[]>("transcripts");
      await store.set(
        "transcripts",
        (current || []).filter((t) => t.transcriptId !== transcriptId),
      );
    },
    [removeTranscript],
  );

  const clearAll = useCallback(async () => {
    clearTranscripts();
    const store = await getHistoryStore();
    await store.set("transcripts", []);
  }, [clearTranscripts]);

  const filteredTranscripts = searchQuery
    ? transcripts.filter((t) =>
        t.finalText.toLowerCase().includes(searchQuery.toLowerCase()),
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
