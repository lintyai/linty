import { Cloud, Cpu } from "lucide-react";
import { useAppStore } from "@/store/app.store";
import { cn } from "@/lib/utils";

export function StatusBar() {
  const sttMode = useAppStore((s) => s.sttMode);
  const status = useAppStore((s) => s.status);
  const transcripts = useAppStore((s) => s.transcripts);

  const isRecording = status === "recording";
  const isProcessing =
    status === "transcribing" || status === "correcting" || status === "pasting";

  const statusText = isRecording
    ? "Recording..."
    : isProcessing
      ? status === "transcribing"
        ? "Transcribing..."
        : status === "correcting"
          ? "Polishing..."
          : "Pasting..."
      : "Ready";

  return (
    <div
      className={cn(
        "flex h-[28px] shrink-0 items-center justify-between border-t border-border-subtle px-5 text-[11px] transition-colors duration-200",
        isRecording && "bg-accent-glow",
      )}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1 text-text-muted">
          {sttMode === "cloud" ? <Cloud size={11} /> : <Cpu size={11} />}
          <span>{sttMode === "cloud" ? "Cloud" : "Local"}</span>
        </div>
        <span className="text-border">·</span>
        <span
          className={cn(
            "flex items-center gap-1.5",
            isRecording
              ? "text-accent"
              : isProcessing
                ? "text-warning"
                : "text-text-muted",
          )}
        >
          {isRecording && (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-breathe" />
          )}
          {statusText}
        </span>
      </div>

      <span className="text-text-muted tabular-nums">
        {transcripts.length} transcription{transcripts.length !== 1 ? "s" : ""}
      </span>
    </div>
  );
}
