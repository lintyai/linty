import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/store/app.store";

/**
 * Auto-activates the user's preferred local model (whisper or Parakeet) on startup.
 * If the engine preference is Local, loads the model into memory; if Cloud,
 * only registers the filename so it lazy-loads on a later switch to Local —
 * no point keeping ~0.5 GB resident for an engine the user isn't using.
 * If a saved preference exists and the model file is present, uses that;
 * otherwise falls back to the best available model by quality order.
 */
export function useModelAutoLoad() {
  const loadedRef = useRef(false);
  const setLoadedModelFilename = useAppStore((s) => s.setLoadedModelFilename);
  const selectedModelFilename = useAppStore((s) => s.selectedModelFilename);
  const settingsLoaded = useAppStore((s) => s.settingsLoaded);
  const sttMode = useAppStore((s) => s.sttMode);

  useEffect(() => {
    if (loadedRef.current || !settingsLoaded) return;

    const activateModel = async (filename: string) => {
      if (sttMode === "local") {
        console.log("[auto-load] Loading local model:", filename);
        await invoke("load_local_model", { filename });
        console.log("[auto-load] Model loaded:", filename);
      } else {
        console.log("[auto-load] Cloud engine active — registering model lazily:", filename);
        await invoke("register_local_model", { filename });
      }
      setLoadedModelFilename(filename);
      loadedRef.current = true;
    };

    const autoLoad = async () => {
      try {
        const isAvailable = await invoke<boolean>("is_local_stt_available");
        if (!isAvailable) return;

        // If user previously selected a model, try that first
        if (selectedModelFilename) {
          try {
            const exists = await invoke<boolean>("check_model_exists", {
              filename: selectedModelFilename,
            });
            if (exists) {
              await activateModel(selectedModelFilename);
              return;
            }
          } catch {
            console.warn("[auto-load] Saved model failed, falling back");
          }
        }

        // Fallback: best available by quality order.
        const preferred = [
          "ggml-large-v3-turbo-q5_0.bin",
          "parakeet-tdt-0.6b-v3",
          "ggml-medium.bin",
          "ggml-small.bin",
        ];

        for (const filename of preferred) {
          try {
            const exists = await invoke<boolean>("check_model_exists", {
              filename,
            });
            if (exists) {
              await activateModel(filename);
              return;
            }
          } catch {
            // Try next model
          }
        }

        console.log("[auto-load] No local models found");
      } catch (err) {
        console.error("[auto-load] Failed:", err);
      }
    };

    autoLoad();
  }, [setLoadedModelFilename, selectedModelFilename, settingsLoaded, sttMode]);
}
