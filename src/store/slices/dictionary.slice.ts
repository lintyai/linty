import type { StateCreator } from "zustand";
import type {
  CorrectionRecord,
  DictionaryEntry,
  DictionarySuggestion,
} from "@/types/correction.types";

export interface DictionarySlice {
  /** Corrections the person made to dictations, newest first. */
  corrections: CorrectionRecord[];
  dictionaryEntries: DictionaryEntry[];
  dictionarySuggestions: DictionarySuggestion[];
  dictionaryLoaded: boolean;
  setCorrections: (corrections: CorrectionRecord[]) => void;
  setDictionary: (entries: DictionaryEntry[], suggestions: DictionarySuggestion[]) => void;
}

export const createDictionarySlice: StateCreator<DictionarySlice> = (set) => ({
  corrections: [],
  dictionaryEntries: [],
  dictionarySuggestions: [],
  dictionaryLoaded: false,
  setCorrections: (corrections) => set({ corrections }),
  setDictionary: (dictionaryEntries, dictionarySuggestions) =>
    set({ dictionaryEntries, dictionarySuggestions, dictionaryLoaded: true }),
});
