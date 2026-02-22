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

    let frame = 0;
    const draw = () => {
      frame++;
      ctx.clearRect(0, 0, totalWidth, height);

      const amp = ampRef.current;
      const t = frame / 60; // ~1 second per unit at 60fps

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
        ctx.fillStyle = `rgba(226, 53, 53, ${opacity})`;
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
  const [mode, setMode] = useState<CapsuleMode>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [amplitude, setAmplitude] = useState(0);
  const [duration, setDuration] = useState(0);
  const [dismissing, setDismissing] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ampFrameRef = useRef(0);
  const durationStartRef = useRef(0);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const dismiss = useCallback(() => {
    setDismissing(true);
    setTimeout(() => {
      setMode("idle");
      setDismissing(false);
      setErrorMsg("");
      setAmplitude(0);
      setDuration(0);
      invoke("hide_capsule").catch(() => {});
    }, 300);
  }, []);

  // Listen for capsule state from main window
  useEffect(() => {
    const unlisten = listen<CapsuleStatePayload>("capsule-state", (event) => {
      const { state, error } = event.payload;

      // Clear any pending dismiss timer
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
        dismissTimerRef.current = null;
      }

      if (state === "idle") {
        dismiss();
        return;
      }

      setDismissing(false);
      setMode(state);

      if (state === "recording") {
        durationStartRef.current = Date.now();
        if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = setInterval(() => {
          setDuration((Date.now() - durationStartRef.current) / 1000);
        }, 100);
      } else {
        if (durationIntervalRef.current) {
          clearInterval(durationIntervalRef.current);
          durationIntervalRef.current = null;
        }
      }

      if (state === "done") {
        // Brief checkmark flash, then dismiss
        dismissTimerRef.current = setTimeout(dismiss, 1200);
      }

      if (state === "error") {
        setErrorMsg(error || "Something went wrong");
        dismissTimerRef.current = setTimeout(dismiss, 4000);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
    };
  }, [dismiss]);

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

  if (mode === "idle") return null;

  const isRecording = mode === "recording";
  const isProcessing = mode === "transcribing" || mode === "correcting" || mode === "pasting";
  const isDone = mode === "done";
  const isError = mode === "error";

  return (
    <div className="flex items-center justify-center h-full w-full">
      <div
        className={[
          "capsule-pill",
          dismissing ? "animate-capsule-out" : "animate-capsule-in",
          isRecording ? "capsule-recording" : "",
          isProcessing ? "capsule-processing" : "",
          isDone ? "capsule-done" : "",
          isError ? "capsule-error" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
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

        {/* Processing */}
        {isProcessing && (
          <div className="flex items-center gap-2">
            <SpinnerIcon />
            <span className="text-[11px] font-medium text-text-secondary">
              {PROCESSING_LABELS[mode] || "Processing"}
            </span>
          </div>
        )}

        {/* Done — just checkmark, no text */}
        {isDone && (
          <div className="flex items-center gap-1.5">
            <CheckmarkIcon />
            <span className="text-[11px] font-medium text-success">Done</span>
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="flex items-center gap-2">
            <AlertIcon />
            <span className="text-[10px] text-text-secondary truncate max-w-[200px]">
              {errorMsg}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
