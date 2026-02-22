import type { StateCreator } from "zustand";

export type SttMode = "cloud" | "local";
export type ThemePreference = "light" | "dark" | "system";

export interface SettingsSlice {
  groqApiKey: string;
  sttMode: SttMode;
  correctionEnabled: boolean;
  localModelPath: string | null;
  isLocalModelDownloaded: boolean;
  theme: ThemePreference;
  whisperPrompt: string;
  correctionPrompt: string;
  onboardingComplete: boolean;
  transcriptionLanguage: string;
  translateToEnglish: boolean;
  setGroqApiKey: (key: string) => void;
  setSttMode: (mode: SttMode) => void;
  setCorrectionEnabled: (enabled: boolean) => void;
  setLocalModelPath: (path: string | null) => void;
  setIsLocalModelDownloaded: (downloaded: boolean) => void;
  setTheme: (theme: ThemePreference) => void;
  setWhisperPrompt: (prompt: string) => void;
  setCorrectionPrompt: (prompt: string) => void;
  setOnboardingComplete: (complete: boolean) => void;
  setTranscriptionLanguage: (language: string) => void;
  setTranslateToEnglish: (translate: boolean) => void;
}

export const createSettingsSlice: StateCreator<SettingsSlice> = (set) => ({
  groqApiKey: "",
  sttMode: "cloud",
  correctionEnabled: true,
  localModelPath: null,
  isLocalModelDownloaded: false,
  theme: "system",
  whisperPrompt: "",
  correctionPrompt: "",
  onboardingComplete: false,
  transcriptionLanguage: "auto",
  translateToEnglish: false,
  setGroqApiKey: (groqApiKey) => set({ groqApiKey }),
  setSttMode: (sttMode) => set({ sttMode }),
  setCorrectionEnabled: (correctionEnabled) => set({ correctionEnabled }),
  setLocalModelPath: (localModelPath) => set({ localModelPath }),
  setIsLocalModelDownloaded: (isLocalModelDownloaded) =>
    set({ isLocalModelDownloaded }),
  setTheme: (theme) => set({ theme }),
  setWhisperPrompt: (whisperPrompt) => set({ whisperPrompt }),
  setCorrectionPrompt: (correctionPrompt) => set({ correctionPrompt }),
  setOnboardingComplete: (onboardingComplete) => set({ onboardingComplete }),
  setTranscriptionLanguage: (transcriptionLanguage) => set({ transcriptionLanguage }),
  setTranslateToEnglish: (translateToEnglish) => set({ translateToEnglish }),
});
