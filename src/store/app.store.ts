import { create } from "zustand";
import {
  createRecordingSlice,
  type RecordingSlice,
} from "./slices/recording.slice";
import {
  createTranscriptionSlice,
  type TranscriptionSlice,
} from "./slices/transcription.slice";
import {
  createSettingsSlice,
  type SettingsSlice,
} from "./slices/settings.slice";

export type AppStore = RecordingSlice & TranscriptionSlice & SettingsSlice;

export const useAppStore = create<AppStore>()((...a) => ({
  ...createRecordingSlice(...a),
  ...createTranscriptionSlice(...a),
  ...createSettingsSlice(...a),
}));
