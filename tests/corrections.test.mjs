import test from "node:test";
import assert from "node:assert/strict";
import { diffCorrection, wordDiff, REWRITE_THRESHOLD } from "../src/lib/correction-diff.util.ts";
import {
  addToDictionary,
  applyDictionary,
  correctionsPer100Words,
  isSuggestionReady,
  learnablePairs,
  promptWithDictionary,
  engineTerms,
  suggestionsFromCorrection,
} from "../src/lib/dictionary.util.ts";

const now = 1_757_900_000_000;

test("word diff pairs equal-length runs one to one and keeps punctuation with the word", () => {
  const pairs = wordDiff(
    "names like Tari, Zustan and Groke are spelled",
    "names like Tauri, Zustand and Groq are spelled",
  );
  assert.deepEqual(pairs, [
    { kind: "substitution", from: "Tari,", to: "Tauri," },
    { kind: "substitution", from: "Zustan", to: "Zustand" },
    { kind: "substitution", from: "Groke", to: "Groq" },
  ]);
  assert.deepEqual(wordDiff("a b c", "a b c d"), [{ kind: "insertion", from: "", to: "d" }]);
  assert.deepEqual(wordDiff("a b c", "a c"), [{ kind: "deletion", from: "b", to: "" }]);
  assert.deepEqual(wordDiff("same", "same"), []);
});

test("a heavy rewrite is flagged and yields no learnable pairs", () => {
  const fix = diffCorrection("send the invoice to the client by friday", "send the invoice to the client by Friday");
  assert.equal(fix.rewrite, false);
  assert.equal(fix.wordCount, 8);
  const rewrite = diffCorrection("send the invoice to the client", "please forward that bill tomorrow");
  assert.equal(rewrite.rewrite, true);
  assert.ok(rewrite.changedRatio > REWRITE_THRESHOLD);
  const record = { correctionId: "c1", transcriptId: "t1", timestamp: now, source: "edit", engine: "local", modelName: "Parakeet TDT v3", language: "en", wordCount: rewrite.wordCount, changedRatio: rewrite.changedRatio, rewrite: true, pairs: rewrite.pairs };
  assert.deepEqual(suggestionsFromCorrection(record, [], []), []);
});

test("learnable pairs skip everyday words and multi-word swaps", () => {
  const pairs = learnablePairs([
    { kind: "substitution", from: "Tari,", to: "Tauri," },
    { kind: "substitution", from: "there", to: "their" },
    { kind: "substitution", from: "few seconds per", to: "Parakeet" },
    { kind: "substitution", from: "linty", to: "Linty" },
    { kind: "insertion", from: "", to: "Groq" },
  ]);
  assert.deepEqual(pairs, [
    { from: "Tari", to: "Tauri" },
    { from: "linty", to: "Linty" },
  ]);
});

test("suggestions count sightings and proper nouns are ready at once", () => {
  const base = { transcriptId: "t", source: "edit", engine: "local", modelName: "m", language: "en", wordCount: 10, changedRatio: 0.1, rewrite: false };
  const first = { ...base, correctionId: "c1", timestamp: now, pairs: [{ kind: "substitution", from: "Groke", to: "Groq" }, { kind: "substitution", from: "recieve", to: "receive" }] };
  const second = { ...base, correctionId: "c2", timestamp: now + 1, pairs: [{ kind: "substitution", from: "recieve", to: "receive" }] };
  let suggestions = suggestionsFromCorrection(first, [], []);
  assert.equal(suggestions.length, 2);
  const groq = suggestions.find((s) => s.right === "Groq");
  const receive = suggestions.find((s) => s.right === "receive");
  assert.equal(isSuggestionReady(groq), true, "proper noun after one sighting");
  assert.equal(isSuggestionReady(receive), false, "ordinary word needs two sightings");
  suggestions = suggestionsFromCorrection(second, suggestions, []);
  assert.equal(suggestions.find((s) => s.right === "receive").seenCount, 2);
  assert.equal(isSuggestionReady(suggestions.find((s) => s.right === "receive")), true);
  // Already in the dictionary: no suggestion.
  const entries = addToDictionary([], "Groq", ["Groke"], "manual", now);
  assert.deepEqual(suggestionsFromCorrection(first, [], entries).map((s) => s.right), ["receive"]);
  // Same correction folded twice does not double count.
  assert.equal(suggestionsFromCorrection(second, suggestions, []).find((s) => s.right === "receive").seenCount, 2);
});

test("dictionary replaces whole words, keeps punctuation and matches casing", () => {
  let entries = addToDictionary([], "Tauri", ["Tari", "Tory"], "learned", now);
  entries = addToDictionary(entries, "Zustand", ["Zustan"], "manual", now);
  entries = addToDictionary(entries, "Tauri", ["tarry"], "manual", now); // merges into the existing entry
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0].wrong, ["Tari", "Tory", "tarry"]);
  const { text, applied } = applyDictionary("Tari, then TARI and tarrying with Zustan.", entries);
  assert.equal(text, "Tauri, then TAURI and tarrying with Zustand.");
  assert.deepEqual(applied.map((a) => `${a.from}>${a.to}`), ["Tari>Tauri", "TARI>TAURI", "Zustan>Zustand"]);
  const disabled = entries.map((e) => ({ ...e, enabled: false }));
  assert.equal(applyDictionary("Tari", disabled).text, "Tari");
});

test("engine terms rank by every time an entry helped, recognised or corrected", () => {
  let entries = addToDictionary([], "Tauri", ["Tari"], "manual", now);
  entries = addToDictionary(entries, "Zustand", ["Zustan"], "manual", now);
  entries = addToDictionary(entries, "Groq", ["Groke"], "manual", now);
  entries[0] = { ...entries[0], timesApplied: 2, timesRecognized: 4 }; // Tauri: 6
  entries[1] = { ...entries[1], timesApplied: 5 }; // Zustand: 5
  entries[2] = { ...entries[2], timesRecognized: 7 }; // Groq: 7
  assert.deepEqual(engineTerms(entries).map((e) => e.right), ["Groq", "Tauri", "Zustand"]);
  assert.deepEqual(engineTerms(entries, 1).map((e) => e.right), ["Groq"]);
});

test("engine prompt appends dictionary terms after the manual prompt within the budget", () => {
  let entries = addToDictionary([], "Tauri", ["Tari"], "manual", now);
  entries = addToDictionary(entries, "Zustand", ["Zustan"], "manual", now);
  entries[1] = { ...entries[1], timesApplied: 5 };
  assert.equal(promptWithDictionary("Linty, Groq", entries), "Linty, Groq, Zustand, Tauri");
  assert.equal(promptWithDictionary("", entries, 12), "Zustand");
  assert.equal(promptWithDictionary("tauri", entries), "tauri, Zustand");
});

test("corrections per 100 words counts pairs and treats a rewrite as one", () => {
  const records = [
    { correctionId: "a", transcriptId: "t", timestamp: now, source: "edit", engine: "local", modelName: "m", language: "en", wordCount: 50, changedRatio: 0.04, rewrite: false, pairs: [{ kind: "substitution", from: "a", to: "b" }, { kind: "deletion", from: "um", to: "" }] },
    { correctionId: "b", transcriptId: "t2", timestamp: now, source: "edit", engine: "local", modelName: "m", language: "en", wordCount: 50, changedRatio: 0.9, rewrite: true, pairs: [{ kind: "substitution", from: "x y z", to: "p q" }] },
  ];
  assert.equal(correctionsPer100Words(records, 300), 1);
  assert.equal(correctionsPer100Words(records, 0), null);
});
