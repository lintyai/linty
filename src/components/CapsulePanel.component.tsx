import { useCapsuleTheme } from "@/hooks/useCapsuleTheme.hook";
import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

type CapsuleMode = "idle" | "recording" | "transcribing" | "correcting" | "pasting" | "done" | "error";

interface CapsuleStatePayload {
  state: CapsuleMode;
  text?: string;
  error?: string;
}

const PROCESSING_LABELS: Partial<Record<CapsuleMode, string>> = {
  transcribing: "Transcribing",
  correcting: "Polishing",
  pasting: "Pasting",
};

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins > 0) return `${mins}:${secs.toString().padStart(2, "0")}`;
  return `0:${secs.toString().padStart(2, "0")}`;
}

// ── Inline SVG icons ──

function SpinnerIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3 shrink-0 animate-spin">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" opacity="0.2" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CheckmarkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none">
      <circle cx="12" cy="12" r="10" stroke="var(--color-success)" strokeWidth="1.5" opacity="0.2" />
      <path
        d="M8 12.5l2.5 2.5 5.5-5.5"
        stroke="var(--color-success)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="animate-checkmark"
      />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3 shrink-0">
      <circle cx="8" cy="8" r="7" stroke="var(--color-error)" strokeWidth="1.2" opacity="0.4" />
      <path d="M8 4.5v4" stroke="var(--color-error)" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r="0.7" fill="var(--color-error)" />
    </svg>
  );
}

// ── Live waveform bars (driven by rAF for smooth animation) ──

