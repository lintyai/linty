import { useSyncExternalStore } from "react";
import { AlertCircle, AudioLines, Check, Cloud, Cpu, HardDrive, Loader2 } from "lucide-react";
import { useAppStore } from "@/store/app.store";
import { settingsSaveFeedback } from "@/lib/settings-save-feedback";
import { dictationPreparation } from "@/services/dictation-preparation.service";

export function StatusBar() {
  const { sttMode, status, isRecording, error, groqApiKey, loadedModelFilename, setSettingsSection } = useAppStore();
  const saveStatus = useSyncExternalStore(settingsSaveFeedback.subscribe, settingsSaveFeedback.getSnapshot);
  const preparation = useSyncExternalStore(dictationPreparation.subscribe, dictationPreparation.getSnapshot);
  const saveLabel = saveStatus === "saving" ? "Saving changes…" : saveStatus === "saved" ? "Changes saved locally" : saveStatus === "error" ? "Couldn't save changes. Try again." : "Changes are saved locally";
  const recording = isRecording || status === "recording";
  const preparing = status === "preparing" || preparation === "preparing";
  const busy = preparing || ["transcribing", "correcting", "pasting"].includes(status);
  const ready = preparation === "ready" && (sttMode === "cloud" ? Boolean(groqApiKey.trim()) : Boolean(loadedModelFilename));
  const engineState = recording ? "recording" : busy ? "processing" : status === "error" || !ready ? "unavailable" : "ready";
  const engine = sttMode === "cloud" ? "Cloud" : "On-device";
  const labels: Record<string, string> = { transcribing: "Transcribing", correcting: "Refining text", pasting: "Pasting" };
  const activity = recording ? "Recording" : preparing ? "Preparing" : busy ? labels[status] : status === "error" ? "Error" : !ready ? "Not ready" : "Ready";
  const detail = status === "error" ? error || "Transcription failed"
    : preparation === "error" ? "Preparation failed. Try dictating again."
    : !ready && !recording && !busy ? sttMode === "cloud"
      ? groqApiKey.trim() ? "Dictation will prepare before recording" : "Add an API key in Speech engine settings"
      : loadedModelFilename ? "Dictation will prepare before recording" : "Choose or load a model in Speech engine settings"
    : activity;
  return (
    <footer className="status-bar">
      <div className={`status-save is-${saveStatus}`} role="status" aria-atomic="true" title={saveLabel}>
        <span className="status-save-indicator" aria-hidden="true">
          <HardDrive size={13} className={saveStatus === "idle" ? "is-active" : ""} />
          <Loader2 size={13} className={saveStatus === "saving" ? "is-active animate-spin" : ""} />
          <Check size={13} className={saveStatus === "saved" ? "is-active" : ""} />
          <AlertCircle size={13} className={saveStatus === "error" ? "is-active" : ""} />
        </span>
        <span>{saveLabel}</span>
      </div>
      <div className="status-engine-region" role="status" aria-atomic="true">
        <button className={`status-engine is-${engineState}`} onClick={() => setSettingsSection("models")}
          aria-label={`${engine}: ${activity}. Configure speech engine`} title={`${engine}: ${detail}`}>
          <span className="status-engine-indicator" aria-hidden="true">
            {sttMode === "cloud" ? <Cloud size={13} className={engineState === "ready" ? "is-active" : ""} /> : <Cpu size={13} className={engineState === "ready" ? "is-active" : ""} />}
            <AlertCircle size={13} className={engineState === "unavailable" ? "is-active" : ""} />
            <AudioLines size={13} className={recording ? "is-active status-recording-icon" : ""} />
            <Loader2 size={13} className={engineState === "processing" ? "is-active animate-spin" : ""} />
          </span>
          <span>{engine}</span>
        </button>
      </div>
    </footer>
  );
}
