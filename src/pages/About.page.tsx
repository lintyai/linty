import { useState, useEffect, useCallback } from "react";
import {
  Sparkles,
  Download,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { getVersion } from "@tauri-apps/api/app";
import { useUpdater } from "@/hooks/useUpdater.hook";
import { useAppStore } from "@/store/app.store";
import { SectionCard } from "@/components/shared/SettingsLayout.component";
import { cn } from "@/lib/utils";

export function AboutPage() {
  const [appVersion, setAppVersion] = useState("");
  const updateStatus = useAppStore((s) => s.updateStatus);
  const updateVersion = useAppStore((s) => s.updateVersion);
  const updateProgress = useAppStore((s) => s.updateProgress);
  const updateError = useAppStore((s) => s.updateError);
  const { checkForUpdate, downloadAndInstall } = useUpdater();

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion("unknown"));
  }, []);

  const handleCheckUpdate = useCallback(() => {
    checkForUpdate();
  }, [checkForUpdate]);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div
        data-tauri-drag-region
        className="flex h-[52px] shrink-0 items-center border-b border-border-subtle px-5"
      >
        <h1
          className="text-[15px] font-semibold text-text-primary"
          data-tauri-drag-region
        >
          About
        </h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-[480px] flex flex-col gap-8">
          {/* App identity */}
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 border border-accent/20">
              <Sparkles size={22} className="text-accent" />
            </div>
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[15px] font-semibold text-text-primary">
                Linty
              </span>
              <span className="text-[12px] text-text-muted">
                Version {appVersion || "..."}
              </span>
            </div>
          </div>

          {/* Update banner */}
          {updateStatus === "available" && updateVersion && (
            <SectionCard className="animate-fade-in">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-medium text-text-primary">
                    v{updateVersion} available
                  </span>
                  <span className="text-[11px] text-text-muted">
                    A new version is ready to install
                  </span>
                </div>
                <button
                  onClick={downloadAndInstall}
                  className={cn(
                    "flex h-[30px] items-center gap-1.5 rounded-md px-3 text-[12px] font-medium",
                    "bg-accent text-white hover:bg-accent-soft active:scale-95 transition-all duration-150",
                  )}
                >
                  <Download size={12} />
                  Install
                </button>
              </div>
            </SectionCard>
          )}

          {updateStatus === "downloading" && (
            <SectionCard className="animate-fade-in">
              <div className="flex flex-col gap-2 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-text-primary">Downloading update...</span>
                  <span className="text-[11px] tabular-nums text-text-muted">{updateProgress}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-300"
                    style={{ width: `${updateProgress}%` }}
                  />
                </div>
              </div>
            </SectionCard>
          )}

          {updateStatus === "error" && updateError && (
            <SectionCard className="animate-fade-in">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-[13px] text-danger">{updateError}</span>
                <button
                  onClick={handleCheckUpdate}
                  className="text-[12px] text-accent hover:text-accent-soft transition-colors"
                >
                  Retry
                </button>
              </div>
            </SectionCard>
          )}

          {/* Action buttons */}
          <SectionCard>
            <div className="flex flex-col">
              <button
                onClick={handleCheckUpdate}
                disabled={updateStatus === "checking" || updateStatus === "downloading"}
                className={cn(
                  "flex items-center justify-between px-4 py-[10px] hover:bg-bg-hover transition-colors border-b border-border-subtle",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                <span className="text-[13px] text-text-primary">Check for updates</span>
                <RefreshCw
                  size={13}
                  className={cn("text-text-muted", updateStatus === "checking" && "animate-spin")}
                />
              </button>
              <button
                onClick={() => open("https://linty.ai")}
                className="flex items-center justify-between px-4 py-[10px] hover:bg-bg-hover transition-colors border-b border-border-subtle"
              >
                <span className="text-[13px] text-text-primary">Website</span>
                <ExternalLink size={13} className="text-text-muted" />
              </button>
              <button
                onClick={() => open("https://github.com/lintyai/linty")}
                className="flex items-center justify-between px-4 py-[10px] hover:bg-bg-hover transition-colors border-b border-border-subtle"
              >
                <span className="text-[13px] text-text-primary">GitHub</span>
                <ExternalLink size={13} className="text-text-muted" />
              </button>
              <button className="flex items-center justify-between px-4 py-[10px] hover:bg-bg-hover transition-colors">
                <span className="text-[13px] text-text-primary">Licenses</span>
                <ExternalLink size={13} className="text-text-muted" />
              </button>
            </div>
          </SectionCard>

          <p className="text-[11px] text-text-muted text-center leading-relaxed">
            Made with care. Your voice, your data, your device.
          </p>
        </div>
      </div>
    </div>
  );
}
