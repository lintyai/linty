import { useCapsuleTheme } from "@/hooks/useCapsuleTheme.hook";
import { useState, useEffect, useRef, useCallback } from "react";
import type { CSSProperties } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Check, LockKeyhole, Square, X, CircleAlert } from "lucide-react";
import lintyFavicon from "../../src-tauri/icons/icon.svg?raw";

type CapsuleMode = "idle" | "preparing" | "recording" | "transcribing" | "correcting" | "pasting" | "done" | "quiet-stop" | "error";
interface CapsuleStatePayload {
  state: CapsuleMode;
  error?: string;
  hands_free?: boolean;
  generation?: number;
}
interface QuietInput { generation: number; quiet_seconds: number }
const BAR_COUNT = 19;
const flatWave = () => Array<number>(BAR_COUNT).fill(0);

function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

function StopCountdown({ seconds }: { seconds: number }) {
  // One continuous sweep per warning, even as native events update the numeral.
  // A resumed recording unmounts this, so the next warning gets a fresh clock.
  const initialSeconds = useRef(seconds).current;
  return <span className="capsule-stop-countdown" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none">
      <circle className="capsule-countdown-track" cx="12" cy="12" r="10.5" />
      <circle
        className="capsule-countdown-ring"
        cx="12" cy="12" r="10.5"
        pathLength="100" strokeDasharray="100" strokeLinecap="round"
        strokeDashoffset={100 - seconds * 10}
        transform="rotate(-90 12 12)"
        style={{ "--countdown-start": 100 - initialSeconds * 10, animationDuration: `${initialSeconds}s` } as CSSProperties}
      />
    </svg>
    <span className="capsule-countdown-number"><span className="capsule-countdown-label">{seconds}<span className="capsule-countdown-unit">s</span></span></span>
  </span>;
}