function WaveformBars({ amplitude }: { amplitude: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ampRef = useRef(amplitude);
  const rafRef = useRef(0);

  ampRef.current = amplitude;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const barCount = 24;
    const barWidth = 2;
    const gap = 1.5;
    const totalWidth = barCount * (barWidth + gap) - gap;
    const height = 20;

    canvas.width = totalWidth * 2; // retina
    canvas.height = height * 2;
    canvas.style.width = `${totalWidth}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(2, 2);

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let smoothedAmplitude = 0;
    let previousTime = 0;
    const draw = (time: number) => {
      const elapsed = previousTime ? Math.min(time - previousTime, 64) : 16;
      previousTime = time;
      ctx.clearRect(0, 0, totalWidth, height);

      smoothedAmplitude += (ampRef.current - smoothedAmplitude) * (1 - Math.exp(-elapsed / 70));
      const amp = motionQuery.matches ? ampRef.current : smoothedAmplitude;
      const t = motionQuery.matches ? 0 : time / 1000;

      const colors = getComputedStyle(canvas);
      const accent = colors.getPropertyValue("--color-accent").trim() || colors.color;
      for (let i = 0; i < barCount; i++) {
        const center = barCount / 2;
        const distFromCenter = Math.abs(i - center) / center;

        // Organic multi-wave motion
        const wave1 = Math.sin(t * 3.2 + i * 0.45) * 0.35;
        const wave2 = Math.sin(t * 5.1 + i * 0.7) * 0.2;
        const wave3 = Math.sin(t * 1.8 + i * 0.25) * 0.15;

        // Amplitude influence — sqrt curve boosts quiet sounds, clamp loud ones
        const boosted = Math.sqrt(Math.min(amp * 12, 1));
        const ampFactor = 0.25 + boosted * 0.75;
        const rawHeight = (wave1 + wave2 + wave3 + 0.5) * ampFactor;

        // Taper edges for a natural arc shape
        const edgeFalloff = 1 - distFromCenter * 0.6;
        const barHeight = Math.max(2, Math.min(height - 2, rawHeight * height * edgeFalloff));

        const x = i * (barWidth + gap);
        const y = (height - barHeight) / 2;

        // Color: accent with opacity based on height
        const opacity = 0.5 + (barHeight / height) * 0.5;
        ctx.fillStyle = accent;
        ctx.globalAlpha = opacity;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 1);
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return <canvas ref={canvasRef} className="shrink-0" />;
}

export function CapsulePanel() {
  useCapsuleTheme();
  const [mode, setMode] = useState<CapsuleMode>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [amplitude, setAmplitude] = useState(0);
  const [duration, setDuration] = useState(0);
  const [dismissing, setDismissing] = useState(false);
  const [partialText, setPartialText] = useState("");
  const [sttProgress, setSttProgress] = useState(0);
  const [doneText, setDoneText] = useState("");
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ampFrameRef = useRef(0);
  const durationStartRef = useRef(0);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const resetStreamingState = useCallback(() => {
    setPartialText("");
    setSttProgress(0);
    setDoneText("");
  }, []);

  const dismiss = useCallback(() => {
    if (exitTimerRef.current !== null) return;
    setDismissing(true);
    if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
    exitTimerRef.current = setTimeout(() => {
      exitTimerRef.current = null;
      setMode("idle");
      setDismissing(false);
      setErrorMsg("");
      setAmplitude(0);
      setDuration(0);
      resetStreamingState();
      invoke("hide_capsule").catch(() => {});
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 300);
  }, [resetStreamingState]);

  // Listen for capsule state from main window
  useEffect(() => {
    const unlisten = listen<CapsuleStatePayload>("capsule-state", (event) => {
      const { state, text, error } = event.payload;

      // Clear any pending dismiss timer
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }

      if (state === "idle") {
        dismiss();
        return;
      }

      // A new dictation owns the capsule, including during the previous exit.
      if (exitTimerRef.current !== null) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      setDismissing(false);
      setMode(state);

      if (state === "recording") {
        resetStreamingState();
        setDuration(0);
        setAmplitude(0);
        durationStartRef.current = Date.now();
        if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = setInterval(() => {
          setDuration((Date.now() - durationStartRef.current) / 1000);
        }, 500);
      } else {
        if (durationIntervalRef.current) {
          clearInterval(durationIntervalRef.current);
          durationIntervalRef.current = null;
        }
      }

      if (state === "done") {
        if (text) setDoneText(text);
        // Longer dismiss when showing text for readability
        const dismissDelay = text ? 1800 : 1200;
        dismissTimerRef.current = setTimeout(dismiss, dismissDelay);
      }

      if (state === "error") {
        setErrorMsg(error || "Something went wrong");
        dismissTimerRef.current = setTimeout(dismiss, 6000);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      if (exitTimerRef.current !== null) clearTimeout(exitTimerRef.current);
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
    };
  }, [dismiss, resetStreamingState]);

  // Listen for streaming partial text from whisper segment callback
  useEffect(() => {
    const unlisten = listen<string>("capsule-partial-text", (event) => {
      setPartialText(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for STT progress (0-100%)
  useEffect(() => {
    const unlisten = listen<number>("capsule-stt-progress", (event) => {
      setSttProgress(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for amplitude from Rust audio thread
  useEffect(() => {
    const unlisten = listen<number>("capsule-amplitude", (event) => {
      cancelAnimationFrame(ampFrameRef.current);
      ampFrameRef.current = requestAnimationFrame(() => {
        setAmplitude(event.payload);
      });
    });

    return () => {
      unlisten.then((fn) => fn());
      cancelAnimationFrame(ampFrameRef.current);
    };
  }, []);

  const isRecording = mode === "recording";
  const isProcessing = mode === "transcribing" || mode === "correcting" || mode === "pasting";
  const isDone = mode === "done";
  const isError = mode === "error";
  const announcement = mode === "idle" ? "" : isRecording ? "Recording" : isError ? errorMsg : isDone ? "Transcription complete" : PROCESSING_LABELS[mode] || "Processing";

  return (
    <div className="flex items-center justify-center h-full w-full">
      <span className="sr-only" role="status" aria-atomic="true">{announcement}</span>
      {mode !== "idle" && <div
        aria-hidden="true"
        className={[
          "capsule-pill",
          "animate-capsule-in",
          dismissing ? "is-dismissing" : "",
          isRecording ? "capsule-recording" : "",
          isProcessing ? "capsule-processing" : "",
          isDone ? "capsule-done" : "",
          isError ? "capsule-error" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="max-w-[340px]">
          {/* Recording */}
          {isRecording && (
            <div className="flex items-center gap-2.5">
              <span className="capsule-rec-dot" />
              <WaveformBars amplitude={amplitude} />
              <span className="text-[11px] font-medium text-text-secondary tabular-nums shrink-0">
                {formatDuration(duration)}
              </span>
            </div>
          )}

          {/* Processing — show streaming text when available */}
          {isProcessing && (
            <div className="flex items-center gap-2">
              <SpinnerIcon />
              {partialText ? (
                <span className="text-[11px] font-medium text-text-primary truncate capsule-text-appear">
                  {partialText.trim()}
                </span>
              ) : (
                <span className="text-[11px] font-medium text-text-secondary">
                  {PROCESSING_LABELS[mode] || "Processing"}
                  {mode === "transcribing" && sttProgress > 0 && sttProgress < 100 && (
                    <span className="text-text-muted ml-1">{sttProgress}%</span>
                  )}
                </span>
              )}
            </div>
          )}

          {/* Done — show transcribed text or checkmark */}
          {isDone && (
            <div className="flex items-center gap-1.5">
              <CheckmarkIcon />
              {doneText ? (
                <span className="text-[11px] font-medium text-success truncate capsule-text-appear">
                  {doneText.trim().slice(0, 60)}{doneText.trim().length > 60 ? "…" : ""}
                </span>
              ) : (
                <span className="text-[11px] font-medium text-success">Done</span>
              )}
            </div>
          )}

          {/* Error */}
          {isError && (
            <div className="flex items-center gap-2">
              <AlertIcon />
              <span title={errorMsg} className="text-[11px] leading-[14px] text-text-secondary whitespace-normal line-clamp-2 max-w-[300px]">
                {errorMsg}
              </span>
            </div>
          )}
        </div>
      </div>}
    </div>
  );
}
