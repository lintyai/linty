import { invoke } from "@tauri-apps/api/core";

// First-run setup and Settings share downloads, including across React remounts.
const speechDownloads = new Map<string, Promise<string | null>>();

export function downloadSpeechModel(model: { filename: string }, retry = false) {
  const existing = speechDownloads.get(model.filename);
  if (existing) return existing;
  const download = (async () => {
    if (!retry && await invoke<boolean>("check_model_exists", { filename: model.filename })) return null;
    return invoke<string>("download_model_file", {
      filename: model.filename,
    });
  })().finally(() => speechDownloads.delete(model.filename));
  speechDownloads.set(model.filename, download);
  return download;
}
