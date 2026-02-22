import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";

interface RecordingIndicatorProps {
  isRecording: boolean;
  duration: number;
  className?: string;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  if (mins > 0) {
    return `${mins}:${secs.toString().padStart(2, "0")}.${tenths}`;
  }
  return `${secs}.${tenths}s`;
}

export function RecordingIndicator({
  isRecording,
  duration,
  className,
}: RecordingIndicatorProps) {
  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      {/* Mic button with pulse rings */}
      <div className="relative flex items-center justify-center">
        {/* Outer pulse rings — only when recording */}
        {isRecording && (
          <>
            <div
              className="animate-pulse-ring-slow absolute rounded-full"
              style={{
                width: 72,
                height: 72,
                border: "1px solid var(--color-accent)",
                opacity: 0.15,
              }}
            />
            <div
              className="animate-pulse-ring absolute rounded-full"
              style={{
                width: 72,
                height: 72,
                border: "1.5px solid var(--color-accent)",
                opacity: 0.25,
              }}
            />
          </>
        )}

        {/* Glow backdrop */}
        {isRecording && (
          <div
            className="animate-breathe absolute rounded-full"
            style={{
              width: 64,
              height: 64,
              background:
                "radial-gradient(circle, var(--color-accent-glow-strong) 0%, transparent 70%)",
            }}
          />
        )}

        {/* Mic circle */}
        <div
          className={cn(
            "relative z-10 flex items-center justify-center rounded-full transition-all duration-200",
            isRecording
              ? "h-14 w-14 bg-accent shadow-[0_0_24px_var(--color-accent-glow-strong)]"
              : "h-12 w-12 bg-bg-elevated border border-border",
          )}
        >
          <Mic
            size={isRecording ? 22 : 20}
            strokeWidth={1.8}
            className={cn(
              "transition-colors duration-200",
              isRecording ? "text-white" : "text-text-muted",
            )}
          />
        </div>
      </div>

      {/* Duration counter */}
      {isRecording && (
        <div className="animate-fade-in flex items-center gap-2">
          <div
            className="h-1.5 w-1.5 rounded-full bg-accent animate-breathe"
          />
          <span
            className="text-sm tracking-wide text-text-secondary tabular-nums"
            style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "0.04em" }}
          >
            {formatDuration(duration)}
          </span>
        </div>
      )}
    </div>
  );
}
