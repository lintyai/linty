import { Select } from "@/components/shared/Select.component";
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
  Languages,
  Mic,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { useSettings } from "@/hooks/useSettings.hook";
import { useAppStore } from "@/store/app.store";
import { useModelDownload } from "@/hooks/useModelDownload.hook";
import { Toggle } from "@/components/shared/Toggle.component";
import { SegmentedControl } from "@/components/shared/SegmentedControl.component";
import {
  SectionHeader,
  SectionCard,
  SettingRow,
  ValueBadge,
} from "@/components/shared/SettingsLayout.component";
import { cn } from "@/lib/utils";
import {
  AUTO_LANGUAGE,
  TRANSCRIPTION_LANGUAGES,
  languageLabel,
} from "@/lib/languages.util";
import { DEFAULT_CORRECTION_PROMPT } from "@/services/correction.service";
import { SETTINGS_SECTIONS } from "@/config/navigation.config";
import {
  PageLayout,
  PageHeader,
  SectionHeading,
} from "@/components/shared/PageLayout.component";
import { ProcessingDetails } from "@/components/settings/ProcessingDetails.component";
import { ThemePreview } from "@/components/settings/ThemePreview.component";
import { BrandMark } from "@/components/shared/BrandMark.component";
import { HistoryStorage } from "@/components/settings/HistoryStorage.component";
import { modelLabel } from "@/lib/model-labels.util";
import type { SttMode, ThemePreference } from "@/store/slices/settings.slice";

const THEME_SEGMENTS = [
  {
    value: "light" as ThemePreference,
    label: "Light",
    icon: <ThemePreview theme="light" />,
  },
  {
    value: "dark" as ThemePreference,
    label: "Dark",
    icon: <ThemePreview theme="dark" />,
  },
  {
    value: "system" as ThemePreference,
    label: "System",
    icon: <ThemePreview theme="system" />,
  },
];

const ENGINE_SEGMENTS = [
  { value: "local" as SttMode, label: "Local", icon: <Cpu size={13} /> },
  { value: "cloud" as SttMode, label: "Cloud", icon: <Cloud size={13} /> },
];

const IDLE_UNLOAD_OPTIONS = [
  { value: 0, label: "Never" },
  { value: 5, label: "After 5 minutes" },
  { value: 15, label: "After 15 minutes" },
  { value: 30, label: "After 30 minutes" },
  { value: 60, label: "After 1 hour" },
];

export function SettingsPage() {
  const section = useAppStore((s) => s.settingsSection);
  const [visited, setVisited] = useState(() => new Set([section]));
  useEffect(() => {
    setVisited((old) => (old.has(section) ? old : new Set([...old, section])));
  }, [section]);
  const metadata = SETTINGS_SECTIONS.find((item) => item.id === section)!;
  return (
    <PageLayout reading className={`settings-page settings-${section}`}>
      <PageHeader page="settings" title={metadata.label} description={metadata.description} />
      <div className="settings-pane">
        {(visited.has("general") || section === "general") && (
          <div hidden={section !== "general"}>
            <GeneralSection />
          </div>
        )}
        {(visited.has("audio") || section === "audio") && (
          <div hidden={section !== "audio"}>
            <AudioSection />
          </div>
        )}
        {(visited.has("models") || section === "models") && (
          <div hidden={section !== "models"}>
            <ModelsSection />
          </div>
        )}
        {(visited.has("language") || section === "language") && (
          <div hidden={section !== "language"}>
            <LanguageSection />
          </div>
        )}
        {(visited.has("appearance") || section === "appearance") && (
          <div hidden={section !== "appearance"}>
            <AppearanceSection />
          </div>
        )}
        {(visited.has("privacy") || section === "privacy") && (
          <div hidden={section !== "privacy"}>
            <PrivacySection />
          </div>
        )}
      </div>
      <p className="preferences-footnote">Changes are saved automatically.</p>
    </PageLayout>
  );
}

