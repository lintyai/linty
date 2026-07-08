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
  loadedModelFilename: string | null;
  selectedModelFilename: string | null;
  /** Minutes of inactivity before the local model is unloaded (0 = never). */
  modelIdleUnloadMinutes: number;
  settingsLoaded: boolean;
  setLoadedModelFilename: (filename: string | null) => void;
  setSelectedModelFilename: (filename: string | null) => void;
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
  setModelIdleUnloadMinutes: (minutes: number) => void;
  setSettingsLoaded: (loaded: boolean) => void;
}

export const DEFAULT_MODEL_IDLE_UNLOAD_MINUTES = 15;

export const createSettingsSlice: StateCreator<SettingsSlice> = (set) => ({
  groqApiKey: "",
  sttMode: "local",
  correctionEnabled: true,
  localModelPath: null,
  isLocalModelDownloaded: false,
  theme: "system",
  whisperPrompt: "",
  correctionPrompt: "",
  onboardingComplete: false,
  transcriptionLanguage: "auto",
  translateToEnglish: false,
  loadedModelFilename: null,
  selectedModelFilename: null,
  modelIdleUnloadMinutes: DEFAULT_MODEL_IDLE_UNLOAD_MINUTES,
  settingsLoaded: false,
  setLoadedModelFilename: (loadedModelFilename) => set({ loadedModelFilename }),
  setSelectedModelFilename: (selectedModelFilename) => set({ selectedModelFilename }),
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
  setModelIdleUnloadMinutes: (modelIdleUnloadMinutes) => set({ modelIdleUnloadMinutes }),
  setSettingsLoaded: (settingsLoaded) => set({ settingsLoaded }),
});
