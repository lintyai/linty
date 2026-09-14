import { load } from "@tauri-apps/plugin-store";
import { useAppStore } from "@/store/app.store";
import { HISTORY_LIMIT } from "@/lib/usage.util";
import type { CorrectionRecord } from "@/types/correction.types";

/**
 * Corrections the person made to their dictations (edits in History, and later
 * changes observed in the target app). Same serialization discipline as history.
 */
let storePromise: ReturnType<typeof load> | undefined;
let hydration: Promise<void> | undefined;
let writes: Promise<void> = Promise.resolve();

const getStore = () =>
  (storePromise ??= load("linty-corrections.json", {
    defaults: { corrections: [] },
    autoSave: true,
  }).catch((error) => {
    storePromise = undefined;
    throw error;
  }));

export function initializeCorrections() {
  return (hydration ??= (async () => {
    const store = await getStore();
    const saved = await store.get<CorrectionRecord[]>("corrections");
    useAppStore.getState().setCorrections((saved ?? []).slice(0, HISTORY_LIMIT));
  })().catch((error) => {
    hydration = undefined;
    throw error;
  }));
}

export function updateCorrections(
  update: (records: CorrectionRecord[]) => CorrectionRecord[],
) {
  const next = writes
    .catch(() => {})
    .then(async () => {
      await initializeCorrections();
      const records = update(useAppStore.getState().corrections).slice(0, HISTORY_LIMIT);
      const store = await getStore();
      await store.set("corrections", records);
      await store.save();
      useAppStore.getState().setCorrections(records);
    });
  writes = next;
  return next;
}

export const recordCorrection = (record: CorrectionRecord) =>
  updateCorrections((records) => [record, ...records]);
