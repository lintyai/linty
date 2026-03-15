import { useEffect } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { useAppStore } from "@/store/app.store";
import type { SttMode } from "@/store/slices/settings.slice";

export function useTraySync(saveSttMode: (mode: SttMode) => Promise<void>) {
  const status = useAppStore((s) => s.status);
  const sttMode = useAppStore((s) => s.sttMode);
  const settingsLoaded = useAppStore((s) => s.settingsLoaded);

  // Push status + sttMode to Rust whenever they change
  useEffect(() => {
    if (!settingsLoaded) return;
    emit("tray-state-changed", { status, sttMode });
  }, [status, sttMode, settingsLoaded]);

  // Listen for engine changes from the tray menu
  useEffect(() => {
    const unlisten = listen<string>("tray-engine-changed", (event) => {
      const mode = event.payload as SttMode;
      if (mode === "cloud" || mode === "local") {
        saveSttMode(mode);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [saveSttMode]);
}
