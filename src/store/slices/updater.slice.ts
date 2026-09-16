import type { StateCreator } from "zustand";
import type { PolicyDecision } from "@/types/policy.types";

/**
 * `waiting`: a required update is downloaded and installs once dictation has
 * been quiet for a while. `installing`: it is being installed.
 */
export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "waiting"
  | "installing"
  | "error";

export interface UpdaterSlice {
  updateStatus: UpdateStatus;
  updateVersion: string | null;
  updateCurrentVersion: string | null;
  /** The update in progress is required by the policy; the app shows a blocking screen. */
  updateRequired: boolean;
  updateError: string | null;
  updateProgress: number;
  /** Latest decision from the signed update policy, or null before the first check. */
  policy: PolicyDecision | null;
  setUpdateStatus: (status: UpdateStatus) => void;
  setUpdateVersion: (version: string | null) => void;
  setUpdateCurrentVersion: (version: string | null) => void;
  setUpdateRequired: (required: boolean) => void;
  setUpdateError: (error: string | null) => void;
  setUpdateProgress: (progress: number) => void;
  setPolicy: (policy: PolicyDecision | null) => void;
}

export const createUpdaterSlice: StateCreator<UpdaterSlice> = (set) => ({
  updateStatus: "idle",
  updateVersion: null,
  updateCurrentVersion: null,
  updateRequired: false,
  updateError: null,
  updateProgress: 0,
  policy: null,
  setUpdateStatus: (updateStatus) => set({ updateStatus }),
  setUpdateVersion: (updateVersion) => set({ updateVersion }),
  setUpdateCurrentVersion: (updateCurrentVersion) => set({ updateCurrentVersion }),
  setUpdateRequired: (updateRequired) => set({ updateRequired }),
  setUpdateError: (updateError) => set({ updateError }),
  setUpdateProgress: (updateProgress) => set({ updateProgress }),
  setPolicy: (policy) => set({ policy }),
});
