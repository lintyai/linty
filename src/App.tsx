import { useEffect, useCallback, useState, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getStore } from "@tauri-apps/plugin-store";
import { useSettings } from "@/hooks/useSettings.hook";
import { useGlobalHotkey } from "@/hooks/useGlobalHotkey.hook";
import { useModelAutoLoad } from "@/hooks/useModelAutoLoad.hook";
import { useHistory } from "@/hooks/useHistory.hook";
import { useTheme } from "@/hooks/useTheme.hook";
import { useUpdater, useUpdaterAutoCheck } from "@/hooks/useUpdater.hook";
import { useAppStore } from "@/store/app.store";
import { checkMicrophonePermission } from "@/services/permissions.service";
import { Sidebar } from "@/components/layout/Sidebar.component";
import { StatusBar } from "@/components/layout/StatusBar.component";
import { ConfirmResetDialogue } from "@/components/shared/ConfirmReset.dialogue";

import { ToastContainer } from "@/components/shared/ToastContainer.component";
import { HistoryPage } from "@/pages/History.page";
import { SettingsPage } from "@/pages/Settings.page";
import { DashboardPage } from "@/pages/Dashboard.page";
import { SystemCheckPage } from "@/pages/SystemCheck.page";
import { ShortcutsPage } from "@/pages/Shortcuts.page";
import { OnboardingPage } from "@/pages/Onboarding.page";

export default function App() {
  const currentView = useAppStore((s) => s.currentView);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const { groqApiKey, sttMode, onboardingComplete, saveOnboardingComplete, settingsLoaded } = useSettings();

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [micPermission, setMicPermission] = useState<string | null>(null);
  const micPollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Poll mic permission every 3s — gate the app if not authorized
  useEffect(() => {
    if (!onboardingComplete || !settingsLoaded) return;

    const poll = async () => {
      const status = await checkMicrophonePermission().catch(() => "not_determined");
      setMicPermission(status);
    };
    poll();
    micPollRef.current = setInterval(poll, 3000);
    return () => clearInterval(micPollRef.current);
  }, [onboardingComplete, settingsLoaded]);

  // Stop polling once authorized
  useEffect(() => {
    if (micPermission === "authorized" && micPollRef.current) {
      clearInterval(micPollRef.current);
    }
  }, [micPermission]);

  useTheme();
  useGlobalHotkey();
  useModelAutoLoad();
  useHistory();
  useUpdaterAutoCheck();
  const { checkForUpdate } = useUpdater();

  const handleOnboardingComplete = useCallback(async () => {
    await saveOnboardingComplete(true);
  }, [saveOnboardingComplete]);

  // Auto-show settings if no API key and cloud mode selected (only after settings loaded)
  useEffect(() => {
    if (!onboardingComplete || !settingsLoaded) return;
    if (!groqApiKey && sttMode === "cloud") {
      const timer = setTimeout(() => setCurrentView("settings"), 500);
      return () => clearTimeout(timer);
    }
  }, [groqApiKey, sttMode, setCurrentView, onboardingComplete, settingsLoaded]);

  // Menu: Check for Updates
  useEffect(() => {
    const unlisten = listen("menu-check-for-updates", () => {
      checkForUpdate();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [checkForUpdate]);

  // Menu: Reset All Data — show in-app confirmation dialog
  // (window.confirm is silently blocked by WKWebView — wry's WKUIDelegate
  //  does not implement runJavaScriptConfirmPanelWithMessage)
  useEffect(() => {
    const unlisten = listen("menu-reset-all-data", () => {
      setShowResetConfirm(true);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const handleResetConfirm = useCallback(async () => {
    setShowResetConfirm(false);
    try {
      // 1. Clear plugin-store in-memory caches — the Rust backend holds
      //    state that survives webview reload, so deleting files alone
      //    does nothing (autoSave re-writes them from memory).
      const settingsStore = await getStore("linty-settings.json");
      if (settingsStore) {
        await settingsStore.clear();
        await settingsStore.save();
      }
      const historyStore = await getStore("linty-history.json");
      if (historyStore) {
        await historyStore.clear();
        await historyStore.save();
      }

      // 2. Delete model files from disk + unload whisper from memory
      await invoke("reset_all_data");

      // 3. Reload webview — JS singletons reset, stores rehydrate empty
      window.location.reload();
    } catch (err) {
      console.error("Reset failed:", err);
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    if (!onboardingComplete) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === ",") {
        e.preventDefault();
        setCurrentView("settings");
      }
      if (e.key === "Escape" && currentView !== "dashboard") {
        e.preventDefault();
        setCurrentView("dashboard");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentView, setCurrentView, onboardingComplete]);

  // Show onboarding on first launch
  if (!onboardingComplete) {
    return <OnboardingPage onComplete={handleOnboardingComplete} />;
  }

  // Gate: if mic permission lost after onboarding, show mic step directly
  if (micPermission !== null && micPermission !== "authorized") {
    return <OnboardingPage onComplete={handleOnboardingComplete} startAtMic />;
  }

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />

      <div className="flex flex-1 flex-col min-w-0">
        {/* Drag region for title bar area */}
        <div data-tauri-drag-region className="absolute right-0 top-0 left-[var(--sidebar-width)] z-20 h-[52px] pointer-events-none" />

        {/* Page content */}
        <div key={currentView} className="flex-1 min-h-0 animate-page-enter">
          {currentView === "history" && <HistoryPage />}
          {currentView === "settings" && <SettingsPage />}
          {currentView === "dashboard" && <DashboardPage />}
          {currentView === "system-check" && <SystemCheckPage />}
          {currentView === "shortcuts" && <ShortcutsPage />}
        </div>

        <StatusBar />
      </div>

      <ToastContainer />
      <ConfirmResetDialogue
        open={showResetConfirm}
        onConfirm={handleResetConfirm}
        onCancel={() => setShowResetConfirm(false)}
      />
    </div>
  );
}
