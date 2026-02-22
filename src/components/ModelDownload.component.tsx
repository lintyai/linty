import { Download, Check, HardDrive, Loader2 } from "lucide-react";
import { useModelDownload } from "@/hooks/useModelDownload.hook";
import { cn } from "@/lib/utils";

export function ModelDownload() {
  const {
    models,
    downloadedModels,
    isDownloading,
    downloadProgress,
    downloadingFilename,
    isLocalAvailable,
    downloadModel,
  } = useModelDownload();

  if (!isLocalAvailable) {
    return (
      <div className="rounded-lg border border-border-subtle bg-bg-elevated px-3 py-2.5">
        <div className="flex items-center gap-2">
          <HardDrive size={13} className="text-text-muted" />
          <span className="text-[11px] text-text-muted">
            Local STT not available in this build
          </span>
        </div>
        <p className="mt-1 text-[10px] text-text-muted/60">
          Rebuild with{" "}
          <code className="rounded bg-bg-hover px-1 py-0.5 text-[9px]">
            --features local-stt
          </code>{" "}
          to enable offline transcription.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-[10px] font-medium tracking-widest text-text-muted uppercase">
        Local Models
      </label>

      <div className="flex flex-col gap-1.5">
        {models.map((model) => {
          const isDownloaded = downloadedModels.has(model.filename);
          const isThisDownloading =
            isDownloading && downloadingFilename === model.filename;

          return (
            <div
              key={model.filename}
              className={cn(
                "flex items-center justify-between rounded-lg border px-3 py-2 transition-all duration-150",
                isDownloaded
                  ? "border-success/20 bg-[var(--color-success-glow)]"
                  : "border-border-subtle bg-bg-elevated",
              )}
            >
              <div className="flex flex-col">
                <span className="text-[11px] font-medium text-text-primary">
                  {model.name}
                </span>
                <span className="text-[9px] text-text-muted">
                  {model.filename}
                </span>
              </div>

              {isThisDownloading ? (
                <div className="flex items-center gap-2">
                  <div className="h-1 w-16 overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-300"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                  <span className="text-[9px] tabular-nums text-text-muted">
                    {downloadProgress}%
                  </span>
                </div>
              ) : isDownloaded ? (
                <Check size={14} className="text-success" />
              ) : (
                <button
                  onClick={() => downloadModel(model)}
                  disabled={isDownloading}
                  className={cn(
                    "flex h-6 items-center gap-1 rounded-md border border-border px-2 transition-all duration-150",
                    "text-[10px] text-text-secondary",
                    "hover:bg-bg-hover hover:text-text-primary",
                    "active:scale-95",
                    "disabled:cursor-not-allowed disabled:opacity-40",
                  )}
                >
                  {isDownloading ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <Download size={10} />
                  )}
                  <span>{model.size_mb} MB</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
