import { useEffect, useCallback, useRef } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useAppStore } from "@/store/app.store";

const CHECK_DELAY_MS = 5_000;
const CHECK_INTERVAL_MS = 60 * 60 * 1_000; // 60 min

export function useUpdater() {
  const setUpdateStatus = useAppStore((s) => s.setUpdateStatus);
  const setUpdateVersion = useAppStore((s) => s.setUpdateVersion);
  const setUpdateError = useAppStore((s) => s.setUpdateError);
  const setUpdateProgress = useAppStore((s) => s.setUpdateProgress);
  const addToast = useAppStore((s) => s.addToast);
  const updateRef = useRef<Awaited<ReturnType<typeof check>> | null>(null);

  const checkForUpdate = useCallback(async () => {
    try {
      setUpdateStatus("checking");
      const update = await check();

      if (update) {
        updateRef.current = update;
        setUpdateVersion(update.version);
        setUpdateStatus("available");
        addToast({
          type: "info",
          message: `Update v${update.version} available`,
        });
      } else {
        setUpdateStatus("idle");
      }
    } catch (err) {
      console.error("[updater] Check failed:", err);
      // Fail silently — don't show error for routine checks
      setUpdateStatus("idle");
    }
  }, [setUpdateStatus, setUpdateVersion, addToast]);

  const downloadAndInstall = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;

    try {
      setUpdateStatus("downloading");
      setUpdateProgress(0);
      setUpdateError(null);

      let contentLength = 0;
      let downloaded = 0;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            downloaded = 0;
            break;
          case "Progress": {
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setUpdateProgress(Math.min(Math.round((downloaded / contentLength) * 100), 100));
            }
            break;
          }
          case "Finished":
            setUpdateProgress(100);
            break;
        }
      });

      addToast({ type: "success", message: "Update installed — restarting..." });
      // Brief delay so the user sees the toast
      await new Promise((r) => setTimeout(r, 1500));
      await relaunch();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[updater] Download failed:", message);
      setUpdateError(message);
      setUpdateStatus("error");
      addToast({ type: "error", message: "Update failed — try again later" });
    }
  }, [setUpdateStatus, setUpdateProgress, setUpdateError, addToast]);

  // Auto-check on mount (delayed) + periodic interval
  useEffect(() => {
    const timeout = setTimeout(checkForUpdate, CHECK_DELAY_MS);
    const interval = setInterval(checkForUpdate, CHECK_INTERVAL_MS);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [checkForUpdate]);

  return { checkForUpdate, downloadAndInstall };
}
