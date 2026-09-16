import { useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { useAppStore } from "@/store/app.store";
import { AUTO_LANGUAGE, isSupportedLanguage } from "@/lib/languages.util";
import { DEFAULT_MODEL_IDLE_UNLOAD_MINUTES, DEFAULT_TRIGGER_KEY } from "@/store/slices/settings.slice";
import type { SttMode, ThemePreference } from "@/store/slices/settings.slice";

import { DEFAULT_TYPING_SPEED, typingSpeed, validTypingSpeed } from "@/lib/payoff.util";

const STORE_PATH = "linty-settings.json";

let storeInstance: Awaited<ReturnType<typeof load>> | null = null;

async function getStore() {
  if (!storeInstance) {
    storeInstance = await load(STORE_PATH, {
      defaults: {
        sttMode: "local",
        correctionEnabled: true,
        theme: "system",
        whisperPrompt: "",
        correctionPrompt: "",
        transcriptionLanguage: "auto",
        modelIdleUnloadMinutes: DEFAULT_MODEL_IDLE_UNLOAD_MINUTES,
        triggerKey: DEFAULT_TRIGGER_KEY,
        trackApplicationUsage: true,
        typingWordsPerMinute: DEFAULT_TYPING_SPEED,
        dictionaryEnabled: true,
        autoLearnWords: false,
        observeCorrections: false,
      },
      autoSave: true,
    });
  }
  return storeInstance;
}

/** Persist first, so a failed save never changes the displayed assumption. */
export async function saveTypingSpeed(speed: number) {
  if (!validTypingSpeed(speed)) throw new Error("Enter a valid typing speed in words per minute.");
  const store = await getStore();
  const previous = useAppStore.getState().typingWordsPerMinute;
  await store.set("typingWordsPerMinute", speed);
  try { await store.save(); }
  catch (error) { await store.set("typingWordsPerMinute", previous).catch(() => {}); throw error; }
  useAppStore.getState().setTypingWordsPerMinute(speed);
}

export function useSettings() {
  const {
    groqApiKey,
    sttMode,
    correctionEnabled,
    theme,
    whisperPrompt,
    correctionPrompt,
    onboardingComplete,
    transcriptionLanguage,
    setGroqApiKey,
    setSttMode,
    setCorrectionEnabled,
    setTheme,
    setWhisperPrompt,
    setCorrectionPrompt,
    setOnboardingComplete,
    setTranscriptionLanguage,
    setSelectedModelFilename,
    modelIdleUnloadMinutes,
    setModelIdleUnloadMinutes,
    triggerKey,
    setTriggerKey,
    settingsLoaded,
    setSettingsLoaded,
    trackApplicationUsage,
    setTrackApplicationUsage,
    dictionaryEnabled,
    setDictionaryEnabled,
    autoLearnWords,
    setAutoLearnWords,
    observeCorrections,
    setObserveCorrections,
  } = useAppStore();

  // Load settings on mount
  useEffect(() => {
    if (useAppStore.getState().settingsLoaded) return;
    (async () => {
      try {
        const store = await getStore();
        const key = await invoke<string>("get_groq_api_key").catch((error) => {
          useAppStore.getState().addToast({ type: "error", message: String(error) });
          return "";
        });
        const mode = await store.get<SttMode>("sttMode");
        const correction = await store.get<boolean>("correctionEnabled");
        const savedTheme = await store.get<ThemePreference>("theme");
        const savedWhisperPrompt = await store.get<string>("whisperPrompt");
        const savedCorrectionPrompt = await store.get<string>("correctionPrompt");
        const savedOnboarding = await store.get<boolean>("onboardingComplete");
        const savedLanguage = await store.get<string>("transcriptionLanguage");
        const savedSelectedModel = await store.get<string>("selectedModelFilename");
        const savedIdleUnload = await store.get<number>("modelIdleUnloadMinutes");
        const savedTriggerKey = await store.get<string>("triggerKey");
        useAppStore.getState().setTypingWordsPerMinute(typingSpeed(await store.get<number>("typingWordsPerMinute")));
        const savedAppTracking = await store.get<boolean>("trackApplicationUsage");
        setTrackApplicationUsage(savedAppTracking ?? true);
        const savedDictionaryEnabled = await store.get<boolean>("dictionaryEnabled");
        setDictionaryEnabled(savedDictionaryEnabled ?? true);
        const savedAutoLearn = await store.get<boolean>("autoLearnWords");
        setAutoLearnWords(savedAutoLearn ?? false);
        const savedObserve = await store.get<boolean>("observeCorrections");
        setObserveCorrections(savedObserve ?? false);

        setGroqApiKey(key);
        if (mode) setSttMode(mode);
        if (correction !== null && correction !== undefined)
          setCorrectionEnabled(correction);
        if (savedTheme) setTheme(savedTheme);
        if (savedWhisperPrompt) setWhisperPrompt(savedWhisperPrompt);
        if (savedCorrectionPrompt) setCorrectionPrompt(savedCorrectionPrompt);
        if (savedOnboarding) setOnboardingComplete(savedOnboarding);
        if (savedLanguage) {
          // Languages dropped from the catalog (e.g. ones Parakeet can't
          // transcribe) fall back to auto-detect instead of a blank select.
          const language = isSupportedLanguage(savedLanguage) ? savedLanguage : AUTO_LANGUAGE;
          setTranscriptionLanguage(language);
          if (language !== savedLanguage) await store.set("transcriptionLanguage", language);
        }
        if (savedSelectedModel) setSelectedModelFilename(savedSelectedModel);
        if (savedTriggerKey) setTriggerKey(savedTriggerKey);

        // 0 is a valid value (never unload) — only fall back when unset
        const idleUnload = savedIdleUnload ?? DEFAULT_MODEL_IDLE_UNLOAD_MINUTES;
        setModelIdleUnloadMinutes(idleUnload);
        // Sync the persisted preference into the Rust watchdog
        invoke("set_model_idle_unload_minutes", { minutes: idleUnload }).catch(() => {});

        setSettingsLoaded(true);
      } catch (err) {
        console.error("Failed to load settings:", err);
        setSettingsLoaded(true);
      }
    })();
  }, [setGroqApiKey, setSttMode, setCorrectionEnabled, setTheme, setWhisperPrompt, setCorrectionPrompt, setOnboardingComplete, setTranscriptionLanguage, setSelectedModelFilename, setModelIdleUnloadMinutes, setTriggerKey, setSettingsLoaded, setTrackApplicationUsage, setDictionaryEnabled, setAutoLearnWords, setObserveCorrections]);

  const saveGroqApiKey = useCallback(
    async (key: string) => {
      const trimmed = key.trim();
      await invoke("set_groq_api_key", { key: trimmed });
      setGroqApiKey(trimmed);
    },
    [setGroqApiKey],
  );

  const removeGroqApiKey = useCallback(async () => {
    const state = useAppStore.getState();
    if (state.isRecording || ["recording", "transcribing", "correcting", "pasting"].includes(state.status)) {
      throw new Error("Finish dictating before removing your API key.");
    }
    await invoke("remove_groq_api_key");
    useAppStore.setState({ groqApiKey: "", sttMode: "local" });
  }, []);

  const saveTrackApplicationUsage = useCallback(async (enabled: boolean) => {
    const store = await getStore();
    await store.set("trackApplicationUsage", enabled);
    await store.save();
    setTrackApplicationUsage(enabled);
  }, [setTrackApplicationUsage]);

  const saveDictionaryEnabled = useCallback(async (enabled: boolean) => {
    setDictionaryEnabled(enabled);
    const store = await getStore();
    await store.set("dictionaryEnabled", enabled);
  }, [setDictionaryEnabled]);

  const saveAutoLearnWords = useCallback(async (enabled: boolean) => {
    setAutoLearnWords(enabled);
    const store = await getStore();
    await store.set("autoLearnWords", enabled);
  }, [setAutoLearnWords]);

  const saveObserveCorrections = useCallback(async (enabled: boolean) => {
    setObserveCorrections(enabled);
    const store = await getStore();
    await store.set("observeCorrections", enabled);
  }, [setObserveCorrections]);

  const saveSttMode = useCallback(
    async (mode: SttMode) => {
      if (mode === "cloud" && !useAppStore.getState().groqApiKey.trim()) {
        throw new Error("Add a Groq API key in Settings → Speech engine first.");
      }
      const store = await getStore();
      const previous = useAppStore.getState().sttMode;
      await store.set("sttMode", mode);
      try { await store.save(); }
      catch (error) { await store.set("sttMode", previous).catch(() => {}); throw error; }
      setSttMode(mode);
    },
    [setSttMode],
  );

  const saveCorrectionEnabled = useCallback(
    async (enabled: boolean) => {
      setCorrectionEnabled(enabled);
      const store = await getStore();
      await store.set("correctionEnabled", enabled);
    },
    [setCorrectionEnabled],
  );

  const saveTheme = useCallback(
    async (newTheme: ThemePreference) => {
      setTheme(newTheme);
      const store = await getStore();
      await store.set("theme", newTheme);
    },
    [setTheme],
  );

  const saveWhisperPrompt = useCallback(
    async (prompt: string) => {
      setWhisperPrompt(prompt);
      const store = await getStore();
      await store.set("whisperPrompt", prompt);
    },
    [setWhisperPrompt],
  );

  const saveCorrectionPrompt = useCallback(
    async (prompt: string) => {
      setCorrectionPrompt(prompt);
      const store = await getStore();
      await store.set("correctionPrompt", prompt);
    },
    [setCorrectionPrompt],
  );

  const saveOnboardingComplete = useCallback(
    async (complete: boolean) => {
      setOnboardingComplete(complete);
      const store = await getStore();
      await store.set("onboardingComplete", complete);
    },
    [setOnboardingComplete],
  );

  const saveTranscriptionLanguage = useCallback(
    async (language: string) => {
      if (!isSupportedLanguage(language)) throw new Error("Choose a supported transcription language.");
      const state = useAppStore.getState();
      if (state.isRecording || ["transcribing", "correcting", "pasting"].includes(state.status)) {
        throw new Error("Finish dictating before changing the language.");
      }
      const store = await getStore();
      const previous = state.transcriptionLanguage;
      await store.set("transcriptionLanguage", language);
      try { await store.save(); }
      catch (error) { await store.set("transcriptionLanguage", previous).catch(() => {}); throw error; }
      setTranscriptionLanguage(language);
    },
    [setTranscriptionLanguage],
  );

  const saveSelectedModelFilename = useCallback(
    async (filename: string | null) => {
      setSelectedModelFilename(filename);
      const store = await getStore();
      await store.set("selectedModelFilename", filename);
    },
    [setSelectedModelFilename],
  );

  const saveTriggerKey = useCallback(
    async (key: string) => {
      setTriggerKey(key);
      const store = await getStore();
      await store.set("triggerKey", key);
    },
    [setTriggerKey],
  );

  const saveModelIdleUnloadMinutes = useCallback(
    async (minutes: number) => {
      setModelIdleUnloadMinutes(minutes);
      invoke("set_model_idle_unload_minutes", { minutes }).catch(() => {});
      const store = await getStore();
      await store.set("modelIdleUnloadMinutes", minutes);
    },
    [setModelIdleUnloadMinutes],
  );

  return {
    trackApplicationUsage,
    saveTrackApplicationUsage,
    dictionaryEnabled,
    saveDictionaryEnabled,
    autoLearnWords,
    saveAutoLearnWords,
    observeCorrections,
    saveObserveCorrections,
    groqApiKey,
    sttMode,
    correctionEnabled,
    theme,
    whisperPrompt,
    correctionPrompt,
    saveGroqApiKey,
    removeGroqApiKey,
    saveSttMode,
    saveCorrectionEnabled,
    saveTheme,
    saveWhisperPrompt,
    saveCorrectionPrompt,
    onboardingComplete,
    saveOnboardingComplete,
    transcriptionLanguage,
    saveTranscriptionLanguage,
    saveSelectedModelFilename,
    modelIdleUnloadMinutes,
    saveModelIdleUnloadMinutes,
    triggerKey,
    saveTriggerKey,
    settingsLoaded,
  };
}
