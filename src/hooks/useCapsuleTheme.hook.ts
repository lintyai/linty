import { useEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { useAppStore } from "@/store/app.store";
import { useTheme } from "@/hooks/useTheme.hook";
import type { ThemePreference } from "@/store/slices/settings.slice";

/** The overlay is a separate webview; subscribe to the shared appearance preference. */
export function useCapsuleTheme() {
  useTheme();
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const connect = async () => {
      const store = await load("linty-settings.json", { defaults: {}, autoSave: true });
      const stop = await store.onKeyChange<ThemePreference>("theme", (theme) => {
        if (!disposed) useAppStore.getState().setTheme(theme ?? "system");
      });
      if (disposed) { stop(); return; }
      unlisten = stop;
      const theme = await store.get<ThemePreference>("theme");
      if (!disposed) useAppStore.getState().setTheme(theme ?? "system");
    };
    connect().catch(() => {}); // System appearance remains a usable fallback.
    return () => { disposed = true; unlisten?.(); };
  }, []);
}
