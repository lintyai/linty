import { load } from "@tauri-apps/plugin-store";
import { useAppStore } from "@/store/app.store";
import {
  addToDictionary,
  isSuggestionReady,
  suggestionsFromCorrection,
} from "@/lib/dictionary.util";
import type {
  CorrectionRecord,
  DictionaryEntry,
  DictionaryOrigin,
  DictionarySuggestion,
} from "@/types/correction.types";

/** The personal dictionary: confirmed entries plus pending suggestions. */
interface DictionaryState {
  entries: DictionaryEntry[];
  suggestions: DictionarySuggestion[];
}

let storePromise: ReturnType<typeof load> | undefined;
let hydration: Promise<void> | undefined;
let writes: Promise<void> = Promise.resolve();

const getStore = () =>
  (storePromise ??= load("linty-dictionary.json", {
    defaults: { entries: [], suggestions: [] },
    autoSave: true,
  }).catch((error) => {
    storePromise = undefined;
    throw error;
  }));

export function initializeDictionary() {
  return (hydration ??= (async () => {
    const store = await getStore();
    const entries = (await store.get<DictionaryEntry[]>("entries")) ?? [];
    const suggestions = (await store.get<DictionarySuggestion[]>("suggestions")) ?? [];
    useAppStore.getState().setDictionary(entries, suggestions);
  })().catch((error) => {
    hydration = undefined;
    throw error;
  }));
}

/** Serialize mutations so a fast accept/dismiss cannot overwrite a concurrent learn. */
export function updateDictionary(update: (state: DictionaryState) => DictionaryState) {
  const next = writes
    .catch(() => {})
    .then(async () => {
      await initializeDictionary();
      const { dictionaryEntries, dictionarySuggestions } = useAppStore.getState();
      const result = update({ entries: dictionaryEntries, suggestions: dictionarySuggestions });
      const store = await getStore();
      await store.set("entries", result.entries);
      await store.set("suggestions", result.suggestions);
      await store.save();
      useAppStore.getState().setDictionary(result.entries, result.suggestions);
    });
  writes = next;
  return next;
}

export const addDictionaryEntry = (right: string, wrong: string[], origin: DictionaryOrigin = "manual") =>
  updateDictionary(({ entries, suggestions }) => ({
    entries: addToDictionary(entries, right, wrong, origin),
    // A confirmed entry retires any suggestion it covers.
    suggestions: suggestions.filter((s) => !(s.right === right.trim() && wrong.map((w) => w.toLowerCase()).includes(s.wrong.toLowerCase()))),
  }));

export const setDictionaryEntryEnabled = (entryId: string, enabled: boolean) =>
  updateDictionary(({ entries, suggestions }) => ({
    entries: entries.map((e) => (e.entryId === entryId ? { ...e, enabled } : e)),
    suggestions,
  }));

export const removeDictionaryEntry = (entryId: string) =>
  updateDictionary(({ entries, suggestions }) => ({
    entries: entries.filter((e) => e.entryId !== entryId),
    suggestions,
  }));

export const acceptSuggestion = (suggestionId: string) =>
  updateDictionary(({ entries, suggestions }) => {
    const s = suggestions.find((x) => x.suggestionId === suggestionId);
    if (!s) return { entries, suggestions };
    return {
      entries: addToDictionary(entries, s.right, [s.wrong], "learned"),
      suggestions: suggestions.filter((x) => x.suggestionId !== suggestionId),
    };
  });

export const dismissSuggestion = (suggestionId: string) =>
  updateDictionary(({ entries, suggestions }) => ({
    entries,
    suggestions: suggestions.filter((x) => x.suggestionId !== suggestionId),
  }));

/**
 * Count how entries helped, so the most useful ones are the ones sent to the
 * engine: `recognized` = the engine got the word right thanks to the dictionary,
 * `corrected` = Linty replaced a misheard spelling after transcription.
 */
export const noteDictionaryUse = (use: { recognized: string[]; corrected: string[] }) => {
  if (!use.recognized.length && !use.corrected.length) return Promise.resolve();
  const tally = (ids: string[]) => {
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
  };
  const recognized = tally(use.recognized);
  const corrected = tally(use.corrected);
  const now = Date.now();
  return updateDictionary(({ entries, suggestions }) => ({
    entries: entries.map((e) =>
      recognized.has(e.entryId) || corrected.has(e.entryId)
        ? {
            ...e,
            timesApplied: e.timesApplied + (corrected.get(e.entryId) ?? 0),
            timesRecognized: (e.timesRecognized ?? 0) + (recognized.get(e.entryId) ?? 0),
            lastAppliedAt: now,
          }
        : e,
    ),
    suggestions,
  }));
};

/**
 * Learn from a correction: fold its word swaps into the suggestions and, when
 * auto-learn is on, promote the ones that are ready straight into the dictionary.
 * Returns how many suggestions were added or promoted, for the toast.
 */
export async function ingestCorrection(record: CorrectionRecord, autoLearn: boolean) {
  let suggested = 0;
  let learned = 0;
  await updateDictionary(({ entries, suggestions }) => {
    const before = new Set(suggestions.map((s) => s.suggestionId));
    let nextSuggestions = suggestionsFromCorrection(record, suggestions, entries);
    let nextEntries = entries;
    if (autoLearn) {
      const ready = nextSuggestions.filter(isSuggestionReady);
      for (const s of ready) {
        nextEntries = addToDictionary(nextEntries, s.right, [s.wrong], "learned", record.timestamp);
      }
      learned = ready.length;
      nextSuggestions = nextSuggestions.filter((s) => !ready.includes(s));
    }
    suggested = nextSuggestions.filter((s) => !before.has(s.suggestionId)).length;
    return { entries: nextEntries, suggestions: nextSuggestions };
  });
  return { suggested, learned };
}
