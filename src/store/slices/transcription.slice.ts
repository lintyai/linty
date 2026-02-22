import type { StateCreator } from "zustand";

export type TranscriptionStatus =
  | "idle"
  | "recording"
  | "transcribing"
  | "correcting"
  | "pasting"
  | "done"
  | "error";

export interface TranscriptionSlice {
  status: TranscriptionStatus;
  rawTranscript: string;
  correctedTranscript: string;
  finalText: string;
  error: string | null;
  audioSamples: number[];
  setStatus: (status: TranscriptionStatus) => void;
  setRawTranscript: (text: string) => void;
  setCorrectedTranscript: (text: string) => void;
  setFinalText: (text: string) => void;
  setError: (error: string | null) => void;
  setAudioSamples: (samples: number[]) => void;
  resetTranscription: () => void;
}

export const createTranscriptionSlice: StateCreator<TranscriptionSlice> = (
  set,
) => ({
  status: "idle",
  rawTranscript: "",
  correctedTranscript: "",
  finalText: "",
  error: null,
  audioSamples: [],
  setStatus: (status) => set({ status }),
  setRawTranscript: (rawTranscript) => set({ rawTranscript }),
  setCorrectedTranscript: (correctedTranscript) => set({ correctedTranscript }),
  setFinalText: (finalText) => set({ finalText }),
  setError: (error) => set({ error, status: error ? "error" : "idle" }),
  setAudioSamples: (audioSamples) => set({ audioSamples }),
  resetTranscription: () =>
    set({
      status: "idle",
      rawTranscript: "",
      correctedTranscript: "",
      finalText: "",
      error: null,
      audioSamples: [],
    }),
});