/* ═══ General ═══ */
function GeneralSection() {
  const {
    correctionEnabled,
    correctionPrompt,
    saveCorrectionEnabled,
    saveCorrectionPrompt,
  } = useSettings();
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
    if (correctionInput !== correctionPrompt)
      saveCorrectionPrompt(correctionInput);
  };

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title="General" />

      <SectionCard tone="inset">
        <div className="setting-feature-icon">
          <Sparkles size={23} />
        </div>
        <Toggle
          enabled={correctionEnabled}
          onChange={saveCorrectionEnabled}
          label="Refine transcription"
          description="Fix grammar and punctuation with Groq. Transcribed text is sent to the cloud."
        />
      </SectionCard>

      {correctionEnabled && (
        <SectionCard className="animate-fade-in">
          <div className="flex flex-col gap-3 p-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="field-label">
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
                aria-label="Correction instructions"
                value={correctionInput || DEFAULT_CORRECTION_PROMPT}
                onChange={(e) => setCorrectionInput(e.target.value)}
                onBlur={handleCorrectionBlur}
                rows={5}
                spellCheck={false}
                className={cn(
                  "w-full rounded-lg border border-border bg-bg-input px-3 py-2",
                  "text-[13px] text-text-primary placeholder:text-text-muted",
                  "outline-none transition-interaction duration-150 resize-none",
                  "focus:border-border-focus focus:bg-bg-elevated",
                )}
              />
              <span className="text-[11px] text-text-muted leading-snug">
                Instructions used to refine your transcribed text.
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

/* ═══ Audio ═══ */
function AudioSection() {
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title="Audio & Input" />
      <div className="settings-feature">
        <span className="feature-symbol">
          <Mic size={35} />
        </span>
        <div>
          <span className="eyebrow">INPUT SOURCE</span>
          <h3>System microphone</h3>
          <p>Follows the microphone selected in macOS.</p>
        </div>
      </div>

      <SectionCard>
        <SettingRow
          label="Input device"
          description="System default microphone"
          right={<ValueBadge>Default</ValueBadge>}
          className="border-b border-border-subtle"
        />
        <SettingRow
          label="Sample quality"
          description="Optimized for speech recognition"
          right={<ValueBadge>16 kHz</ValueBadge>}
        />
      </SectionCard>
    </div>
  );
}

/* ═══ Models ═══ */
function ModelsSection() {
  const {
    groqApiKey,
    sttMode,
    whisperPrompt,
    saveGroqApiKey,
    saveSttMode,
    saveWhisperPrompt,
    modelIdleUnloadMinutes,
    saveModelIdleUnloadMinutes,
  } = useSettings();
  const {
    models,
    downloadedModels,
    isDownloading,
    downloadProgress,
    downloadingFilename,
    isLocalAvailable,
    loadedModel,
    loadingFilename,
    downloadModel,
    loadModel,
  } = useModelDownload();

  const [showKey, setShowKey] = useState(false);
  const [keyInput, setKeyInput] = useState(groqApiKey);
  const [whisperInput, setWhisperInput] = useState(whisperPrompt);

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
        label="Speech engine"
        segments={ENGINE_SEGMENTS}
        value={sttMode}
        onChange={saveSttMode}
        className="self-start"
      />

      {/* Cloud settings */}
      {sttMode === "cloud" && (
        <div className="flex flex-col gap-4 animate-fade-in">
          <SectionCard>
            <div className="flex flex-col gap-3 p-4">
              <div className="flex flex-col gap-1.5">
                <label className="field-label">
                  Groq API Key
                </label>
                <div className="relative">
                  <input
                    aria-label="Groq API key"
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
                      "w-full rounded-lg border border-border bg-bg-input px-3 py-[7px] pr-9",
                      "text-[13px] text-text-primary placeholder:text-text-muted",
                      "outline-none transition-interaction duration-150",
                      "focus:border-border-focus focus:bg-bg-elevated",
                    )}
                  />
                  <button
                    type="button"
                    aria-label={showKey ? "Hide API key" : "Show API key"}
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
                  >
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <button
                onClick={() => open("https://console.groq.com/keys")}
                className="text-link self-start"
              >
                Get a free API key at console.groq.com
                <ExternalLink size={12} />
              </button>
            </div>
          </SectionCard>

          <SectionCard>
            <div className="flex flex-col gap-3 p-4">
              <div className="flex flex-col gap-1.5">
                <label className="field-label">
                  Transcription Prompt
                </label>
                <textarea
                  aria-label="Transcription prompt"
                  value={whisperInput}
                  onChange={(e) => setWhisperInput(e.target.value)}
                  onBlur={handleWhisperBlur}
                  rows={3}
                  spellCheck={false}
                  placeholder="e.g., Linty, Tauri, React, TypeScript..."
                  className={cn(
                    "w-full rounded-lg border border-border bg-bg-input px-3 py-2",
                    "text-[13px] text-text-primary placeholder:text-text-muted",
                    "outline-none transition-interaction duration-150 resize-none",
                    "focus:border-border-focus focus:bg-bg-elevated",
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
              description="Whisper Large V3 Turbo via Groq"
              right={
                <span className="flex items-center gap-1.5 text-[12px] text-text-secondary bg-bg-hover rounded-md px-2.5 py-1">
                  <Cloud size={11} />
                  whisper-large-v3-turbo
                </span>
              }
            />
          </SectionCard>

          <div className="flex items-start gap-2.5 rounded-[10px] bg-info-glow border border-info/10 px-4 py-3">
            <Cloud size={13} className="text-info shrink-0 mt-px" />
            <p className="text-[12px] text-text-secondary leading-relaxed">
              Audio is sent to Groq API for transcription. Processing is fast
              (~1-2s) with a free tier available.
            </p>
          </div>
        </div>
      )}

      {/* Local settings */}
      {sttMode === "local" && (
        <div className="flex flex-col gap-4 animate-fade-in">
          {!isLocalAvailable ? (
            <div className="flex items-start gap-2.5 rounded-[10px] bg-warning-glow border border-warning/10 px-4 py-3">
              <HardDrive size={13} className="text-warning shrink-0 mt-px" />
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-medium text-text-primary">
                  On-device transcription unavailable
                </span>
                <span className="text-[12px] text-text-muted leading-relaxed">
                  This build does not include on-device transcription. Choose
                  Cloud to continue, or install the full macOS version.
                </span>
              </div>
            </div>
          ) : (
            <>
              {loadedModel && (
                <div className="current-model">
                  <div>
                    <span className="eyebrow">ACTIVE MODEL</span>
                    <h3>{modelLabel(loadedModel)}</h3>
                    <p>
                      On-device transcription · Ready for your next dictation
                    </p>
                  </div>
                  <span>
                    <Check size={13} /> Loaded
                  </span>
                </div>
              )}
              <SectionHeading title="Available models" />
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
                          "flex items-center justify-between px-4 py-3",
                          i < models.length - 1 &&
                            "border-b border-border-subtle",
                        )}
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="field-label">
                            {model.name}
                          </span>
                          <span className="text-[11px] text-text-muted">
                            {model.description}
                          </span>
                        </div>

                        {isThisDownloading ? (
                          <div className="flex items-center gap-2.5">
                            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-border">
                              <div
                                className="progress-fill h-full rounded-full bg-accent"
                                style={{ transform: `scaleX(${downloadProgress / 100})` }}
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
                                try {
                                  await loadModel(model.filename);
                                } catch {
                                  useAppStore.getState().addToast({
                                    type: "error",
                                    message:
                                      "Could not load model. Try again or choose another model.",
                                  });
                                }
                              }}
                              disabled={loadingFilename !== null}
                              className={cn(
                                "flex h-[30px] items-center gap-1.5 rounded-md border border-success/20 px-3 text-[12px] font-medium text-success",
                                "hover:bg-success/8 active:scale-[0.97] transition-interaction duration-150",
                                "disabled:cursor-not-allowed disabled:opacity-40",
                              )}
                            >
                              {loadingFilename === model.filename ? (
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
                              "flex h-[30px] items-center gap-1.5 rounded-md border border-border px-3 text-[12px] font-medium text-text-secondary",
                              "hover:bg-bg-hover hover:text-text-primary active:scale-[0.97] transition-interaction duration-150",
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

              <SectionCard>
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="field-label">
                      Unload model when idle
                    </span>
                    <span className="text-[12px] text-text-muted leading-snug">
                      Frees memory after inactivity — reloads automatically on
                      next dictation
                    </span>
                  </div>
                  <div className="shrink-0 ml-4 relative">
                    <Select
                      label="Unload model when idle"
                      value={modelIdleUnloadMinutes}
                      onChange={saveModelIdleUnloadMinutes}
                      options={IDLE_UNLOAD_OPTIONS}
                    />
                  </div>
                </div>
              </SectionCard>

              <div className="flex items-start gap-2.5 rounded-[10px] bg-success-glow border border-success/10 px-4 py-3">
                <Cpu size={13} className="text-success shrink-0 mt-px" />
                <p className="text-[12px] text-text-secondary leading-relaxed">
                  Audio stays on your device. Whisper runs on the GPU; Parakeet
                  runs on the Neural Engine and is usually under a second.
                </p>
              </div>
            </>
          )}
        </div>
      )}
      <ProcessingDetails />
    </div>
  );
}

