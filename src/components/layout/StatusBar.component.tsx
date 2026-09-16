import { AlertCircle, Cloud, Cpu, Loader2 } from "lucide-react";
import { useAppStore } from "@/store/app.store";

export function StatusBar() {
  const { sttMode, status, error, groqApiKey, loadedModelFilename, setSettingsSection } = useAppStore();
  const busy = ["transcribing", "correcting", "pasting"].includes(status);
  const needsSetup = sttMode === "cloud" && !groqApiKey;
  const labels: Record<string, string> = {
    recording: "Recording", transcribing: "Transcribing", correcting: "Refining text", pasting: "Pasting", done: "Transcription complete",
  };
  const label = status === "error" ? (error || "Transcription failed") : labels[status] || (needsSetup ? "API key required" : sttMode === "local" && !loadedModelFilename ? "Model will load on dictation" : "Ready to dictate");
  return (
    <footer className="status-bar">
      <div className={`status-message ${status === "error" ? "text-error" : ""}`} role="status" title={label}>
        {status === "error" ? <AlertCircle size={12} /> : busy ? <Loader2 size={12} className="animate-spin" /> : <span className={`status-dot ${status === "recording" ? "is-recording" : ""}`} />}
        <span>{label}</span>
      </div>
      <button className="status-engine" onClick={() => setSettingsSection("models")} title="Configure speech engine">
        {sttMode === "cloud" ? <Cloud size={12} /> : <Cpu size={12} />}
        {sttMode === "cloud" ? "Cloud" : "On-device"}
      </button>
    </footer>
  );
}
