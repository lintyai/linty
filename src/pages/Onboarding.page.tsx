import { BrandMark, SoundPattern } from "@/components/shared/BrandMark.component";
import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { load } from "@tauri-apps/plugin-store";
import { open } from "@tauri-apps/plugin-shell";
import { Mic, Shield, CheckCircle2, ArrowRight, Loader2, ExternalLink, Download, Cloud, AlertCircle, Eye, EyeOff, RefreshCw, Key, Keyboard, Languages } from "lucide-react";
import {
  checkMicrophonePermission,
  requestMicrophonePermission,
  checkAccessibility,
  requestAccessibility,
  reinitFnKeyMonitor,
  openSystemSettings,
} from "@/services/permissions.service";
import { useAppStore } from "@/store/app.store";
import { saveSetting, useSettings } from "@/hooks/useSettings.hook";
import { formatTriggerLabel } from "@/lib/trigger.util";
import { FnKeyConflictWarning } from "@/components/shared/FnKeyConflictWarning.component";
import { TriggerKeyPicker } from "@/components/shared/TriggerKeyPicker.component";
import { cn } from "@/lib/utils";
import { downloadSpeechModel } from "@/services/model-download.service";
import { Select } from "@/components/shared/Select.component";
import { TRANSCRIPTION_LANGUAGES } from "@/lib/languages.util";

type Step = "welcome" | "language" | "microphone" | "accessibility" | "trigger" | "model" | "cloud-setup" | "done";

const STEP_LABELS: Record<Step, string> = {
  welcome: "Welcome",
  language: "Dictation language",
  microphone: "Microphone",
  accessibility: "Accessibility",
  trigger: "Trigger key",
  model: "Speech engine",
  "cloud-setup": "Cloud setup",
  done: "Ready",
};

interface OnboardingPageProps {
  onComplete: () => void;
  startAtMic?: boolean;
}

export function OnboardingPage({ onComplete, startAtMic }: OnboardingPageProps) {
  const [step, setStep] = useState<Step>(startAtMic ? "microphone" : "welcome");
  const [localUnavailable, setLocalUnavailable] = useState(false);
  const [visitedModel, setVisitedModel] = useState(false);
  const [cloudSelected, setCloudSelected] = useState(false);
  const handleLocalUnavailable = useCallback(() => setLocalUnavailable(true), []);

  // Cloud adds a screen after local setup, or replaces it when local support
  // is unavailable before the user reaches the speech-engine step.
  const progressSteps: Step[] = ["welcome", "language", "microphone", "accessibility", "trigger"];
  if (!localUnavailable || visitedModel) progressSteps.push("model");
  if (localUnavailable || cloudSelected) progressSteps.push("cloud-setup");
  progressSteps.push("done");

  return (
    <div className="onboarding-shell">
      {/* Drag region */}
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-20 h-[52px]" />

      <div className="setup-brand"><BrandMark /><span>Linty</span></div>
      <SoundPattern />
      <div className="onboarding-content">
        {step === "welcome" && <WelcomeStep onNext={() => setStep("language")} />}
        {step === "language" && <LanguageStep onNext={() => setStep("microphone")} />}
        {step === "microphone" && (
          <MicrophoneStep onNext={startAtMic ? onComplete : () => setStep("accessibility")} />
        )}
        {step === "accessibility" && (
          <AccessibilityStep onNext={() => setStep("trigger")} />
        )}
        {step === "trigger" && (
          <TriggerStep onNext={() => {
            if (localUnavailable) {
              setStep("cloud-setup");
            } else {
              setVisitedModel(true);
              setStep("model");
            }
          }} />
        )}
        {/* Keep setup mounted from the welcome screen so the download starts immediately. */}
        {!startAtMic && (
          <ModelDownloadStep
            active={step === "model"}
            useLocalModel={step !== "cloud-setup"}
            onLocalUnavailable={handleLocalUnavailable}
            onNext={() => setStep("done")}
            onSkipToCloud={() => {
              setCloudSelected(true);
              setStep("cloud-setup");
            }}
          />
        )}
        {step === "cloud-setup" && (
          <CloudSetupStep onNext={() => setStep("done")} />
        )}
        {step === "done" && <DoneStep onComplete={onComplete} />}

        <div className="onboarding-progress" aria-label="Setup progress">
          <p>{startAtMic ? "Restore microphone access" : `Step ${progressSteps.indexOf(step) + 1} of ${progressSteps.length} · ${STEP_LABELS[step]}`}</p>
          {!startAtMic && <ol>{progressSteps.map((item) => <li key={item} aria-current={item === step ? "step" : undefined}><span className="sr-only">{STEP_LABELS[item]}</span></li>)}</ol>}
        </div>
      </div>
    </div>
  );
}