/* ═══ Language ═══ */

function LanguageSection() {
  const { transcriptionLanguage, saveTranscriptionLanguage } = useSettings();

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title="Language" />
      <div className="language-feature">
        <Languages size={29} />
        <span className="eyebrow">TRANSCRIPTION LANGUAGE</span>
        <h3>{languageLabel(transcriptionLanguage)}</h3>
        <p>
          {transcriptionLanguage === AUTO_LANGUAGE
            ? "Let the speech engine recognize the language you’re speaking."
            : "A familiar language. Your own words."}
        </p>
      </div>

      <SectionCard>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="field-label">
              Transcription language
            </span>
            <span className="text-[12px] text-text-muted leading-snug">
              Set the spoken language or let the speech engine auto-detect
            </span>
          </div>
          <div className="shrink-0 ml-4 relative">
            <Select
              label="Transcription language"
              value={transcriptionLanguage}
              onChange={saveTranscriptionLanguage}
              options={TRANSCRIPTION_LANGUAGES.map((language) => ({
                value: language.code,
                label: language.label,
              }))}
            />
          </div>
        </div>
      </SectionCard>

      <div className="flex items-start gap-2.5 rounded-[10px] bg-bg-elevated border border-border-subtle px-4 py-3">
        <Languages size={13} className="text-text-muted shrink-0 mt-px" />
        <p className="text-[12px] text-text-secondary leading-relaxed">
          {transcriptionLanguage === AUTO_LANGUAGE
            ? "The speech engine will detect the spoken language automatically. For best accuracy, select it explicitly. Every listed language works with both Parakeet and Whisper."
            : `Speech will be transcribed in ${languageLabel(transcriptionLanguage)}.`}
        </p>
      </div>
    </div>
  );
}

