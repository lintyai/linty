import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { saveSetting } from "@/hooks/useSettings.hook";
import { useAppStore } from "@/store/app.store";

interface ModelInfo {
  name: string;
  filename: string;
  url: string;
  size_mb: number;
  description: string;
  /** Inference engine: whisper.cpp GGML file or Parakeet CoreML bundle. */
  backend: "whisper" | "parakeet";
}

interface DownloadProgress {
  downloaded: number;
  total: number;
  progress: number;
}

export function useModelDownload() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [downloadedModels, setDownloadedModels] = useState<Set<string>>(
    new Set(),
  );
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadingFilename, setDownloadingFilename] = useState<string | null>(
    null,
  );
  const [isLocalAvailable, setIsLocalAvailable] = useState(false);
  /** Model currently being loaded into memory (after a download or via Load). */
  const [loadingFilename, setLoadingFilename] = useState<string | null>(null);
  const globalLoadedModel = useAppStore((s) => s.loadedModelFilename);
  const [loadedModel, setLoadedModel] = useState<string | null>(null);

  const { setIsLocalModelDownloaded, setLocalModelPath, setLoadedModelFilename } = useAppStore();

  const persistModelSelection = useCallback(async (filename: string) => {
    try {
      await saveSetting("selectedModelFilename", filename);
    } catch (err) {
      console.error("[model] Failed to persist selection:", err);
    }
  }, []);

  // Sync local state from global store (e.g. after auto-load on startup)
  useEffect(() => {
    if (globalLoadedModel && !loadedModel) {
      setLoadedModel(globalLoadedModel);
    }
  }, [globalLoadedModel, loadedModel]);

  // Check if local-stt feature is compiled in
  useEffect(() => {
    invoke<boolean>("is_local_stt_available")
      .then(setIsLocalAvailable)
      .catch(() => setIsLocalAvailable(false));
  }, []);

  // Load available models
  useEffect(() => {
    invoke<ModelInfo[]>("get_available_models")
      .then(setModels)
      .catch(console.error);
  }, []);

  // Check which models are already downloaded
  useEffect(() => {
    const checkModels = async () => {
      const downloaded = new Set<string>();
      for (const model of models) {
        try {
          const exists = await invoke<boolean>("check_model_exists", {
            filename: model.filename,
          });
          if (exists) downloaded.add(model.filename);
        } catch {
          // ignore
        }
      }
      setDownloadedModels(downloaded);

      if (downloaded.size > 0) {
        setIsLocalModelDownloaded(true);

        // Auto-load the first downloaded model if none is loaded yet
        if (!loadedModel) {
          const firstDownloaded = models.find((m) => downloaded.has(m.filename));
          if (firstDownloaded) {
            setLoadingFilename(firstDownloaded.filename);
            try {
              await invoke("load_local_model", {
                filename: firstDownloaded.filename,
              });
              setLoadedModel(firstDownloaded.filename);
              setLoadedModelFilename(firstDownloaded.filename);
            } catch (err) {
              console.error("[model] Auto-load failed:", err);
            } finally {
              setLoadingFilename(null);
            }
          }
        }
      }
    };
    if (models.length) checkModels();
  }, [models, setIsLocalModelDownloaded, loadedModel]);

  // Listen for download progress
  useEffect(() => {
    const unlistenProgress = listen<DownloadProgress>(
      "model-download-progress",
      (event) => {
        setDownloadProgress(event.payload.progress);
      },
    );

    const unlistenComplete = listen("model-download-complete", () => {
      setIsDownloading(false);
      setDownloadProgress(100);
      if (downloadingFilename) {
        setDownloadedModels((prev) => new Set([...prev, downloadingFilename]));
        setIsLocalModelDownloaded(true);
      }
    });

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
    };
  }, [downloadingFilename, setIsLocalModelDownloaded]);

  const downloadModel = useCallback(
    async (model: ModelInfo) => {
      setIsDownloading(true);
      setDownloadProgress(0);
      setDownloadingFilename(model.filename);

      try {
        const path = await invoke<string>("download_model_file", {
          url: model.url,
          filename: model.filename,
        });
        setLocalModelPath(path);
        setDownloadedModels((prev) => new Set([...prev, model.filename]));
        setIsLocalModelDownloaded(true);

        // Auto-load the model after download. Parakeet's first load compiles
        // for the Neural Engine and can take ~30 s, so keep a loading state.
        setLoadingFilename(model.filename);
        try {
          await invoke("load_local_model", { filename: model.filename });
          setLoadedModel(model.filename);
          setLoadedModelFilename(model.filename);
          await persistModelSelection(model.filename);
        } catch (loadErr) {
          console.error("[model] Auto-load after download failed:", loadErr);
          useAppStore.getState().addToast({ type: "error", message: "Model downloaded but could not load. Choose Load to try again." });
        } finally {
          setLoadingFilename(null);
        }
      } catch (err) {
        console.error("Download failed:", err);
        useAppStore.getState().addToast({ type: "error", message: "Model download failed. Check your connection, then try again." });
      } finally {
        setIsDownloading(false);
        setDownloadingFilename(null);
      }
    },
    [setLocalModelPath, setIsLocalModelDownloaded, setLoadedModelFilename, persistModelSelection],
  );

  const loadModel = useCallback(async (filename: string) => {
    setLoadingFilename(filename);
    try {
      await invoke("load_local_model", { filename });
      setLoadedModel(filename);
      setLoadedModelFilename(filename);
      await persistModelSelection(filename);
    } catch (err) {
      console.error("Failed to load model:", err);
      throw err;
    } finally {
      setLoadingFilename(null);
    }
  }, [setLoadedModelFilename, persistModelSelection]);

  return {
    models,
    downloadedModels,
    isDownloading,
    downloadProgress,
    downloadingFilename,
    isLocalAvailable,
    loadedModel,
    loadingFilename,
    downloadModel,
    loadModel,
  };
}