/* ── Welcome Step ── */

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center text-center animate-page-enter">
      <img src="/brand/icon.svg" alt="" width={80} height={80} className="mb-5" draggable={false} />

      <h1 className="text-[22px] font-bold text-text-primary mb-2">
        Welcome to Linty
      </h1>
      <p className="text-[14px] text-text-secondary leading-relaxed mb-8">
        Voice-to-text that works anywhere on your Mac.
        <br />
        Choose your dictation language, then grant a couple of permissions.
        <br />
        Your default speech model downloads in the background during setup.
      </p>

      <button
        onClick={onNext}
        className={cn(
          "flex items-center gap-2 rounded-xl px-6 py-2.5 text-[14px] font-semibold",
          "bg-accent text-white",
          "hover:bg-accent-soft active:scale-[0.97]",
          "transition-interaction duration-150",
        )}
      >
        Get Started
        <ArrowRight size={16} />
      </button>
    </div>
  );
}

/* ── Dictation Language Step ── */

function LanguageStep({ onNext }: { onNext: () => void }) {
  const { transcriptionLanguage, saveTranscriptionLanguage } = useSettings();
  const [language, setLanguage] = useState(transcriptionLanguage);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);

  const continueSetup = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await saveTranscriptionLanguage(language);
      onNext();
    } catch (error) {
      setError(`Could not save your dictation language. ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col items-center text-center animate-page-enter">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-info/15 mb-5">
        <Languages size={28} className="text-info" />
      </div>
      <h1 className="text-[22px] font-bold text-text-primary mb-2">
        Choose your dictation language
      </h1>
      <p className="text-[14px] text-text-secondary leading-relaxed mb-6">
        Choose the language you usually speak, or use auto-detect.
        <br />
        You can change it anytime in Settings → Language.
      </p>
      <Select
        label="Dictation language"
        value={language}
        options={TRANSCRIPTION_LANGUAGES.map(({ code, label }) => ({ value: code, label }))}
        onChange={value => { setLanguage(value); setError(""); }}
        disabled={saving}
        className="w-full max-w-[340px]"
      />
      <p className="text-[12px] text-text-muted mt-3 mb-6">
        This sets your spoken language. App menus stay in English.
      </p>
      {error && <p role="alert" className="text-[13px] text-error max-w-[380px] mb-4">{error}</p>}
      <button
        onClick={() => { void continueSetup(); }}
        disabled={saving}
        className={cn(
          "flex items-center gap-2 rounded-xl px-6 py-2.5 text-[14px] font-semibold",
          "bg-accent text-white hover:bg-accent-soft active:scale-[0.97]",
          "transition-interaction duration-150 disabled:opacity-50 disabled:cursor-wait",
        )}
      >
        {saving ? <>Saving…<Loader2 size={16} className="animate-spin" /></> : <>Continue<ArrowRight size={16} /></>}
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
              "transition-interaction duration-150",
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
              "transition-interaction duration-150",
            )}
          >
            Open System Settings
            <ExternalLink size={13} />
          </button>

          {showDevHint && (
            <div className="rounded-xl border border-warning/20 bg-warning/5 px-4 py-3 text-left max-w-[340px]">
              <p className="text-[12px] text-text-secondary leading-relaxed">
                <span className="font-medium text-warning">Still waiting?</span>{" "}
                Remove Linty from the Accessibility list, then add it again from Applications and enable access.
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

/* ── Trigger Key Step ── */

function TriggerStep({ onNext }: { onNext: () => void }) {
  const { triggerKey, saveTriggerKey } = useSettings();

  return (
    <div className="flex flex-col items-center text-center animate-page-enter">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-info/15 mb-5">
        <Keyboard size={28} className="text-info" />
      </div>

      <h1 className="text-[22px] font-bold text-text-primary mb-2">
        Choose Your Trigger Key
      </h1>
      <p className="text-[14px] text-text-secondary leading-relaxed mb-6">
        Hold to talk and release to paste. Or double-press to keep listening, then press once to finish.
        <br />
        You can change it anytime from the Shortcuts page.
      </p>

      <TriggerKeyPicker
        value={triggerKey}
        onChange={saveTriggerKey}
        className="mb-6 w-full max-w-[420px]"
      />

      <button
        onClick={onNext}
        className={cn(
          "flex items-center gap-2 rounded-xl px-6 py-2.5 text-[14px] font-semibold",
          "bg-accent text-white",
          "hover:bg-accent-soft active:scale-[0.97]",
          "transition-interaction duration-150",
        )}
      >
        Continue
        <ArrowRight size={16} />
      </button>
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
  /** Inference engine: whisper.cpp GGML file or Parakeet CoreML bundle. */
  backend: "whisper" | "parakeet";
}

interface DownloadProgress {
  filename: string;
  downloaded: number;
  total: number;
  progress: number;
}

/** Onboarding picks the first of these present in the catalog: Parakeet on
 *  Apple Silicon builds, otherwise the whisper Turbo Q5 file. */
const PREFERRED_FILENAMES = ["parakeet-tdt-0.6b-v3", "ggml-large-v3-turbo-q5_0.bin"];

function ModelDownloadStep({
  active,
  useLocalModel,
  onLocalUnavailable,
  onNext,
  onSkipToCloud,
}: {
  active: boolean;
  useLocalModel: boolean;
  onLocalUnavailable: () => void;
  onNext: () => void;
  onSkipToCloud: () => void;
}) {
  const [status, setStatus] = useState<"checking" | "downloading" | "loading" | "ready" | "error">("checking");
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const initialized = useRef(false);
  const mounted = useRef(false);
  const localSetup = useRef(useLocalModel);
  const selection = useRef(0);
  const selectedFilename = useRef<string | null>(null);
  const progressByFilename = useRef(new Map<string, number>());
  const readyDownloads = useRef(new Set<string>());
  const activation = useRef(Promise.resolve());
  // Once cloud setup is chosen, a late local download must not activate itself.
  localSetup.current = localSetup.current && useLocalModel;

  const selectModel = useCallback(async (targetModel: ModelInfo, retry = false) => {
    const request = ++selection.current;
    const isCurrent = () => mounted.current && localSetup.current && request === selection.current;
    selectedFilename.current = targetModel.filename;
    setModel(targetModel);
    setProgress(progressByFilename.current.get(targetModel.filename) ?? 0);
    setErrorMessage("");
    setStatus("downloading");

    try {
      await downloadSpeechModel(targetModel, retry && !readyDownloads.current.has(targetModel.filename));
      readyDownloads.current.add(targetModel.filename);
      if (!isCurrent()) return;

      setStatus("loading");
      // Serialize activation and persistence so an older selection cannot win.
      const loading = activation.current.catch(() => {}).then(async () => {
        if (!isCurrent()) return;
        await invoke("load_local_model", { filename: targetModel.filename });
        if (!isCurrent()) return;
        const store = await load("linty-settings.json", { defaults: {}, autoSave: true });
        if (!isCurrent()) return;
        await store.set("selectedModelFilename", targetModel.filename);
        await store.save();
        if (!isCurrent()) return;
        useAppStore.setState({
          selectedModelFilename: targetModel.filename,
          loadedModelFilename: targetModel.filename,
          isLocalModelDownloaded: true,
        });
        setStatus("ready");
      });
      activation.current = loading;
      await loading;
    } catch (error) {
      if (!isCurrent()) return;
      console.error("[onboarding] Model setup failed:", error);
      setErrorMessage(String(error));
      setStatus("error");
    }
  }, []);

  const initialize = useCallback(async () => {
    setStatus("checking");
    setErrorMessage("");
    try {
      if (!await invoke<boolean>("is_local_stt_available")) {
        setUnavailable(true);
        return;
      }
      const catalog = await invoke<ModelInfo[]>("get_available_models");
      setModels(catalog);
      const saved = useAppStore.getState().selectedModelFilename;
      const recommended = catalog.find((item) => item.filename === saved) ??
        PREFERRED_FILENAMES.map((filename) => catalog.find((item) => item.filename === filename)).find(Boolean) ?? catalog[0];
      if (!recommended) {
        setUnavailable(true);
        return;
      }
      await selectModel(recommended);
    } catch (error) {
      setErrorMessage(String(error));
      setStatus("error");
    }
  }, [selectModel]);

  useEffect(() => {
    mounted.current = true;
    if (!initialized.current) {
      initialized.current = true;
      void initialize();
    }
    return () => { mounted.current = false; };
  }, [initialize]);

  useEffect(() => {
    if (!unavailable) return;
    onLocalUnavailable();
    if (active) onSkipToCloud();
  }, [active, unavailable, onLocalUnavailable, onSkipToCloud]);

  useEffect(() => {
    const unlisten = listen<DownloadProgress>("model-download-progress", ({ payload }) => {
      progressByFilename.current.set(payload.filename, payload.progress);
      if (payload.filename === selectedFilename.current) setProgress(payload.progress);
    });
    return () => { void unlisten.then((stop) => stop()); };
  }, []);

  if (!active) return null;

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
        {status === "ready" ? "Speech Engine Ready" : status === "loading" ? "Preparing Dictation" : "Setting Up Speech Engine"}
      </h1>
      {model && <div className="w-full max-w-[340px] mb-4">
        <Select label="Speech model" value={model.filename} className="[--select-width:100%]"
          disabled={continuing}
          options={models.map((item) => ({ value: item.filename, label: item.name }))}
          onChange={(filename) => {
            const next = models.find((item) => item.filename === filename);
            if (next) void selectModel(next);
          }} />
      </div>}
      <p className="text-[14px] text-text-secondary leading-relaxed mb-6">
        {status === "downloading" && "Downloading the speech model so transcription works offline."}
        {status === "loading" && "Getting your speech model and installed AI cleanup ready for the first dictation. The first preparation can take a moment."}
        {status === "ready" && "Local transcription is ready to go."}
        {status === "error" && "Setup could not finish. Review the message below and try again."}
        {status === "checking" && "Preparing speech engine..."}
      </p>

      {/* Progress bar */}
      {status === "downloading" && (
        <div className="w-full max-w-[300px] mb-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-1 h-2 rounded-full bg-bg-active overflow-hidden">
              <div
                className="progress-fill h-full rounded-full bg-accent"
                style={{ transform: `scaleX(${progress / 100})` }}
              />
            </div>
            <span className="text-[13px] font-medium text-text-secondary tabular-nums w-10 text-right">
              {progress}%
            </span>
          </div>
          {model && (
            <p className="text-[12px] text-text-muted">
              {model.name.replace(/\s*★.*$/, "")} · about {model.size_mb} MB
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
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-2 text-[14px] font-medium text-success">
            <CheckCircle2 size={18} />
            Ready for your first dictation
          </div>
          {errorMessage && <p role="alert" className="text-error text-[13px]">{errorMessage}</p>}
          <button disabled={continuing} onClick={async () => {
            setContinuing(true);
            setErrorMessage("");
            try {
              await saveSetting("sttMode", "local");
              onNext();
            } catch {
              setErrorMessage("Could not save your speech engine. Please try again.");
            } finally {
              setContinuing(false);
            }
          }} className="standard-button primary-button">
            Continue {continuing ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
          </button>
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
            onClick={() => {
              if (!model) { void initialize(); return; }
              if (!readyDownloads.current.has(model.filename)) {
                progressByFilename.current.delete(model.filename);
              }
              void selectModel(model, true);
            }}
            className={cn(
              "flex items-center gap-2 rounded-xl px-5 py-2 text-[13px] font-medium",
              "bg-accent text-white",
              "hover:bg-accent-soft active:scale-[0.97]",
              "transition-interaction duration-150",
            )}
          >
            <RefreshCw size={14} />
            {model && readyDownloads.current.has(model.filename) ? "Retry Preparation" : "Retry Download"}
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
  const [saveError, setSaveError] = useState("");
  const { setSttMode, setGroqApiKey } = useAppStore();

  const handleContinue = async () => {
    if (!apiKey.trim() || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const store = await load("linty-settings.json", { defaults: {}, autoSave: true });
      const previousMode = await store.get<string>("sttMode");
      await invoke("set_groq_api_key", { key: apiKey.trim() });
      setGroqApiKey(apiKey.trim());
      try {
        await store.set("sttMode", "cloud");
        await store.save();
      } catch (error) {
        await store.set("sttMode", previousMode ?? "local");
        throw error;
      }
      setSttMode("cloud");
    } catch (err) {
      console.error("[onboarding] Failed to save cloud settings:", err);
      setSaveError("Could not save your settings. Please try again.");
      setSaving(false);
      return;
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
            aria-label="Groq API key"
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="gsk_..."
            className={cn(
              "w-full rounded-xl border border-border bg-bg-elevated pl-9 pr-10 py-2.5",
              "text-[13px] text-text-primary placeholder:text-text-muted",
              "focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent",
              "transition-interaction duration-150",
            )}
          />
          <button
            type="button"
            aria-label={showKey ? "Hide API key" : "Show API key"}
            data-tooltip={showKey ? "Hide API key" : "Show API key"}
            onClick={() => setShowKey(!showKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>

      {saveError && <p role="alert" className="mb-4 text-error text-[13px]">{saveError}</p>}
      {/* Continue button */}
      <button
        onClick={handleContinue}
        disabled={saving || !apiKey.trim()}
        className={cn(
          "flex items-center gap-2 rounded-xl px-6 py-2.5 text-[14px] font-semibold",
          "bg-accent text-white",
          "hover:bg-accent-soft active:scale-[0.97]",
          "transition-interaction duration-150",
          "disabled:opacity-50 disabled:cursor-not-allowed",
        )}
      >
        {saving ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <>
            Continue
            <ArrowRight size={16} />
          </>
        )}
      </button>

      {!apiKey.trim() && (
        <p className="mt-3 text-[11px] text-text-muted">
          Add an API key to continue with Cloud
        </p>
      )}
    </div>
  );
}

/* ── Done Step ── */

function DoneStep({ onComplete }: { onComplete: () => void }) {
  const triggerKey = useAppStore((s) => s.triggerKey);
  const triggerLabel = formatTriggerLabel(triggerKey);

  return (
    <div className="flex flex-col items-center text-center animate-page-enter">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-success/15 mb-5">
        <CheckCircle2 size={28} className="text-success" />
      </div>

      <h1 className="text-[22px] font-bold text-text-primary mb-2">
        You're All Set
      </h1>
      <p className="text-[14px] text-text-secondary leading-relaxed mb-8">
        Hold <span className="font-medium text-text-primary">{triggerLabel}</span> anywhere to start recording.
        <br />
        Release to transcribe and auto-paste.
      </p>

      <FnKeyConflictWarning className="mb-6 max-w-[400px]" />

      <button
        onClick={onComplete}
        className={cn(
          "flex items-center gap-2 rounded-xl px-6 py-2.5 text-[14px] font-semibold",
          "bg-accent text-white",
          "hover:bg-accent-soft active:scale-[0.97]",
          "transition-interaction duration-150",
        )}
      >
        Start Using Linty
        <ArrowRight size={16} />
      </button>
    </div>
  );
}
