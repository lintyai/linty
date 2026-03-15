import { useState, useEffect, useCallback } from "react";
import { Mic, Shield, CheckCircle2, ArrowRight, Loader2, ExternalLink } from "lucide-react";
import {
  checkMicrophonePermission,
  requestMicrophonePermission,
  checkAccessibility,
  requestAccessibility,
  reinitFnKeyMonitor,
  openSystemSettings,
} from "@/services/permissions.service";
import { cn } from "@/lib/utils";

type Step = "welcome" | "microphone" | "accessibility" | "done";

interface OnboardingPageProps {
  onComplete: () => void;
  startAtMic?: boolean;
}

export function OnboardingPage({ onComplete, startAtMic }: OnboardingPageProps) {
  const [step, setStep] = useState<Step>(startAtMic ? "microphone" : "welcome");

  return (
    <div className="flex h-full items-center justify-center bg-bg">
      {/* Drag region */}
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-20 h-[52px]" />

      <div className="w-full max-w-[420px] px-6">
        {step === "welcome" && <WelcomeStep onNext={() => setStep("microphone")} />}
        {step === "microphone" && (
          <MicrophoneStep onNext={() => setStep("accessibility")} />
        )}
        {step === "accessibility" && (
          <AccessibilityStep onNext={() => setStep("done")} />
        )}
        {step === "done" && <DoneStep onComplete={onComplete} />}

        {/* Progress dots */}
        <div className="mt-8 flex items-center justify-center gap-2">
          {(["welcome", "microphone", "accessibility", "done"] as Step[]).map((s) => (
            <div
              key={s}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                s === step
                  ? "w-6 bg-accent"
                  : "w-1.5 bg-bg-active",
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Welcome Step ── */

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center text-center animate-page-enter">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/15 mb-5">
        <Mic size={28} className="text-accent" />
      </div>

      <h1 className="text-[22px] font-bold text-text-primary mb-2">
        Welcome to Linty
      </h1>
      <p className="text-[14px] text-text-secondary leading-relaxed mb-8">
        Voice-to-text that works anywhere on your Mac.
        <br />
        We need a couple of permissions to get started.
      </p>

      <button
        onClick={onNext}
        className={cn(
          "flex items-center gap-2 rounded-xl px-6 py-2.5 text-[14px] font-semibold",
          "bg-accent text-white",
          "hover:bg-accent-soft active:scale-[0.97]",
          "transition-all duration-150",
        )}
      >
        Get Started
        <ArrowRight size={16} />
      </button>
    </div>
  );
}

/* ── Microphone Step ── */

function MicrophoneStep({ onNext }: { onNext: () => void }) {
  const [status, setStatus] = useState<"checking" | "requesting" | "granted" | "denied">("checking");

  // Check status then always attempt a request — handles stale TCC entries
  // where authorizationStatus returns "denied" but no real entry exists.
  useEffect(() => {
    const init = async () => {
      const result = await checkMicrophonePermission().catch(() => "not_determined");
      if (result === "authorized") {
        setStatus("granted");
        return;
      }

      // Always try requesting — if truly denied, requestAccess returns false
      // immediately (no prompt). If TCC was cleared/stale, it may prompt.
      setStatus("requesting");
      const granted = await requestMicrophonePermission().catch(() => false);
      setStatus(granted ? "granted" : "denied");
    };
    init();
  }, []);

  // Auto-advance after grant
  useEffect(() => {
    if (status === "granted") {
      const timer = setTimeout(onNext, 800);
      return () => clearTimeout(timer);
    }
  }, [status, onNext]);

  // Poll for denied → granted (user may go to System Settings and toggle)
  useEffect(() => {
    if (status !== "denied") return;
    const interval = setInterval(async () => {
      const result = await checkMicrophonePermission().catch(() => "denied");
      if (result === "authorized") setStatus("granted");
    }, 2000);
    return () => clearInterval(interval);
  }, [status]);

  return (
    <div className="flex flex-col items-center text-center animate-page-enter">
      <div className={cn(
        "flex h-16 w-16 items-center justify-center rounded-2xl mb-5 transition-colors duration-300",
        status === "granted" ? "bg-success/15" : "bg-info/15",
      )}>
        {status === "granted" ? (
          <CheckCircle2 size={28} className="text-success" />
        ) : (
          <Mic size={28} className="text-info" />
        )}
      </div>

      <h1 className="text-[22px] font-bold text-text-primary mb-2">
        Microphone Access
      </h1>
      <p className="text-[14px] text-text-secondary leading-relaxed mb-8">
        Linty needs your microphone to capture speech for transcription.
      </p>

      {(status === "checking" || status === "requesting") && (
        <div className="flex items-center gap-2.5 text-[13px] text-text-muted">
          <Loader2 size={16} className="animate-spin" />
          {status === "checking" ? "Checking permission..." : "Waiting for your response..."}
        </div>
      )}

      {status === "granted" && (
        <div className="flex items-center gap-2 text-[14px] font-medium text-success">
          <CheckCircle2 size={18} />
          Microphone access granted
        </div>
      )}

      {status === "denied" && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-[13px] text-warning">
            Microphone access was denied. Open System Settings, find Linty in the Microphone list, and toggle it off then back on.
          </p>
          <button
            onClick={() => openSystemSettings("microphone")}
            className={cn(
              "flex items-center gap-1.5 rounded-xl px-5 py-2 text-[13px] font-medium",
              "bg-accent text-white",
              "hover:bg-accent-soft active:scale-[0.97]",
              "transition-all duration-150",
            )}
          >
            Open System Settings
            <ExternalLink size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Accessibility Step ── */

function AccessibilityStep({ onNext }: { onNext: () => void }) {
  const [status, setStatus] = useState<"checking" | "prompting" | "granted" | "waiting">("checking");
  const [showDevHint, setShowDevHint] = useState(false);

  // Show dev hint after 30s of waiting
  useEffect(() => {
    if (status !== "waiting") return;
    const timer = setTimeout(() => setShowDevHint(true), 30_000);
    return () => clearTimeout(timer);
  }, [status]);

  const checkStatus = useCallback(async () => {
    const granted = await checkAccessibility().catch(() => false);
    if (granted) {
      setStatus("granted");
    } else {
      setStatus("prompting");
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // Prompt for accessibility
  useEffect(() => {
    if (status !== "prompting") return;

    const doPrompt = async () => {
      const granted = await requestAccessibility().catch(() => false);
      setStatus(granted ? "granted" : "waiting");
    };
    doPrompt();
  }, [status]);

  // Auto-advance + reinit fn key monitor after grant
  useEffect(() => {
    if (status === "granted") {
      // Reinit the fn key monitor now that accessibility is granted
      reinitFnKeyMonitor().catch(console.error);
      const timer = setTimeout(onNext, 800);
      return () => clearTimeout(timer);
    }
  }, [status, onNext]);

  // Poll for granted (user toggling in System Settings)
  useEffect(() => {
    if (status !== "waiting") return;
    const interval = setInterval(async () => {
      const granted = await checkAccessibility().catch(() => false);
      if (granted) setStatus("granted");
    }, 1500);
    return () => clearInterval(interval);
  }, [status]);

  return (
    <div className="flex flex-col items-center text-center animate-page-enter">
      <div className={cn(
        "flex h-16 w-16 items-center justify-center rounded-2xl mb-5 transition-colors duration-300",
        status === "granted" ? "bg-success/15" : "bg-info/15",
      )}>
        {status === "granted" ? (
          <CheckCircle2 size={28} className="text-success" />
        ) : (
          <Shield size={28} className="text-info" />
        )}
      </div>

      <h1 className="text-[22px] font-bold text-text-primary mb-2">
        Accessibility Permission
      </h1>
      <p className="text-[14px] text-text-secondary leading-relaxed mb-8">
        Required for the fn key push-to-talk shortcut and auto-pasting transcriptions.
      </p>

      {status === "checking" && (
        <div className="flex items-center gap-2.5 text-[13px] text-text-muted">
          <Loader2 size={16} className="animate-spin" />
          Checking permission...
        </div>
      )}

      {status === "granted" && (
        <div className="flex items-center gap-2 text-[14px] font-medium text-success">
          <CheckCircle2 size={18} />
          Accessibility granted
        </div>
      )}

      {(status === "prompting" || status === "waiting") && (
        <div className="flex flex-col items-center gap-4">
          {status === "waiting" && (
            <div className="rounded-xl border border-border-subtle bg-bg-secondary px-4 py-3 text-left max-w-[340px]">
              <p className="text-[12px] text-text-secondary leading-relaxed">
                <span className="font-medium text-text-primary">System Settings</span> should have opened.
                Find <span className="font-medium text-text-primary">Linty</span> in the Accessibility list and toggle it on.
              </p>
            </div>
          )}

          <div className="flex items-center gap-2.5 text-[13px] text-text-muted">
            <Loader2 size={16} className="animate-spin" />
            Waiting for you to enable accessibility...
          </div>

          <button
            onClick={() =>
              openSystemSettings("accessibility")
            }
            className={cn(
              "flex items-center gap-1.5 rounded-xl px-5 py-2 text-[13px] font-medium",
              "bg-bg-elevated border border-border text-text-secondary",
              "hover:bg-bg-hover hover:text-text-primary active:scale-[0.97]",
              "transition-all duration-150",
            )}
          >
            Open System Settings
            <ExternalLink size={13} />
          </button>

          {showDevHint && (
            <div className="rounded-xl border border-warning/20 bg-warning/5 px-4 py-3 text-left max-w-[340px]">
              <p className="text-[12px] text-text-secondary leading-relaxed">
                <span className="font-medium text-warning">Dev build?</span>{" "}
                Ad-hoc signed builds lose accessibility grants on every recompile.
                Remove Linty from the list, then re-add it — or sign with a Developer ID to persist grants.
              </p>
            </div>
          )}

          <button
            onClick={onNext}
            className="text-[12px] text-text-muted hover:text-text-secondary transition-colors duration-150"
          >
            Skip for now
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Done Step ── */

function DoneStep({ onComplete }: { onComplete: () => void }) {
  return (
    <div className="flex flex-col items-center text-center animate-page-enter">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-success/15 mb-5">
        <CheckCircle2 size={28} className="text-success" />
      </div>

      <h1 className="text-[22px] font-bold text-text-primary mb-2">
        You're All Set
      </h1>
      <p className="text-[14px] text-text-secondary leading-relaxed mb-8">
        Hold the <span className="font-medium text-text-primary">fn</span> key anywhere to start recording.
        <br />
        Release to transcribe and auto-paste.
      </p>

      <button
        onClick={onComplete}
        className={cn(
          "flex items-center gap-2 rounded-xl px-6 py-2.5 text-[14px] font-semibold",
          "bg-accent text-white",
          "hover:bg-accent-soft active:scale-[0.97]",
          "transition-all duration-150",
        )}
      >
        Start Using Linty
        <ArrowRight size={16} />
      </button>
    </div>
  );
}
