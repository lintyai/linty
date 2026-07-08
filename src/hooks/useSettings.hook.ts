import { useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { useAppStore } from "@/store/app.store";
import { DEFAULT_MODEL_IDLE_UNLOAD_MINUTES } from "@/store/slices/settings.slice";
import type { SttMode, ThemePreference } from "@/store/slices/settings.slice";

const STORE_PATH = "linty-settings.json";

let storeInstance: Awaited<ReturnType<typeof load>> | null = null;

async function getStore() {
  if (!storeInstance) {
    storeInstance = await load(STORE_PATH, {
      defaults: {
        groqApiKey: "",
        sttMode: "local",
        correctionEnabled: true,
        theme: "system",
        whisperPrompt: "",
        correctionPrompt: "",
        transcriptionLanguage: "auto",
        translateToEnglish: false,
        modelIdleUnloadMinutes: DEFAULT_MODEL_IDLE_UNLOAD_MINUTES,
      },
      autoSave: true,
    });
  }
  return storeInstance;
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
    translateToEnglish,
    setGroqApiKey,
    setSttMode,
    setCorrectionEnabled,
    setTheme,
    setWhisperPrompt,
    setCorrectionPrompt,
    setOnboardingComplete,
    setTranscriptionLanguage,
    setTranslateToEnglish,
    setSelectedModelFilename,
    modelIdleUnloadMinutes,
    setModelIdleUnloadMinutes,
    settingsLoaded,
    setSettingsLoaded,
  } = useAppStore();

  // Load settings on mount
  useEffect(() => {
    (async () => {
      try {
        const store = await getStore();
        const key = await store.get<string>("groqApiKey");
        const mode = await store.get<SttMode>("sttMode");
        const correction = await store.get<boolean>("correctionEnabled");
        const savedTheme = await store.get<ThemePreference>("theme");
        const savedWhisperPrompt = await store.get<string>("whisperPrompt");
        const savedCorrectionPrompt = await store.get<string>("correctionPrompt");
        const savedOnboarding = await store.get<boolean>("onboardingComplete");
        const savedLanguage = await store.get<string>("transcriptionLanguage");
        const savedTranslate = await store.get<boolean>("translateToEnglish");
        const savedSelectedModel = await store.get<string>("selectedModelFilename");
        const savedIdleUnload = await store.get<number>("modelIdleUnloadMinutes");

        if (key) setGroqApiKey(key);
        if (mode) setSttMode(mode);
        if (correction !== null && correction !== undefined)
          setCorrectionEnabled(correction);
        if (savedTheme) setTheme(savedTheme);
        if (savedWhisperPrompt) setWhisperPrompt(savedWhisperPrompt);
        if (savedCorrectionPrompt) setCorrectionPrompt(savedCorrectionPrompt);
        if (savedOnboarding) setOnboardingComplete(savedOnboarding);
        if (savedLanguage) setTranscriptionLanguage(savedLanguage);
        if (savedTranslate !== null && savedTranslate !== undefined)
          setTranslateToEnglish(savedTranslate);
        if (savedSelectedModel) setSelectedModelFilename(savedSelectedModel);

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
  }, [setGroqApiKey, setSttMode, setCorrectionEnabled, setTheme, setWhisperPrompt, setCorrectionPrompt, setOnboardingComplete, setTranscriptionLanguage, setTranslateToEnglish, setSelectedModelFilename, setModelIdleUnloadMinutes, setSettingsLoaded]);

  const saveGroqApiKey = useCallback(
    async (key: string) => {
      setGroqApiKey(key);
      const store = await getStore();
      await store.set("groqApiKey", key);
    },
    [setGroqApiKey],
  );

  const saveSttMode = useCallback(
    async (mode: SttMode) => {
      setSttMode(mode);
      const store = await getStore();
      await store.set("sttMode", mode);
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
      setTranscriptionLanguage(language);
      const store = await getStore();
      await store.set("transcriptionLanguage", language);
    },
    [setTranscriptionLanguage],
  );

  const saveTranslateToEnglish = useCallback(
    async (translate: boolean) => {
      setTranslateToEnglish(translate);
      const store = await getStore();
      await store.set("translateToEnglish", translate);
    },
    [setTranslateToEnglish],
  );

  const saveSelectedModelFilename = useCallback(
    async (filename: string | null) => {
      setSelectedModelFilename(filename);
      const store = await getStore();
      await store.set("selectedModelFilename", filename);
    },
    [setSelectedModelFilename],
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
    groqApiKey,
    sttMode,
    correctionEnabled,
    theme,
    whisperPrompt,
    correctionPrompt,
    saveGroqApiKey,
    saveSttMode,
    saveCorrectionEnabled,
    saveTheme,
    saveWhisperPrompt,
    saveCorrectionPrompt,
    onboardingComplete,
    saveOnboardingComplete,
    transcriptionLanguage,
    translateToEnglish,
    saveTranscriptionLanguage,
    saveTranslateToEnglish,
    saveSelectedModelFilename,
    modelIdleUnloadMinutes,
    saveModelIdleUnloadMinutes,
    settingsLoaded,
  };
}
