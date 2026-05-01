import { useState, useEffect, useRef } from "react";
import {
  Cpu,
  Eye,
  EyeOff,
  Cloud,
  Check,
  Loader2,
  Play,
  Download,
  HardDrive,
  ExternalLink,
  Sun,
  Moon,
  Monitor,
  Languages,
  ChevronDown,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { useSettings } from "@/hooks/useSettings.hook";
import { useModelDownload } from "@/hooks/useModelDownload.hook";
import { Toggle } from "@/components/shared/Toggle.component";
import { SegmentedControl } from "@/components/shared/SegmentedControl.component";
import { SectionHeader, SectionCard, SettingRow, ValueBadge } from "@/components/shared/SettingsLayout.component";
import { cn } from "@/lib/utils";
import { DEFAULT_CORRECTION_PROMPT } from "@/services/correction.service";
import type { SttMode, ThemePreference } from "@/store/slices/settings.slice";

const THEME_SEGMENTS = [
  { value: "light" as ThemePreference, label: "Light", icon: <Sun size={13} /> },
  { value: "dark" as ThemePreference, label: "Dark", icon: <Moon size={13} /> },
  { value: "system" as ThemePreference, label: "System", icon: <Monitor size={13} /> },
];

const ENGINE_SEGMENTS = [
  { value: "local" as SttMode, label: "Local", icon: <Cpu size={13} /> },
  { value: "cloud" as SttMode, label: "Cloud", icon: <Cloud size={13} /> },
];

export function SettingsPage() {
  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div
        data-tauri-drag-region
        className="flex h-[52px] shrink-0 items-center px-6"
      >
        <h1
          className="text-[16px] font-semibold text-text-primary tracking-[-0.01em]"
          data-tauri-drag-region
        >
          Settings
        </h1>
      </div>

      {/* All sections stacked */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-[480px] flex flex-col gap-10">
          <div className="animate-slide-up" style={{ animationDelay: "0ms", animationFillMode: "both" }}>
            <GeneralSection />
          </div>
          <div className="animate-slide-up" style={{ animationDelay: "40ms", animationFillMode: "both" }}>
            <AudioSection />
          </div>
          <div className="animate-slide-up" style={{ animationDelay: "80ms", animationFillMode: "both" }}>
            <ModelsSection />
          </div>
          <div className="animate-slide-up" style={{ animationDelay: "120ms", animationFillMode: "both" }}>
            <LanguageSection />
          </div>
          <div className="animate-slide-up" style={{ animationDelay: "160ms", animationFillMode: "both" }}>
            <AppearanceSection />
          </div>
          <div className="animate-slide-up" style={{ animationDelay: "200ms", animationFillMode: "both" }}>
            <PrivacySection />
          </div>
        </div>
      </div>
    </div>
  );
}

function GeneralSection() {
  const { correctionEnabled, correctionPrompt, saveCorrectionEnabled, saveCorrectionPrompt } = useSettings();
  const [correctionInput, setCorrectionInput] = useState(correctionPrompt);
  const correctionInitRef = useRef(false);

  useEffect(() => {
    if (correctionPrompt && !correctionInitRef.current) {
      setCorrectionInput(correctionPrompt);
      correctionInitRef.current = true;
    } else if (correctionPrompt !== undefined) {
      setCorrectionInput(correctionPrompt);
    }
  }, [correctionPrompt]);

  const handleCorrectionBlur = () => {
    if (correctionInput !== correctionPrompt) saveCorrectionPrompt(correctionInput);
  };

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title="General" />

      <SectionCard>
        <Toggle
          enabled={correctionEnabled}
          onChange={saveCorrectionEnabled}
          label="LLM Correction"
          description="Fix grammar and punctuation using AI after transcription"
        />
      </SectionCard>

      {correctionEnabled && (
        <SectionCard className="animate-fade-in">
          <div className="flex flex-col gap-3 p-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[12px] font-medium text-text-secondary">
                  Correction Instructions
                </label>
                {correctionInput !== DEFAULT_CORRECTION_PROMPT && (
                  <button
                    onClick={() => {
                      setCorrectionInput(DEFAULT_CORRECTION_PROMPT);
                      saveCorrectionPrompt(DEFAULT_CORRECTION_PROMPT);
                    }}
                    className="text-[11px] text-accent hover:text-accent-soft transition-colors"
                  >
                    Reset to default
                  </button>
                )}
              </div>
              <textarea
                value={correctionInput || DEFAULT_CORRECTION_PROMPT}
                onChange={(e) => setCorrectionInput(e.target.value)}
                onBlur={handleCorrectionBlur}
                rows={5}
                spellCheck={false}
                className={cn(
                  "w-full rounded-[var(--radius-sm)] bg-bg-input px-3 py-2.5",
                  "text-[13px] text-text-primary placeholder:text-text-muted",
                  "outline-none ring-1 ring-border-subtle transition-all duration-150 resize-none",
                  "focus:ring-2 focus:ring-accent/20 focus:bg-bg-elevated",
                )}
              />
              <span className="text-[11px] text-text-muted leading-snug">
                System prompt for the LLM correction step
              </span>
            </div>
          </div>
        </SectionCard>
      )}

      <SectionCard>
        <SettingRow
          label="After transcription"
          description="What happens with the transcribed text"
          right={<ValueBadge>Paste to active app</ValueBadge>}
        />
      </SectionCard>
    </div>
  );
}

