import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "@/store/app.store";

interface ModelInfo {
  name: string;
  filename: string;
  url: string;
  size_mb: number;
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

  const { setIsLocalModelDownloaded, setLocalModelPath } = useAppStore();

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
      }
    };
    if (models.length) checkModels();
  }, [models, setIsLocalModelDownloaded]);

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
      } catch (err) {
        console.error("Download failed:", err);
      } finally {
        setIsDownloading(false);
        setDownloadingFilename(null);
      }
    },
    [setLocalModelPath, setIsLocalModelDownloaded],
  );

  const loadModel = useCallback(async (filename: string) => {
    try {
      await invoke("load_whisper_model", { filename });
    } catch (err) {
      console.error("Failed to load model:", err);
      throw err;
    }
  }, []);

  return {
    models,
    downloadedModels,
    isDownloading,
    downloadProgress,
    downloadingFilename,
    isLocalAvailable,
    downloadModel,
    loadModel,
  };
}
