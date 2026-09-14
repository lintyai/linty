import type { StateCreator } from "zustand";

export type AppView = "history" | "apps" | "dictionary" | "settings" | "dashboard" | "system-check" | "shortcuts" | "about";
export type SettingsSection = "general" | "audio" | "models" | "language" | "appearance" | "privacy";

export const SETTINGS_SECTIONS: { id: SettingsSection; label: string; description: string }[] = [
  { id: "general", label: "Dictation", description: "Choose how your words are refined and delivered." },
  { id: "audio", label: "Audio", description: "Your microphone and recording quality." },
  { id: "models", label: "Speech engine", description: "Choose where and how your speech is transcribed." },
  { id: "language", label: "Language", description: "Set the language you dictate in." },
  { id: "appearance", label: "Appearance", description: "Make Linty feel at home on your Mac." },
  { id: "privacy", label: "Privacy & storage", description: "Understand and control what Linty saves." },
];

export interface NavigationSlice {
  currentView: AppView;
  settingsSection: SettingsSection;
  sidebarVisible: boolean;
  setCurrentView: (view: AppView) => void;
  setSettingsSection: (section: SettingsSection) => void;
  toggleSidebar: () => void;
}

export const createNavigationSlice: StateCreator<NavigationSlice> = (set) => ({
  currentView: "dashboard",
  settingsSection: "general",
  sidebarVisible: true,
  setCurrentView: (currentView) => set({ currentView }),
  setSettingsSection: (settingsSection) => set({ settingsSection, currentView: "settings" }),
  toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
});
