import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/store/app.store";

/**
 * Auto-loads the user's preferred whisper model on startup.
 * If a saved preference exists and the model file is present, loads that.
 * Otherwise falls back to the best available model by quality order.
 */
export function useModelAutoLoad() {
  const loadedRef = useRef(false);
  const setLoadedModelFilename = useAppStore((s) => s.setLoadedModelFilename);
  const selectedModelFilename = useAppStore((s) => s.selectedModelFilename);
  const settingsLoaded = useAppStore((s) => s.settingsLoaded);

  useEffect(() => {
    if (loadedRef.current || !settingsLoaded) return;

    const autoLoad = async () => {
      try {
        const isAvailable = await invoke<boolean>("is_local_stt_available");
        if (!isAvailable) return;

        // If user previously selected a model, try loading that first
        if (selectedModelFilename) {
          try {
            const exists = await invoke<boolean>("check_model_exists", {
              filename: selectedModelFilename,
            });
            if (exists) {
              console.log("[auto-load] Loading saved preference:", selectedModelFilename);
              await invoke("load_whisper_model", { filename: selectedModelFilename });
              console.log("[auto-load] Model loaded:", selectedModelFilename);
              setLoadedModelFilename(selectedModelFilename);
              loadedRef.current = true;
              return;
            }
          } catch {
            console.warn("[auto-load] Saved model failed, falling back");
          }
        }

        // Fallback: load best available by quality order
        const preferred = [
          "ggml-large-v3.bin",
          "ggml-large-v3-turbo.bin",
          "ggml-large-v3-turbo-q5_0.bin",
          "ggml-medium.bin",
          "ggml-small.bin",
        ];

        for (const filename of preferred) {
          try {
            const exists = await invoke<boolean>("check_model_exists", {
              filename,
            });
            if (exists) {
              console.log("[auto-load] Loading whisper model:", filename);
              await invoke("load_whisper_model", { filename });
              console.log("[auto-load] Model loaded:", filename);
              setLoadedModelFilename(filename);
              loadedRef.current = true;
              return;
            }
          } catch {
            // Try next model
          }
        }

        console.log("[auto-load] No whisper models found");
      } catch (err) {
        console.error("[auto-load] Failed:", err);
      }
    };

    autoLoad();
  }, [setLoadedModelFilename, selectedModelFilename, settingsLoaded]);
}
