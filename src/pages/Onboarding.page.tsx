import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { load } from "@tauri-apps/plugin-store";
import { open } from "@tauri-apps/plugin-shell";
import { Mic, Shield, CheckCircle2, ArrowRight, Loader2, ExternalLink, Download, Cloud, AlertCircle, Eye, EyeOff, RefreshCw, Key } from "lucide-react";
import {
  checkMicrophonePermission,
  requestMicrophonePermission,
  checkAccessibility,
  requestAccessibility,
  reinitFnKeyMonitor,
  openSystemSettings,
} from "@/services/permissions.service";
import { useAppStore } from "@/store/app.store";
import { cn } from "@/lib/utils";

type Step = "welcome" | "microphone" | "accessibility" | "model" | "cloud-setup" | "done";

// Steps used for progress dots — cloud-setup shares the "model" dot position
const PROGRESS_STEPS: Step[] = ["welcome", "microphone", "accessibility", "model", "done"];

interface OnboardingPageProps {
  onComplete: () => void;
  startAtMic?: boolean;
}

export function OnboardingPage({ onComplete, startAtMic }: OnboardingPageProps) {
  const [step, setStep] = useState<Step>(startAtMic ? "microphone" : "welcome");

  // Map cloud-setup to model position for progress dots
  const activeProgressStep = step === "cloud-setup" ? "model" : step;

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
          <AccessibilityStep onNext={() => setStep("model")} />
        )}
        {step === "model" && (
          <ModelDownloadStep
            onNext={() => setStep("done")}
            onSkipToCloud={() => setStep("cloud-setup")}
          />
        )}
        {step === "cloud-setup" && (
          <CloudSetupStep onNext={() => setStep("done")} />
        )}
        {step === "done" && <DoneStep onComplete={onComplete} />}

        {/* Progress dots */}
        <div className="mt-8 flex items-center justify-center gap-2">
          {PROGRESS_STEPS.map((s) => (
            <div
              key={s}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                s === activeProgressStep
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

/* ── Model Download Step ── */

interface ModelInfo {
  name: string;
  filename: string;
  url: string;
  size_mb: number;
  description: string;
}

interface DownloadProgress {
  downloaded: number;
  total: number;
  progress: number;
}

const RECOMMENDED_FILENAME = "ggml-large-v3-turbo-q5_0.bin";

function ModelDownloadStep({
  onNext,
  onSkipToCloud,
}: {
  onNext: () => void;
  onSkipToCloud: () => void;
}) {
  const [status, setStatus] = useState<"checking" | "downloading" | "loading" | "ready" | "error">("checking");
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [model, setModel] = useState<ModelInfo | null>(null);

  const { setLoadedModelFilename, setSelectedModelFilename, setIsLocalModelDownloaded, setSttMode } = useAppStore();

  const persistSettings = useCallback(async (filename: string) => {
    setSelectedModelFilename(filename);
    setLoadedModelFilename(filename);
    setIsLocalModelDownloaded(true);
    setSttMode("local");
    try {
      const store = await load("linty-settings.json", { defaults: {}, autoSave: true });
      await store.set("selectedModelFilename", filename);
      await store.set("sttMode", "local");
    } catch (err) {
      console.error("[onboarding] Failed to persist model settings:", err);
    }
  }, [setSelectedModelFilename, setLoadedModelFilename, setIsLocalModelDownloaded, setSttMode]);

  const startDownloadAndLoad = useCallback(async (targetModel: ModelInfo) => {
    setStatus("downloading");
    setProgress(0);
    setErrorMessage("");

    try {
      await invoke<string>("download_model_file", {
        url: targetModel.url,
        filename: targetModel.filename,
      });

      // Download complete — now load into GPU
      setStatus("loading");
      await invoke("load_whisper_model", { filename: targetModel.filename });
      await persistSettings(targetModel.filename);
      setStatus("ready");
    } catch (err) {
      console.error("[onboarding] Download/load failed:", err);
      setErrorMessage(String(err));
      setStatus("error");
    }
  }, [persistSettings]);

  // On mount: check local-stt availability, find model, check if already downloaded
  useEffect(() => {
    const init = async () => {
      try {
        const isAvailable = await invoke<boolean>("is_local_stt_available");
        if (!isAvailable) {
          // local-stt not compiled in — skip this step entirely
          onSkipToCloud();
          return;
        }

        const models = await invoke<ModelInfo[]>("get_available_models");
        const recommended = models.find((m) => m.filename === RECOMMENDED_FILENAME) ?? models[0];
        if (!recommended) {
          onSkipToCloud();
          return;
        }
        setModel(recommended);

        // Check if already downloaded
        const exists = await invoke<boolean>("check_model_exists", { filename: recommended.filename });
        if (exists) {
          // Already downloaded — load and auto-advance
          setStatus("loading");
          await invoke("load_whisper_model", { filename: recommended.filename });
          await persistSettings(recommended.filename);
          setStatus("ready");
          return;
        }

        // Start download automatically
        startDownloadAndLoad(recommended);
      } catch (err) {
        console.error("[onboarding] Model init failed:", err);
        setErrorMessage(String(err));
        setStatus("error");
      }
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for download progress events
  useEffect(() => {
    const unlistenProgress = listen<DownloadProgress>("model-download-progress", (event) => {
      setProgress(event.payload.progress);
    });

    return () => {
      unlistenProgress.then((fn) => fn());
    };
  }, []);

  // Auto-advance when ready
  useEffect(() => {
    if (status === "ready") {
      const timer = setTimeout(onNext, 800);
      return () => clearTimeout(timer);
    }
  }, [status, onNext]);

  return (
    <div className="flex flex-col items-center text-center animate-page-enter">
      <div className={cn(
        "flex h-16 w-16 items-center justify-center rounded-2xl mb-5 transition-colors duration-300",
        status === "ready" ? "bg-success/15" : status === "error" ? "bg-error/15" : "bg-accent/15",
      )}>
        {status === "ready" ? (
          <CheckCircle2 size={28} className="text-success" />
        ) : status === "error" ? (
          <AlertCircle size={28} className="text-error" />
        ) : (
          <Download size={28} className="text-accent" />
        )}
      </div>

      <h1 className="text-[22px] font-bold text-text-primary mb-2">
        {status === "ready" ? "Speech Engine Ready" : status === "loading" ? "Loading Model" : "Setting Up Speech Engine"}
      </h1>
      <p className="text-[14px] text-text-secondary leading-relaxed mb-6">
        {status === "downloading" && "Downloading the speech model so transcription works offline."}
        {status === "loading" && "Loading the model into memory..."}
        {status === "ready" && "Local transcription is ready to go."}
        {status === "error" && "Something went wrong. Check your internet connection and try again."}
        {status === "checking" && "Preparing speech engine..."}
      </p>

      {/* Progress bar */}
      {status === "downloading" && (
        <div className="w-full max-w-[300px] mb-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-1 h-2 rounded-full bg-bg-active overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-[13px] font-medium text-text-secondary tabular-nums w-10 text-right">
              {progress}%
            </span>
          </div>
          {model && (
            <p className="text-[12px] text-text-muted">
              {model.filename} · {model.size_mb} MB
            </p>
          )}
        </div>
      )}

      {/* Loading spinner */}
      {(status === "loading" || status === "checking") && (
        <div className="flex items-center gap-2.5 text-[13px] text-text-muted mb-4">
          <Loader2 size={16} className="animate-spin" />
          {status === "checking" ? "Checking..." : "Initializing speech engine..."}
        </div>
      )}

      {/* Ready state */}
      {status === "ready" && (
        <div className="flex items-center gap-2 text-[14px] font-medium text-success">
          <CheckCircle2 size={18} />
          Model loaded successfully
        </div>
      )}

      {/* Error state */}
      {status === "error" && (
        <div className="flex flex-col items-center gap-3">
          {errorMessage && (
            <div className="rounded-xl border border-error/20 bg-error/5 px-4 py-3 text-left max-w-[340px]">
              <p className="text-[12px] text-text-secondary leading-relaxed break-words">
                {errorMessage}
              </p>
            </div>
          )}
          <button
            onClick={() => model && startDownloadAndLoad(model)}
            className={cn(
              "flex items-center gap-2 rounded-xl px-5 py-2 text-[13px] font-medium",
              "bg-accent text-white",
              "hover:bg-accent-soft active:scale-[0.97]",
              "transition-all duration-150",
            )}
          >
            <RefreshCw size={14} />
            Retry Download
          </button>
        </div>
      )}

      {/* Skip to cloud */}
      {status !== "ready" && (
        <button
          onClick={onSkipToCloud}
          className="mt-4 flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text-secondary transition-colors duration-150"
        >
          <Cloud size={12} />
          Skip — use cloud instead
        </button>
      )}
    </div>
  );
}

/* ── Cloud Setup Step ── */

function CloudSetupStep({ onNext }: { onNext: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const { setSttMode, setGroqApiKey } = useAppStore();

  const handleContinue = async () => {
    setSaving(true);
    try {
      const store = await load("linty-settings.json", { defaults: {}, autoSave: true });
      setSttMode("cloud");
      await store.set("sttMode", "cloud");
      if (apiKey.trim()) {
        setGroqApiKey(apiKey.trim());
        await store.set("groqApiKey", apiKey.trim());
      }
    } catch (err) {
      console.error("[onboarding] Failed to save cloud settings:", err);
    }
    setSaving(false);
    onNext();
  };

  return (
    <div className="flex flex-col items-center text-center animate-page-enter">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/15 mb-5">
        <Cloud size={28} className="text-accent" />
      </div>

      <h1 className="text-[22px] font-bold text-text-primary mb-2">
        Cloud Transcription
      </h1>
      <p className="text-[14px] text-text-secondary leading-relaxed mb-6">
        Linty uses Groq for fast cloud transcription. You'll need a free API key.
      </p>

      {/* Instructions */}
      <div className="w-full rounded-xl border border-border-subtle bg-bg-secondary px-4 py-3 text-left mb-5">
        <ol className="text-[12px] text-text-secondary leading-relaxed space-y-1.5 list-decimal list-inside">
          <li>
            Go to{" "}
            <button
              onClick={() => open("https://console.groq.com/keys")}
              className="inline-flex items-center gap-0.5 text-accent hover:underline"
            >
              console.groq.com/keys
              <ExternalLink size={10} />
            </button>
          </li>
          <li>Sign up or log in (it's free)</li>
          <li>Create an API key and paste it below</li>
        </ol>
      </div>

      {/* API Key input */}
      <div className="w-full mb-5">
        <div className="relative">
          <Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="gsk_..."
            className={cn(
              "w-full rounded-xl border border-border bg-bg-elevated pl-9 pr-10 py-2.5",
              "text-[13px] text-text-primary placeholder:text-text-muted",
              "focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent",
              "transition-all duration-150",
            )}
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>

      {/* Continue button */}
      <button
        onClick={handleContinue}
        disabled={saving}
        className={cn(
          "flex items-center gap-2 rounded-xl px-6 py-2.5 text-[14px] font-semibold",
          "bg-accent text-white",
          "hover:bg-accent-soft active:scale-[0.97]",
          "transition-all duration-150",
          "disabled:opacity-50 disabled:cursor-not-allowed",
        )}
      >
        {saving ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <>
            {apiKey.trim() ? "Continue" : "I'll add it later"}
            <ArrowRight size={16} />
          </>
        )}
      </button>

      {!apiKey.trim() && (
        <p className="mt-3 text-[11px] text-text-muted">
          You can add the API key later in Settings
        </p>
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
