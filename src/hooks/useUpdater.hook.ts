import { useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useAppStore } from "@/store/app.store";

const CHECK_DELAY_MS = 5_000;
const CHECK_INTERVAL_MS = 60 * 60 * 1_000; // 60 min
/// The updater plugin has no timeout of its own: a stalled connection to the
/// release feed would leave "Check for updates" spinning forever.
const CHECK_TIMEOUT_MS = 30_000;
/// Covers the policy fetch (10 s limit in Rust) plus the updater check.
const CHECK_GUARD_MS = 45_000;

// Module-level singletons — shared across all hook instances so
// downloadAndInstall always has the update object regardless of
// which component called checkForUpdate, and so a manual check joins a
// silent check that is already in flight instead of being ignored.
let pendingUpdate: Awaited<ReturnType<typeof check>> | null = null;
let inFlightCheck: Promise<Awaited<ReturnType<typeof check>>> | null = null;
let autoCheckActive = false;

/// Refresh the signed update policy first: the updater only offers what the
/// policy allows (src-tauri/src/policy.rs). A manual check skips the staged
/// rollout. Failures are logged in Rust and the last accepted policy applies.
async function refreshPolicy(manual: boolean) {
  try {
    await invoke("check_policy", { manual });
  } catch (err) {
    console.error("[updater] Policy check failed:", err);
  }
}

function checkWithTimeout(manual: boolean) {
  let guardTimer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    guardTimer = setTimeout(() => reject(new UpdateCheckTimeout()), CHECK_GUARD_MS);
  });
  const run = refreshPolicy(manual).then(() => check({ timeout: CHECK_TIMEOUT_MS }));
  return Promise.race([run, guard]).finally(() => {
    clearTimeout(guardTimer);
    inFlightCheck = null;
  });
}

class UpdateCheckTimeout extends Error {
  constructor() {
    super("Update check timed out");
    this.name = "UpdateCheckTimeout";
  }
}

export function useUpdater() {
  const setUpdateStatus = useAppStore((s) => s.setUpdateStatus);
  const setUpdateVersion = useAppStore((s) => s.setUpdateVersion);
  const setUpdateError = useAppStore((s) => s.setUpdateError);
  const setUpdateProgress = useAppStore((s) => s.setUpdateProgress);
  const addToast = useAppStore((s) => s.addToast);

  const checkForUpdate = useCallback(async (silent = false) => {
    if (useAppStore.getState().updateStatus === "downloading") return;
    // Reuse a check already in flight (the silent auto-check, typically) so a
    // click during it still reports the outcome instead of doing nothing.
    inFlightCheck ??= checkWithTimeout(!silent);
    try {
      setUpdateStatus("checking");
      setUpdateError(null);
      const update = await inFlightCheck;

      if (update) {
        pendingUpdate = update;
        setUpdateVersion(update.version);
        setUpdateStatus("available");
        addToast({
          type: "info",
          message: `Update v${update.version} available`,
        });
      } else {
        pendingUpdate = null;
        setUpdateVersion(null);
        setUpdateStatus("idle");
        if (!silent) addToast({ type: "success", message: "You’re using the latest version of Linty." });
      }
    } catch (err) {
      console.error("[updater] Check failed:", err);
      if (silent) setUpdateStatus("idle");
      else {
        setUpdateError(
          err instanceof UpdateCheckTimeout
            ? "The update server did not respond. Check your connection and try again."
            : "Could not check for updates. Check your connection and try again.",
        );
        setUpdateStatus("error");
      }
    }
  }, [setUpdateStatus, setUpdateVersion, setUpdateError, addToast]);

  const downloadAndInstall = useCallback(async () => {
    if (!pendingUpdate) return;

    try {
      setUpdateStatus("downloading");
      setUpdateProgress(0);
      setUpdateError(null);

      let contentLength = 0;
      let downloaded = 0;
      await pendingUpdate.downloadAndInstall((event) => {
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

  return { checkForUpdate, downloadAndInstall };
}

/**
 * Auto-check on mount (5s delay) + every 60min.
 * Call this ONCE in App.tsx — not in every component that uses useUpdater().
 */
export function useUpdaterAutoCheck() {
  const { checkForUpdate } = useUpdater();

  useEffect(() => {
    if (autoCheckActive) return;
    autoCheckActive = true;

    const timeout = setTimeout(() => checkForUpdate(true), CHECK_DELAY_MS);
    const interval = setInterval(() => checkForUpdate(true), CHECK_INTERVAL_MS);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
      autoCheckActive = false;
    };
  }, [checkForUpdate]);
}
