import type { StateCreator } from "zustand";

export interface RecordingSlice {
  isRecording: boolean;
  recordingDuration: number;
  amplitude: number;
  setIsRecording: (recording: boolean) => void;
  setRecordingDuration: (duration: number) => void;
  setAmplitude: (amplitude: number) => void;
  resetRecording: () => void;
}

export const createRecordingSlice: StateCreator<RecordingSlice> = (set) => ({
  isRecording: false,
  recordingDuration: 0,
  amplitude: 0,
  setIsRecording: (isRecording) => set({ isRecording }),
  setRecordingDuration: (recordingDuration) => set({ recordingDuration }),
  setAmplitude: (amplitude) => set({ amplitude }),
  resetRecording: () =>
    set({ isRecording: false, recordingDuration: 0, amplitude: 0 }),
});
