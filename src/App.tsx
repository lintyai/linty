import { useState, useEffect } from "react";
import { Settings, X, Mic } from "lucide-react";
import { useSettings } from "@/hooks/useSettings.hook";
import { RecorderView } from "@/components/RecorderView.component";
import { SettingsView } from "@/components/SettingsView.component";
import { cn } from "@/lib/utils";

type View = "recorder" | "settings";

export default function App() {
  const [view, setView] = useState<View>("recorder");
  const { groqApiKey } = useSettings();

  // Auto-show settings if no API key
  useEffect(() => {
    if (!groqApiKey) {
      const timer = setTimeout(() => setView("settings"), 600);
      return () => clearTimeout(timer);
    }
  }, [groqApiKey]);

  const isSettings = view === "settings";

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-bg">
      {/* ── Title Bar (drag region) ── */}
      <div
        data-tauri-drag-region
        className="flex h-10 shrink-0 items-center justify-between px-3"
      >
        {/* Left: App identity */}
        <div className="flex items-center gap-1.5" data-tauri-drag-region>
          <div
            className="flex h-5 w-5 items-center justify-center rounded-md bg-accent/10"
            data-tauri-drag-region
          >
            <Mic size={10} className="text-accent" />
          </div>
          <span
            className="text-[11px] font-medium tracking-wide text-text-muted"
            data-tauri-drag-region
          >
            VoiceInk
          </span>
        </div>

        {/* Right: Settings toggle */}
        <button
          onClick={() => setView(isSettings ? "recorder" : "settings")}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-md transition-all duration-150",
            "hover:bg-bg-hover active:scale-90",
            isSettings
              ? "text-text-primary"
              : "text-text-muted hover:text-text-secondary",
          )}
          title={isSettings ? "Close settings" : "Settings"}
        >
          {isSettings ? <X size={13} /> : <Settings size={13} />}
        </button>
      </div>

      {/* ── Divider ── */}
      <div className="h-px bg-border-subtle" />

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">
        {isSettings ? <SettingsView /> : <RecorderView />}
      </div>
    </div>
  );
}
