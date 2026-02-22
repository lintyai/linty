import { useEffect, useRef } from "react";
import {
  register,
  unregister,
  isRegistered,
} from "@tauri-apps/plugin-global-shortcut";
import { useRecording } from "./useRecording.hook";
import { useTranscription } from "./useTranscription.hook";
import { useAppStore } from "@/store/app.store";

const HOTKEY = "CommandOrControl+Shift+Space";

export function useGlobalHotkey() {
  const { startRecording, stopRecording } = useRecording();
  const { processAudio } = useTranscription();
  const isRecordingRef = useRef(false);

  // Keep ref in sync with store
  const isRecording = useAppStore((s) => s.isRecording);
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  useEffect(() => {
    let mounted = true;

    const setup = async () => {
      try {
        // Unregister first in case it's already registered (e.g. HMR)
        const alreadyRegistered = await isRegistered(HOTKEY);
        if (alreadyRegistered) {
          await unregister(HOTKEY);
        }

        await register(HOTKEY, async (event) => {
          if (!mounted) return;

          if (event.state === "Pressed" && !isRecordingRef.current) {
            await startRecording();
          } else if (event.state === "Released" && isRecordingRef.current) {
            const samples = await stopRecording();
            if (samples.length) {
              processAudio(samples);
            }
          }
        });
      } catch (err) {
        console.error("Failed to register global hotkey:", err);
      }
    };

    setup();

    return () => {
      mounted = false;
      unregister(HOTKEY).catch(() => {});
    };
  }, [startRecording, stopRecording, processAudio]);
}
