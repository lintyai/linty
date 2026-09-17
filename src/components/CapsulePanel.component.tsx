import { useCapsuleTheme } from "@/hooks/useCapsuleTheme.hook";
import { useState, useEffect, useRef, useCallback } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Check, LockKeyhole, Square, X, CircleAlert } from "lucide-react";

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
        const level = Number.isFinite(payload) ? Math.sqrt(Math.min(Math.max(0, payload) * 24, 1)) : 0;
        // An actual input history. Silence settles to a fine dotted line; there
        // is no perpetual drawing loop or synthetic movement when input is quiet.
        setLevels(previous => [...previous.slice(1), level]);
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
  const announcement = mode === "idle" ? "" : isQuiet ? "Still talking? Speak to keep listening. Stops after 30 seconds without input."
    : isRecording ? handsFree ? "Hands-free listening. Double-press your trigger to finish." : "Listening. Release your trigger to finish."
    : mode === "error" ? errorMsg : mode === "done" ? "Dictation complete" : mode === "quiet-stop" ? "No input. Listening stopped."
    : mode === "preparing" ? "Preparing dictation" : "Processing dictation";

  return (
    <div className="capsule-stage">
      <span className="sr-only" role="status" aria-atomic="true">{announcement}</span>
      {mode !== "idle" && <div className={`capsule-pill capsule-${mode}${isQuiet ? " capsule-quiet" : ""}${dismissing ? " is-dismissing" : ""}`}>
        <img className="capsule-favicon" src="/brand/favicon.png" alt="Linty" width="22" height="22" draggable="false" />
        <span className="capsule-divider" aria-hidden="true" />
        <div className="capsule-content" key={isQuiet ? "quiet" : isRecording ? "recording" : isProcessing ? "processing" : mode}>
          {isRecording && (isQuiet ? <div className="capsule-quiet-message" aria-hidden="true">
            <span>Still talking?</span><span className="capsule-countdown">Stopping in {Math.max(0, 30 - quietSeconds)}s</span>
          </div> : <>
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
        {isRecording && <button className="capsule-action" aria-label="Finish dictation" title="Finish dictation" disabled={stopping} onClick={() => {
          setStopping(true);
          void emit("capsule-stop", { generation: generationRef.current }).catch(() => setStopping(false));
        }}><Square size={10} fill="currentColor" strokeWidth={0} /></button>}
        {(mode === "error" || mode === "quiet-stop") && <button className="capsule-action" aria-label="Dismiss" onClick={dismiss}><X size={12} /></button>}
      </div>}
    </div>
  );
}
