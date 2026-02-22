import { useState } from "react";
import { Eye, EyeOff, Cloud, Cpu, Sparkles } from "lucide-react";
import { useSettings } from "@/hooks/useSettings.hook";
import { cn } from "@/lib/utils";

export function SettingsView() {
  const {
    groqApiKey,
    sttMode,
    correctionEnabled,
    saveGroqApiKey,
    saveSttMode,
    saveCorrectionEnabled,
  } = useSettings();

  const [showKey, setShowKey] = useState(false);
  const [keyInput, setKeyInput] = useState(groqApiKey);

  const handleKeyBlur = () => {
    if (keyInput !== groqApiKey) {
      saveGroqApiKey(keyInput);
    }
  };

  return (
    <div className="animate-fade-in flex flex-col gap-4 px-5 pt-2 pb-4">
      {/* ── API Key ── */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-medium tracking-widest text-text-muted uppercase">
          Groq API Key
        </label>
        <div className="group relative">
          <input
            type={showKey ? "text" : "password"}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onBlur={handleKeyBlur}
            placeholder="gsk_..."
            spellCheck={false}
            autoComplete="off"
            className={cn(
              "w-full rounded-lg border border-border bg-bg-input px-3 py-2 pr-9",
              "text-[12px] text-text-primary placeholder:text-text-muted/40",
              "outline-none transition-all duration-150",
              "focus:border-[var(--color-text-muted)] focus:bg-bg-elevated",
            )}
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className={cn(
              "absolute right-2 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded",
              "text-text-muted transition-colors duration-150 hover:text-text-secondary",
            )}
          >
            {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
        <a
          href="https://console.groq.com/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-text-muted/50 underline-offset-2 transition-colors hover:text-text-muted hover:underline"
        >
          Get a free API key at console.groq.com
        </a>
      </div>

      {/* ── STT Mode Toggle ── */}
      <div className="flex flex-col gap-2">
        <label className="text-[10px] font-medium tracking-widest text-text-muted uppercase">
          Speech Engine
        </label>
        <div className="flex gap-2">
          <ToggleButton
            active={sttMode === "cloud"}
            onClick={() => saveSttMode("cloud")}
            icon={<Cloud size={13} />}
            label="Cloud"
            sublabel="Groq Whisper"
          />
          <ToggleButton
            active={sttMode === "local"}
            onClick={() => saveSttMode("local")}
            icon={<Cpu size={13} />}
            label="Local"
            sublabel="whisper.cpp"
            disabled
          />
        </div>
      </div>

      {/* ── Correction Toggle ── */}
      <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-bg-elevated px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles size={13} className="text-text-muted" />
          <div className="flex flex-col">
            <span className="text-[12px] text-text-primary">
              LLM Correction
            </span>
            <span className="text-[10px] text-text-muted">
              Fix grammar &amp; punctuation
            </span>
          </div>
        </div>

        <button
          onClick={() => saveCorrectionEnabled(!correctionEnabled)}
          className={cn(
            "relative h-5 w-9 rounded-full transition-all duration-200",
            correctionEnabled
              ? "bg-accent shadow-[0_0_8px_var(--color-accent-glow)]"
              : "bg-border",
          )}
        >
          <div
            className={cn(
              "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-200",
              correctionEnabled ? "left-[18px]" : "left-0.5",
            )}
          />
        </button>
      </div>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  icon,
  label,
  sublabel,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 transition-all duration-150",
        active
          ? "border-accent/30 bg-accent-glow"
          : "border-border-subtle bg-bg-elevated hover:bg-bg-hover",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      <span className={cn(active ? "text-accent" : "text-text-muted")}>
        {icon}
      </span>
      <div className="flex flex-col items-start">
        <span
          className={cn(
            "text-[11px] font-medium",
            active ? "text-text-primary" : "text-text-secondary",
          )}
        >
          {label}
        </span>
        <span className="text-[9px] text-text-muted">{sublabel}</span>
      </div>
    </button>
  );
}
