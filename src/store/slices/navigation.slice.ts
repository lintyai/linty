import type { StateCreator } from "zustand";

export type AppView = "history" | "settings" | "dashboard" | "system-check" | "shortcuts";

export interface NavigationSlice {
  currentView: AppView;
  setCurrentView: (view: AppView) => void;
}

export const createNavigationSlice: StateCreator<NavigationSlice> = (set) => ({
  currentView: "dashboard",
  setCurrentView: (currentView) => set({ currentView }),
});
