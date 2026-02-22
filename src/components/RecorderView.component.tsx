import { useEffect, useCallback } from "react";
import { Loader2, AlertCircle, Mic } from "lucide-react";
import { useRecording } from "@/hooks/useRecording.hook";
import { useTranscription } from "@/hooks/useTranscription.hook";
import { RecordingIndicator } from "./RecordingIndicator.component";
import { WaveformVisualizer } from "./WaveformVisualizer.component";
import { TranscriptionResult } from "./TranscriptionResult.component";
import { PermissionCheck } from "./PermissionCheck.component";
import { cn } from "@/lib/utils";
import type { TranscriptionStatus } from "@/store/slices/transcription.slice";

const STATUS_LABELS: Partial<Record<TranscriptionStatus, string>> = {
  transcribing: "Transcribing",
  correcting: "Polishing",
  pasting: "Pasting",
};

export function RecorderView() {
  const { isRecording, recordingDuration, amplitude, startRecording, stopRecording } =
    useRecording();
  const { status, finalText, error, processAudio, resetTranscription } =
    useTranscription();

  const isProcessing = status === "transcribing" || status === "correcting" || status === "pasting";
  const isDone = status === "done";
  const isError = status === "error";
  const isIdle = status === "idle";

  // Handle hotkey stop → process
  const handleStopAndProcess = useCallback(async () => {
    const samples = await stopRecording();
    if (samples.length) {
      processAudio(samples);
    }
  }, [stopRecording, processAudio]);

  // Click mic to start/stop
  const handleMicClick = useCallback(async () => {
    if (isRecording) {
      await handleStopAndProcess();
    } else if (isIdle) {
      await startRecording();
    }
  }, [isRecording, isIdle, startRecording, handleStopAndProcess]);

  // Keyboard: Space to toggle
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        handleMicClick();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleMicClick]);

  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      {/* ── Idle State ── */}
      {isIdle && !isError && (
        <div className="animate-fade-in flex flex-col items-center gap-5">
          <button
            onClick={handleMicClick}
            className={cn(
              "group relative flex h-16 w-16 items-center justify-center rounded-full",
              "border border-border bg-bg-elevated",
              "transition-all duration-200",
              "hover:border-[var(--color-text-muted)] hover:bg-bg-hover hover:scale-105",
              "active:scale-95",
            )}
          >
            <Mic
              size={24}
              strokeWidth={1.6}
              className="text-text-muted transition-colors duration-200 group-hover:text-text-secondary"
            />
          </button>

          <div className="flex flex-col items-center gap-1.5">
            <span className="text-[11px] tracking-widest text-text-muted uppercase">
              Press to record
            </span>
            <kbd className="text-[10px] tracking-wider text-text-muted/50">
              &#8984;&#8679;Space
            </kbd>
          </div>

          <PermissionCheck className="mt-1 max-w-[280px]" />
        </div>
      )}

      {/* ── Recording State ── */}
      {isRecording && (
        <div className="animate-fade-in flex flex-col items-center gap-4">
          <button onClick={handleMicClick}>
            <RecordingIndicator
              isRecording
              duration={recordingDuration}
            />
          </button>

          <WaveformVisualizer
            amplitude={amplitude}
            isActive={isRecording}
            className="h-10 w-56"
          />

          <span className="text-[10px] tracking-widest text-text-muted/60 uppercase">
            Release to transcribe
          </span>
        </div>
      )}

      {/* ── Processing State ── */}
      {isProcessing && (
        <div className="animate-fade-in flex flex-col items-center gap-4">
          <div className="relative flex h-14 w-14 items-center justify-center">
            {/* Spinning ring */}
            <svg className="animate-spin-slow absolute h-14 w-14" viewBox="0 0 56 56">
              <circle
                cx="28"
                cy="28"
                r="25"
                fill="none"
                stroke="var(--color-border)"
                strokeWidth="1.5"
              />
              <circle
                cx="28"
                cy="28"
                r="25"
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth="1.5"
                strokeDasharray="40 120"
                strokeLinecap="round"
              />
            </svg>
            <Loader2
              size={18}
              className="text-text-muted"
              style={{ animation: "none" }}
            />
          </div>

          <div className="flex items-center gap-2">
            <div
              className="h-1 w-1 rounded-full bg-accent animate-breathe"
            />
            <span className="text-[12px] tracking-wide text-text-secondary">
              {STATUS_LABELS[status] || "Processing"}
            </span>
          </div>
        </div>
      )}

      {/* ── Done State ── */}
      {isDone && (
        <div className="animate-fade-in flex flex-col items-center gap-4 w-full">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-success-glow)]">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
              <circle cx="12" cy="12" r="10" stroke="var(--color-success)" strokeWidth="1.5" opacity="0.3" />
              <path
                d="M8 12.5l2.5 2.5 5.5-5.5"
                stroke="var(--color-success)"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="animate-checkmark"
              />
            </svg>
          </div>

          <span className="text-[11px] tracking-wide text-success">
            Pasted
          </span>

          <TranscriptionResult text={finalText} className="max-w-[320px]" />
        </div>
      )}

      {/* ── Error State ── */}
      {isError && error && (
        <div className="animate-fade-in flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-accent-glow)]">
            <AlertCircle size={20} strokeWidth={1.6} className="text-accent" />
          </div>

          <p className="max-w-[260px] text-center text-[12px] leading-relaxed text-text-muted">
            {error}
          </p>

          <button
            onClick={resetTranscription}
            className={cn(
              "rounded-md px-3 py-1.5 text-[11px] tracking-wide",
              "border border-border bg-bg-elevated text-text-secondary",
              "transition-all duration-150",
              "hover:bg-bg-hover hover:text-text-primary",
              "active:scale-95",
            )}
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
