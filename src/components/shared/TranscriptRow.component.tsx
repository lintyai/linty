import { Cloud, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TranscriptRecord } from "@/types/transcript.types";

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

interface TranscriptRowProps {
  transcript: TranscriptRecord;
  selected?: boolean;
  onClick?: () => void;
  actions?: React.ReactNode;
  className?: string;
}

export function TranscriptRow({
  transcript: t,
  selected,
  onClick,
  actions,
  className,
}: TranscriptRowProps) {
  const Tag = onClick ? "button" : "div";

  return (
    <Tag
      onClick={onClick}
      className={cn(
        "group relative flex w-full items-start gap-3 px-5 py-2.5 transition-colors duration-100",
        onClick && "text-left",
        selected ? "bg-bg-active" : "hover:bg-bg-hover",
        className,
      )}
    >
      {selected && (
        <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent" />
      )}

      <div className="flex flex-1 flex-col gap-1 min-w-0">
        <p className="text-[13px] text-text-primary leading-snug truncate">
          {t.finalText}
        </p>
        <div className="flex items-center gap-2 text-[11px] text-text-muted">
          <span className="tabular-nums">{formatTime(t.timestamp)}</span>
          <span className="text-border-subtle">·</span>
          <span className="flex items-center gap-0.5">
            {t.engine === "cloud" ? (
              <Cloud size={10} />
            ) : (
              <Cpu size={10} />
            )}
            {t.modelName}
          </span>
          <span className="text-border-subtle">·</span>
          <span>
            {formatDuration(t.durationSeconds)} rec
            {" · "}
            {(t.processingTimeMs / 1000).toFixed(1)}s processed
          </span>
          <span className="text-border-subtle">·</span>
          <span>{t.wordCount} words</span>
        </div>
      </div>

      {actions && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 pt-0.5">
          {actions}
        </div>
      )}
    </Tag>
  );
}