export function CapsulePanel() {
  useCapsuleTheme();
  const [mode, setMode] = useState<CapsuleMode>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [levels, setLevels] = useState(flatWave);
  const [duration, setDuration] = useState(0);
  const [handsFree, setHandsFree] = useState(false);
  const [quietSeconds, setQuietSeconds] = useState(0);
  const [dismissing, setDismissing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const modeRef = useRef<CapsuleMode>("idle");
  const generationRef = useRef<number | undefined>(undefined);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const dismiss = useCallback(() => {
    if (exitTimerRef.current !== null) return;
    setDismissing(true);
    if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
    exitTimerRef.current = setTimeout(() => {
      exitTimerRef.current = null;
      modeRef.current = "idle";
      setMode("idle");
      setDismissing(false);
      invoke("hide_capsule").catch(() => {});
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180);
  }, []);

  useEffect(() => {
    const listeners = [
      listen<CapsuleStatePayload>("capsule-state", ({ payload }) => {
        const { state, error, hands_free, generation } = payload;
        if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
        if (state === "idle") { dismiss(); return; }
        if (exitTimerRef.current !== null) {
          clearTimeout(exitTimerRef.current);
          exitTimerRef.current = null;
        }
        const newRecording = state === "recording" && (modeRef.current !== "recording" || generationRef.current !== generation);
        modeRef.current = state;
        setMode(state);
        setDismissing(false);
        setErrorMsg(error || "Something went wrong");
        if (newRecording) {
          generationRef.current = generation;
          setDuration(0);
          setLevels(flatWave());
          setQuietSeconds(0);
          setStopping(false);
          const started = Date.now();
          if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
          durationIntervalRef.current = setInterval(() => setDuration((Date.now() - started) / 1000), 1000);
        }
        if (state === "recording") setHandsFree(!!hands_free);
        else if (durationIntervalRef.current) {
          clearInterval(durationIntervalRef.current);
          durationIntervalRef.current = null;
        }
        if (state === "done" || state === "quiet-stop") dismissTimerRef.current = setTimeout(dismiss, state === "done" ? 1100 : 2200);
        if (state === "error") dismissTimerRef.current = setTimeout(dismiss, 6000);
      }),
      listen<number>("capsule-amplitude", ({ payload }) => {
        if (modeRef.current !== "recording") return;
        // Map microphone RMS logarithmically (-90 to -6 dBFS). The previous
        // linear gain saturated at 0.042 RMS, flattening ordinary louder speech.
        const target = Number.isFinite(payload) && payload > 0
          ? Math.max(0, Math.min(1, (20 * Math.log10(payload) + 90) / 84)) : 0;
        setLevels(previous => {
          const last = previous[previous.length - 1];
          // A quick attack and softer release follow the voice without jitter.
          const smoothed = last + (target - last) * (target > last ? 0.75 : 0.4);
          return [...previous.slice(1), smoothed < 0.01 ? 0 : smoothed];
        });
      }),
      listen<QuietInput>("recording-quiet", ({ payload }) => {
        if (modeRef.current === "recording" && payload.generation === generationRef.current) setQuietSeconds(payload.quiet_seconds);
      }),
    ];
    return () => {
      for (const listener of listeners) void listener.then(off => off());
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      if (exitTimerRef.current !== null) clearTimeout(exitTimerRef.current);
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
    };
  }, [dismiss]);

  const isRecording = mode === "recording";
  const isProcessing = ["preparing", "transcribing", "correcting", "pasting"].includes(mode);
  const isQuiet = isRecording && quietSeconds >= 20;
  const isSpeaking = isRecording && !isQuiet && levels.slice(-3).some(level => level > 0.02);
  // The three favicon strokes retain their staggered, centered movement, but
  // every height now comes from recent microphone input instead of a timed loop.
  const brandLevels = isRecording && !isQuiet
    ? [levels[BAR_COUNT - 3], levels[BAR_COUNT - 1], levels[BAR_COUNT - 2]] : [0, 0, 0];
  const remainingSeconds = Math.max(0, Math.min(10, 30 - quietSeconds));
  const announcement = mode === "idle" ? "" : isQuiet ? "Stopping automatically. Speak to keep listening, or click the countdown to finish now."
    : isRecording ? handsFree ? "Hands-free listening. Double-press your trigger to finish." : "Listening. Release your trigger to finish."
    : mode === "error" ? errorMsg : mode === "done" ? "Dictation complete" : mode === "quiet-stop" ? "No input. Listening stopped."
    : mode === "preparing" ? "Preparing dictation" : "Processing dictation";

  return (
    <div className="capsule-stage">
      <span className="sr-only" role="status" aria-atomic="true">{announcement}</span>
      {mode !== "idle" && <div className={`capsule-pill capsule-${mode}${isQuiet ? " capsule-quiet" : ""}${dismissing ? " is-dismissing" : ""}`}>
        <span
          className={`capsule-favicon${isRecording ? " is-listening" : ""}${isSpeaking ? " is-speaking" : ""}`}
          role="img" aria-label="Linty"
          style={{
            "--voice-left": isRecording ? 0.35 + brandLevels[0] * 0.65 : 1,
            "--voice-center": isRecording ? 0.35 + brandLevels[1] * 0.65 : 1,
            "--voice-right": isRecording ? 0.35 + brandLevels[2] * 0.65 : 1,
          } as CSSProperties}
          // Inline the same generated favicon artwork so its three strokes can move.
          dangerouslySetInnerHTML={{ __html: lintyFavicon }}
        />
        <span className="capsule-divider" aria-hidden="true" />
        <div className="capsule-content" key={isQuiet ? "quiet" : isRecording ? "recording" : isProcessing ? "processing" : mode}>
          {isRecording && (isQuiet ? <span className="capsule-quiet-message" aria-hidden="true">Stopping…</span> : <>
            <div className="capsule-wave" aria-hidden="true">
              {levels.map((level, i) => <span key={i} style={{ transform: `scaleY(${0.1 + level * 0.9})`, opacity: 0.4 + level * 0.6 }} />)}
            </div>
            <span className="capsule-time" aria-hidden="true">{handsFree && <LockKeyhole size={10} strokeWidth={1.6} />}{formatDuration(duration)}</span>
          </>)}
          {isProcessing && <div className="capsule-feedback" aria-hidden="true"><span className="capsule-orbit" /><span>{mode === "preparing" ? "Getting ready" : "Processing"}</span></div>}
          {mode === "done" && <div className="capsule-feedback capsule-success" aria-hidden="true"><Check size={16} strokeWidth={1.8} /><span>Done</span></div>}
          {mode === "quiet-stop" && <span className="capsule-message" aria-hidden="true">No input · stopped</span>}
          {mode === "error" && <div className="capsule-error-message"><CircleAlert size={15} aria-hidden="true" /><span title={errorMsg}>{errorMsg}</span></div>}
        </div>
        {isRecording && <button
          className={`capsule-action${isQuiet ? " capsule-action-countdown" : ""}`}
          aria-label="Finish dictation"
          aria-describedby={isQuiet ? "capsule-stop-description" : undefined}
          title={isQuiet ? `Finish now · stopping in ${remainingSeconds}s` : "Finish dictation"}
          disabled={stopping} onClick={() => {
          setStopping(true);
          void emit("capsule-stop", { generation: generationRef.current }).catch(() => setStopping(false));
        }}>
          {isQuiet ? <StopCountdown seconds={remainingSeconds} /> : <Square size={10} fill="currentColor" strokeWidth={0} />}
        </button>}
        {isQuiet && <span id="capsule-stop-description" className="sr-only">Automatically stops in {remainingSeconds} seconds. Click to finish now.</span>}
        {(mode === "error" || mode === "quiet-stop") && <button className="capsule-action" aria-label="Dismiss" onClick={dismiss}><X size={12} /></button>}
      </div>}
    </div>
  );
}
