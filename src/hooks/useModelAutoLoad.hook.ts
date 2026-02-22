import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Auto-loads the best available whisper model on startup.
 * Runs at App level so models are ready regardless of which view is shown.
 */
export function useModelAutoLoad() {
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;

    const autoLoad = async () => {
      try {
        const isAvailable = await invoke<boolean>("is_local_stt_available");
        if (!isAvailable) return;

        // Model preference: large > medium > small
        const preferred = [
          "ggml-large-v3.bin",
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
  }, []);
}