function AudioSection() {
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title="Audio & Input" />

      <SectionCard>
        <SettingRow
          label="Input device"
          description="System default microphone"
          right={<ValueBadge>Default</ValueBadge>}
          className="border-b border-border-subtle"
        />
        <SettingRow
          label="Sample quality"
          description="Higher quality uses more resources"
          right={<ValueBadge>16 kHz</ValueBadge>}
        />
      </SectionCard>
    </div>
  );
}

function ModelsSection() {
  const { groqApiKey, sttMode, whisperPrompt, saveGroqApiKey, saveSttMode, saveWhisperPrompt } = useSettings();
  const {
    models,
    downloadedModels,
    isDownloading,
    downloadProgress,
    downloadingFilename,
    isLocalAvailable,
    loadedModel,
    downloadModel,
    loadModel,
  } = useModelDownload();

  const [showKey, setShowKey] = useState(false);
  const [keyInput, setKeyInput] = useState(groqApiKey);
  const [whisperInput, setWhisperInput] = useState(whisperPrompt);
  const [loadingModel, setLoadingModel] = useState<string | null>(null);

  useEffect(() => {
    setKeyInput(groqApiKey);
  }, [groqApiKey]);

  useEffect(() => {
    setWhisperInput(whisperPrompt);
  }, [whisperPrompt]);

  const handleKeyBlur = () => {
    if (keyInput !== groqApiKey) saveGroqApiKey(keyInput);
  };

  const handleWhisperBlur = () => {
    if (whisperInput !== whisperPrompt) saveWhisperPrompt(whisperInput);
  };

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title="Speech Engine" />

      <SegmentedControl
        segments={ENGINE_SEGMENTS}
        value={sttMode}
        onChange={saveSttMode}
        className="self-start"
      />

      {sttMode === "cloud" && (
        <div className="flex flex-col gap-4 animate-fade-in">
          <SectionCard>
            <div className="flex flex-col gap-3 p-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium text-text-secondary">
                  Groq API Key
                </label>
                <div className="relative">
                  <input
                    type={showKey ? "text" : "password"}
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    onBlur={handleKeyBlur}
                    onKeyDown={(e) =>
                      e.key === "Enter" && (e.target as HTMLInputElement).blur()
                    }
                    placeholder="gsk_..."
                    spellCheck={false}
                    autoComplete="off"
                    className={cn(
                      "w-full rounded-[var(--radius-sm)] bg-bg-input px-3 py-[7px] pr-9",
                      "text-[13px] text-text-primary placeholder:text-text-muted",
                      "outline-none ring-1 ring-border-subtle transition-all duration-150",
                      "focus:ring-2 focus:ring-accent/20 focus:bg-bg-elevated",
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
                  >
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <button
                onClick={() => open("https://console.groq.com/keys")}
                className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-secondary transition-colors self-start"
              >
                Get a free API key at console.groq.com
                <ExternalLink size={10} />
              </button>
            </div>
          </SectionCard>

          <SectionCard>
            <div className="flex flex-col gap-3 p-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium text-text-secondary">
                  Transcription Prompt
                </label>
                <textarea
                  value={whisperInput}
                  onChange={(e) => setWhisperInput(e.target.value)}
                  onBlur={handleWhisperBlur}
                  rows={3}
                  spellCheck={false}
                  placeholder="e.g., Linty, Tauri, React, TypeScript..."
                  className={cn(
                    "w-full rounded-[var(--radius-sm)] bg-bg-input px-3 py-2.5",
                    "text-[13px] text-text-primary placeholder:text-text-muted",
                    "outline-none ring-1 ring-border-subtle transition-all duration-150 resize-none",
                    "focus:ring-2 focus:ring-accent/20 focus:bg-bg-elevated",
                  )}
                />
                <span className="text-[11px] text-text-muted leading-snug">
                  Guide vocabulary and style (e.g., technical terms, names)
                </span>
              </div>
            </div>
          </SectionCard>

          <SectionCard>
            <SettingRow
              label="Transcription model"
              description="Whisper Large V3 via Groq"
              right={
                <span className="flex items-center gap-1.5 text-[12px] text-text-secondary bg-bg-hover rounded-[var(--radius-sm)] px-2.5 py-1">
                  <Cloud size={11} />
                  whisper-large-v3
                </span>
              }
            />
          </SectionCard>

          <div className="flex items-start gap-2.5 rounded-[var(--radius-md)] bg-info-glow/50 ring-1 ring-info/8 px-4 py-3">
            <Cloud size={13} className="text-info shrink-0 mt-px" />
            <p className="text-[12px] text-text-secondary leading-relaxed">
              Audio is sent to Groq API for transcription. Processing is fast (~1-2s) with a free tier available.
            </p>
          </div>
        </div>
      )}

      {sttMode === "local" && (
        <div className="flex flex-col gap-4 animate-fade-in">
          {!isLocalAvailable ? (
            <div className="flex items-start gap-2.5 rounded-[var(--radius-md)] bg-warning-glow/50 ring-1 ring-warning/8 px-4 py-3">
              <HardDrive size={13} className="text-warning shrink-0 mt-px" />
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-medium text-text-primary">
                  Local STT not available
                </span>
                <span className="text-[12px] text-text-muted leading-relaxed">
                  Rebuild with{" "}
                  <code className="rounded bg-bg-hover px-1 py-0.5 text-[11px] font-medium">
                    --features local-stt
                  </code>{" "}
                  to enable on-device transcription.
                </span>
              </div>
            </div>
          ) : (
            <>
              <SectionCard>
                <div className="flex flex-col">
                  {models.map((model, i) => {
                    const isDownloaded = downloadedModels.has(model.filename);
                    const isThisDownloading =
                      isDownloading && downloadingFilename === model.filename;

                    return (
                      <div
                        key={model.filename}
                        className={cn(
                          "flex items-center justify-between px-4 py-3.5",
                          i < models.length - 1 && "border-b border-border-subtle",
                        )}
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[13px] text-text-primary">
                            {model.name}
                          </span>
                          <span className="text-[11px] text-text-muted">
                            {model.description}
                          </span>
                        </div>

                        {isThisDownloading ? (
                          <div className="flex items-center gap-2.5">
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-bg-active">
                              <div
                                className="h-full rounded-full bg-accent transition-all duration-300"
                                style={{ width: `${downloadProgress}%` }}
                              />
                            </div>
                            <span className="text-[11px] tabular-nums text-text-muted w-9 text-right">
                              {downloadProgress}%
                            </span>
                          </div>
                        ) : isDownloaded ? (
                          loadedModel === model.filename ? (
                            <span className="flex items-center gap-1.5 text-[12px] font-medium text-success">
                              <Check size={13} />
                              Active
                            </span>
                          ) : (
                            <button
                              onClick={async () => {
                                setLoadingModel(model.filename);
                                try {
                                  await loadModel(model.filename);
                                } finally {
                                  setLoadingModel(null);
                                }
                              }}
                              disabled={loadingModel !== null}
                              className={cn(
                                "flex h-[30px] items-center gap-1.5 rounded-[var(--radius-sm)] px-3 text-[12px] font-medium text-success",
                                "ring-1 ring-success/20 hover:bg-success/8 active:scale-95 transition-all duration-150",
                                "disabled:cursor-not-allowed disabled:opacity-40",
                              )}
                            >
                              {loadingModel === model.filename ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Play size={12} />
                              )}
                              Load
                            </button>
                          )
                        ) : (
                          <button
                            onClick={() => downloadModel(model)}
                            disabled={isDownloading}
                            className={cn(
                              "flex h-[30px] items-center gap-1.5 rounded-[var(--radius-sm)] px-3 text-[12px] font-medium text-text-secondary",
                              "ring-1 ring-border hover:bg-bg-hover hover:text-text-primary active:scale-95 transition-all duration-150",
                              "disabled:cursor-not-allowed disabled:opacity-40",
                            )}
                          >
                            <Download size={12} />
                            Download
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </SectionCard>

              <div className="flex items-start gap-2.5 rounded-[var(--radius-md)] bg-success-glow/50 ring-1 ring-success/8 px-4 py-3">
                <Cpu size={13} className="text-success shrink-0 mt-px" />
                <p className="text-[12px] text-text-secondary leading-relaxed">
                  Audio stays on your device. Processing takes ~2-5s depending on model size and hardware.
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const LANGUAGES = [
  { code: "auto", label: "Auto-detect" },
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "ja", label: "Japanese" },
  { code: "zh", label: "Chinese" },
  { code: "ko", label: "Korean" },
  { code: "pt", label: "Portuguese" },
  { code: "ru", label: "Russian" },
  { code: "ar", label: "Arabic" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "tr", label: "Turkish" },
  { code: "pl", label: "Polish" },
  { code: "sv", label: "Swedish" },
  { code: "th", label: "Thai" },
  { code: "vi", label: "Vietnamese" },
  { code: "id", label: "Indonesian" },
];

function LanguageSection() {
  const { transcriptionLanguage, translateToEnglish, saveTranscriptionLanguage, saveTranslateToEnglish } = useSettings();

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title="Language" />

      <SectionCard>
        <div className="flex items-center justify-between px-4 py-3.5">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[13px] text-text-primary">Transcription language</span>
            <span className="text-[12px] text-text-muted leading-snug">
              Set the spoken language or let Whisper auto-detect
            </span>
          </div>
          <div className="shrink-0 ml-4 relative">
            <select
              value={transcriptionLanguage}
              onChange={(e) => saveTranscriptionLanguage(e.target.value)}
              className={cn(
                "appearance-none rounded-[var(--radius-sm)] bg-bg-input pl-3 pr-8 py-[7px]",
                "text-[13px] text-text-primary",
                "outline-none ring-1 ring-border-subtle transition-all duration-150 cursor-pointer",
                "focus:ring-2 focus:ring-accent/20 focus:bg-bg-elevated",
              )}
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
            <ChevronDown
              size={13}
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted"
            />
          </div>
        </div>
      </SectionCard>

      {transcriptionLanguage !== "en" && (
        <SectionCard className="animate-fade-in">
          <Toggle
            enabled={translateToEnglish}
            onChange={saveTranslateToEnglish}
            label="Translate to English"
            description="Translate speech to English regardless of spoken language"
          />
        </SectionCard>
      )}

      <div className="flex items-start gap-2.5 rounded-[var(--radius-md)] bg-bg-elevated ring-1 ring-border-subtle px-4 py-3">
        <Languages size={13} className="text-text-muted shrink-0 mt-px" />
        <p className="text-[12px] text-text-secondary leading-relaxed">
          {transcriptionLanguage === "auto"
            ? "Whisper will automatically detect the spoken language. For best accuracy, select the language explicitly."
            : translateToEnglish
              ? "Speech will be transcribed and translated to English."
              : `Speech will be transcribed in ${LANGUAGES.find((l) => l.code === transcriptionLanguage)?.label ?? transcriptionLanguage}.`}
        </p>
      </div>
    </div>
  );
}

function PrivacySection() {
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title="Privacy & Storage" />

      <SectionCard>
        <SettingRow
          label="Transcript retention"
          description="How long to keep transcription history"
          right={<ValueBadge>Forever</ValueBadge>}
        />
      </SectionCard>

      <SectionCard>
        <Toggle
          enabled={true}
          onChange={() => {}}
          label="Store transcripts locally"
          description="Save all transcriptions on this device"
        />
      </SectionCard>

      <SectionCard>
        <Toggle
          enabled={false}
          onChange={() => {}}
          label="Anonymous usage statistics"
          description="Help improve Linty. No audio or transcript data is ever collected."
        />
      </SectionCard>
    </div>
  );
}

function AppearanceSection() {
  const { theme, saveTheme } = useSettings();

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title="Appearance" />

      <SectionCard>
        <SettingRow
          label="Theme"
          description="Choose light, dark, or follow system"
          right={
            <SegmentedControl
              segments={THEME_SEGMENTS}
              value={theme}
              onChange={saveTheme}
            />
          }
          className="border-b border-border-subtle"
        />
        <SettingRow
          label="Accent color"
          description="Used for recording indicator and highlights"
          right={<div className="h-5 w-5 rounded-full bg-accent shadow-[0_0_0_2px_var(--color-bg-elevated),0_0_0_3px_var(--color-accent)]" />}
        />
      </SectionCard>
    </div>
  );
}
