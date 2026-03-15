import type { StateCreator } from "zustand";
import type { TranscriptRecord } from "@/types/transcript.types";

export interface HistorySlice {
  transcripts: TranscriptRecord[];
  searchQuery: string;
  selectedTranscriptId: string | null;
  setTranscripts: (transcripts: TranscriptRecord[]) => void;
  addTranscript: (transcript: TranscriptRecord) => void;
  removeTranscript: (transcriptId: string) => void;
  clearTranscripts: () => void;
  setSearchQuery: (query: string) => void;
  setSelectedTranscriptId: (transcriptId: string | null) => void;
}

export const createHistorySlice: StateCreator<HistorySlice> = (set) => ({
  transcripts: [],
  searchQuery: "",
  selectedTranscriptId: null,
  setTranscripts: (transcripts) => set({ transcripts }),
  addTranscript: (transcript) =>
    set((state) => ({
      transcripts: [transcript, ...state.transcripts].slice(0, 500),
    })),
  removeTranscript: (transcriptId) =>
    set((state) => ({
      transcripts: state.transcripts.filter(
        (t) => t.transcriptId !== transcriptId,
      ),
    })),
  clearTranscripts: () => set({ transcripts: [] }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSelectedTranscriptId: (selectedTranscriptId) =>
    set({ selectedTranscriptId }),
});