/* ═══ Privacy ═══ */
function PrivacySection() {
  const {
    trackApplicationUsage,
    saveTrackApplicationUsage,
    dictionaryEnabled,
    saveDictionaryEnabled,
    autoLearnWords,
    saveAutoLearnWords,
    observeCorrections,
    saveObserveCorrections,
  } = useSettings();
  const addToast = useAppStore((s) => s.addToast);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const savePreference = (work: Promise<void>) =>
    work.catch(() =>
      addToast({ type: "error", message: "Could not save that preference." }),
    );
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title="Privacy & Storage" />
      <div className="privacy-feature">
        <ShieldCheck size={27} />
        <div>
          <h3>Your words are yours.</h3>
          <p>
            History and your dictionary are saved on this Mac. Cloud
            transcription sends audio to Groq; refinement sends transcribed text
            when enabled.
          </p>
        </div>
      </div>
      <SectionCard>
        <Toggle
          enabled={trackApplicationUsage}
          onChange={(enabled) => {
            saveTrackApplicationUsage(enabled).catch(() =>
              addToast({
                type: "error",
                message: "Could not save app attribution preference.",
              }),
            );
          }}
          label="Attribute dictations to apps"
          description="Save the active app’s name when dictation starts. See words and dictation time per app in your dashboard."
        />
      </SectionCard>
      <SectionCard>
        <div className="border-b border-border-subtle">
          <Toggle
            enabled={dictionaryEnabled}
            onChange={(enabled) =>
              savePreference(saveDictionaryEnabled(enabled))
            }
            label="Apply my dictionary"
            description="Fix words you have corrected before and teach the speech engine your words. Parakeet fetches a 100 MB vocabulary model the first time."
          />
        </div>
        <div className="border-b border-border-subtle">
          <Toggle
            enabled={autoLearnWords}
            onChange={(enabled) => savePreference(saveAutoLearnWords(enabled))}
            label="Learn new words automatically"
            description="Add a correction to the dictionary without asking once it has been seen twice, or once for names."
          />
        </div>
        <Toggle
          enabled={observeCorrections}
          onChange={(enabled) =>
            savePreference(saveObserveCorrections(enabled))
          }
          label="Learn from corrections in other apps"
          description="For a minute after each paste, notice words you fix in the field you dictated into. Uses the Accessibility permission Linty already has; the field’s text is compared in memory and never saved. Works in most apps, not all."
        />
        <div className="px-4 pb-3">
          <button
            className="text-link"
            onClick={() => setCurrentView("dictionary")}
          >
            Open your dictionary
          </button>
        </div>
      </SectionCard>
      <HistoryStorage />
      <div className="rounded-xl border border-border-subtle bg-bg-elevated px-4 py-3 text-[12px] leading-relaxed text-text-secondary">
        App attribution records only the app name and identifier, once per
        dictation. It does not read window titles, browser URLs, or track time
        spent in other apps. Turning it off affects new dictations; deleting
        history removes its app statistics too.
      </div>
    </div>
  );
}

/* ═══ Appearance ═══ */
function AppearanceSection() {
  const { theme, saveTheme } = useSettings();

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title="Appearance" />
      <div className="appearance-specimen">
        <BrandMark />
        <p>
          A little warmth.
          <br />
          <span>A place for your words.</span>
        </p>
        <span className="heading-rule" aria-hidden="true" />
      </div>

      <SectionCard>
        <SectionHeading
          title="Choose your appearance"
          description="Light, dark, or follow your Mac."
        />
        <SegmentedControl
          label="Appearance"
          className="theme-picker"
          segments={THEME_SEGMENTS}
          value={theme}
          onChange={saveTheme}
        />
        <SettingRow
          label="Accent color"
          description="Teal, for interactions and recording"
          right={
            <div className="h-5 w-5 rounded-full bg-accent border border-accent-soft" />
          }
        />
      </SectionCard>
    </div>
  );
}
