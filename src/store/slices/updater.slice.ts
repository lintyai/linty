import type { StateCreator } from "zustand";

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "error";

export interface UpdaterSlice {
  updateStatus: UpdateStatus;
  updateVersion: string | null;
  updateError: string | null;
  updateProgress: number;
  setUpdateStatus: (status: UpdateStatus) => void;
  setUpdateVersion: (version: string | null) => void;
  setUpdateError: (error: string | null) => void;
  setUpdateProgress: (progress: number) => void;
}

export const createUpdaterSlice: StateCreator<UpdaterSlice> = (set) => ({
  updateStatus: "idle",
  updateVersion: null,
  updateError: null,
  updateProgress: 0,
  setUpdateStatus: (updateStatus) => set({ updateStatus }),
  setUpdateVersion: (updateVersion) => set({ updateVersion }),
  setUpdateError: (updateError) => set({ updateError }),
  setUpdateProgress: (updateProgress) => set({ updateProgress }),
});
