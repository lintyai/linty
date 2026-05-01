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
        "group relative flex w-full items-start gap-3 px-5 py-3 transition-all duration-100",
        onClick && "text-left hover:translate-x-[1px]",
        selected ? "bg-accent-glow" : "hover:bg-bg-hover",
        className,
      )}
    >
      {selected && (
        <div className="absolute left-0 top-1 bottom-1 w-[2px] rounded-r-full bg-accent" />
      )}

      <div className="flex flex-1 flex-col gap-1.5 min-w-0">
        <p className="text-[13px] text-text-primary leading-snug truncate">
          {t.finalText}
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1 rounded-full bg-bg-hover px-2 py-0.5 text-[10px] text-text-muted">
            {t.engine === "cloud" ? <Cloud size={9} /> : <Cpu size={9} />}
            {t.modelName}
          </span>
          <span className="inline-flex items-center rounded-full bg-bg-hover px-2 py-0.5 text-[10px] tabular-nums text-text-muted">
            {formatTime(t.timestamp)}
          </span>
          <span className="inline-flex items-center rounded-full bg-bg-hover px-2 py-0.5 text-[10px] tabular-nums text-text-muted">
            {formatDuration(t.durationSeconds)}
          </span>
          <span className="inline-flex items-center rounded-full bg-bg-hover px-2 py-0.5 text-[10px] tabular-nums text-text-muted">
            {t.wordCount}w
          </span>
        </div>
      </div>

      {actions && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-100 shrink-0 pt-0.5">
          {actions}
        </div>
      )}
    </Tag>
  );
}
