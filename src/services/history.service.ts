import { load } from "@tauri-apps/plugin-store";
import { useAppStore } from "@/store/app.store";
import { HISTORY_LIMIT } from "@/lib/usage.util";
import type { TranscriptRecord } from "@/types/transcript.types";

let storePromise: ReturnType<typeof load> | undefined;
let hydration: Promise<void> | undefined;
let writes: Promise<void> = Promise.resolve();
const getStore = () =>
  (storePromise ??= load("linty-history.json", {
    defaults: { transcripts: [] },
    autoSave: true,
  }).catch((error) => {
    storePromise = undefined;
    throw error;
  }));

export function initializeHistory() {
  return (hydration ??= (async () => {
    const store = await getStore();
    const saved = await store.get<TranscriptRecord[]>("transcripts");
    useAppStore
      .getState()
      .setTranscripts((saved ?? []).slice(0, HISTORY_LIMIT));
  })().catch((error) => {
    hydration = undefined;
    throw error;
  }));
}

/** Serialize mutations so fast saves/deletes cannot overwrite one another. */
export function updateHistory(
  update: (records: TranscriptRecord[]) => TranscriptRecord[],
) {
  const next = writes
    .catch(() => {})
    .then(async () => {
      await initializeHistory();
      const records = update(useAppStore.getState().transcripts).slice(
        0,
        HISTORY_LIMIT,
      );
      const store = await getStore();
      await store.set("transcripts", records);
      await store.save();
      useAppStore.getState().setTranscripts(records);
    });
  writes = next;
  return next;
}

export const saveTranscript = (record: TranscriptRecord) =>
  updateHistory((records) => [record, ...records]);
