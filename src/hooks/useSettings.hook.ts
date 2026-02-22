import { useEffect, useCallback } from "react";
import { load } from "@tauri-apps/plugin-store";
import { useAppStore } from "@/store/app.store";
import type { SttMode } from "@/store/slices/settings.slice";

const STORE_PATH = "voiceink-settings.json";

let storeInstance: Awaited<ReturnType<typeof load>> | null = null;

async function getStore() {
  if (!storeInstance) {
    storeInstance = await load(STORE_PATH, {
      defaults: {
        groqApiKey: "",
        sttMode: "cloud",
        correctionEnabled: true,
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
    setGroqApiKey,
    setSttMode,
    setCorrectionEnabled,
  } = useAppStore();

  // Load settings on mount
  useEffect(() => {
    (async () => {
      try {
        const store = await getStore();
        const key = await store.get<string>("groqApiKey");
        const mode = await store.get<SttMode>("sttMode");
        const correction = await store.get<boolean>("correctionEnabled");

        if (key) setGroqApiKey(key);
        if (mode) setSttMode(mode);
        if (correction !== null && correction !== undefined)
          setCorrectionEnabled(correction);
      } catch (err) {
        console.error("Failed to load settings:", err);
      }
    })();
  }, [setGroqApiKey, setSttMode, setCorrectionEnabled]);

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

  return {
    groqApiKey,
    sttMode,
    correctionEnabled,
    saveGroqApiKey,
    saveSttMode,
    saveCorrectionEnabled,
  };
}
