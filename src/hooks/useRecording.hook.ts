import { useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/store/app.store";

export interface StopResult {
  sample_count: number;
  duration_secs: number;
}

export function useRecording() {
  const isRecording = useAppStore((s) => s.isRecording);
  const recordingDuration = useAppStore((s) => s.recordingDuration);
  const amplitude = useAppStore((s) => s.amplitude);
  const setIsRecording = useAppStore((s) => s.setIsRecording);
  const setRecordingDuration = useAppStore((s) => s.setRecordingDuration);
  const setAmplitude = useAppStore((s) => s.setAmplitude);
  const setStatus = useAppStore((s) => s.setStatus);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const startRecording = useCallback(async () => {
    try {
      await invoke("start_recording");
      setIsRecording(true);
      setStatus("recording");
      startTimeRef.current = Date.now();

      timerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        setRecordingDuration(elapsed);
      }, 100);
    } catch (err) {
      console.error("Failed to start recording:", err);
      setIsRecording(false);
    }
  }, [setIsRecording, setStatus, setRecordingDuration]);

  const stopRecording = useCallback(async (): Promise<StopResult> => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    try {
      const result = await invoke<StopResult>("stop_recording");
      setIsRecording(false);
      setStatus("transcribing");
      return result;
    } catch (err) {
      console.error("Failed to stop recording:", err);
      setIsRecording(false);
      setStatus("error");
      return { sample_count: 0, duration_secs: 0 };
    }
  }, [setIsRecording, setStatus]);

  const getRecordingStartTime = useCallback(() => {
    return startTimeRef.current;
  }, []);

  // Listen for audio amplitude events from Rust
  useEffect(() => {
    const unlisten = listen<number>("audio-amplitude", (event) => {
      setAmplitude(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setAmplitude]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  return {
    isRecording,
    recordingDuration,
    amplitude,
    startRecording,
    stopRecording,
    getRecordingStartTime,
  };
}
