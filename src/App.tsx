import { useEffect, useCallback } from "react";
import { useSettings } from "@/hooks/useSettings.hook";
import { useGlobalHotkey } from "@/hooks/useGlobalHotkey.hook";
import { useModelAutoLoad } from "@/hooks/useModelAutoLoad.hook";
import { useHistory } from "@/hooks/useHistory.hook";
import { useTheme } from "@/hooks/useTheme.hook";
import { useAppStore } from "@/store/app.store";
import { Sidebar } from "@/components/layout/Sidebar.component";
import { StatusBar } from "@/components/layout/StatusBar.component";

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
  const { groqApiKey, sttMode, onboardingComplete, saveOnboardingComplete } = useSettings();

  useTheme();
  useGlobalHotkey();
  useModelAutoLoad();
  useHistory();

  const handleOnboardingComplete = useCallback(async () => {
    await saveOnboardingComplete(true);
  }, [saveOnboardingComplete]);

  // Auto-show settings if no API key and cloud mode selected (only after onboarding)
  useEffect(() => {
    if (!onboardingComplete) return;
    if (!groqApiKey && sttMode === "cloud") {
      const timer = setTimeout(() => setCurrentView("settings"), 500);
      return () => clearTimeout(timer);
    }
  }, [groqApiKey, sttMode, setCurrentView, onboardingComplete]);

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
    </div>
  );
}
