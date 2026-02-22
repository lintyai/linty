import type { StateCreator } from "zustand";

export type SttMode = "cloud" | "local";

export interface SettingsSlice {
  groqApiKey: string;
  sttMode: SttMode;
  correctionEnabled: boolean;
  localModelPath: string | null;
  isLocalModelDownloaded: boolean;
  setGroqApiKey: (key: string) => void;
  setSttMode: (mode: SttMode) => void;
  setCorrectionEnabled: (enabled: boolean) => void;
  setLocalModelPath: (path: string | null) => void;
  setIsLocalModelDownloaded: (downloaded: boolean) => void;
}

export const createSettingsSlice: StateCreator<SettingsSlice> = (set) => ({
  groqApiKey: "",
  sttMode: "cloud",
  correctionEnabled: true,
  localModelPath: null,
  isLocalModelDownloaded: false,
  setGroqApiKey: (groqApiKey) => set({ groqApiKey }),
  setSttMode: (sttMode) => set({ sttMode }),
  setCorrectionEnabled: (correctionEnabled) => set({ correctionEnabled }),
  setLocalModelPath: (localModelPath) => set({ localModelPath }),
  setIsLocalModelDownloaded: (isLocalModelDownloaded) =>
    set({ isLocalModelDownloaded }),
});
