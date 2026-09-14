import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_LANGUAGE,
  TRANSCRIPTION_LANGUAGES,
  isSupportedLanguage,
  languageLabel,
} from "../src/lib/languages.util.ts";

// Parakeet TDT 0.6B v3 model card: the 25 languages it transcribes.
const PARAKEET_V3 = new Set([
  "bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el", "hu", "it",
  "lv", "lt", "mt", "pl", "pt", "ro", "sk", "sl", "es", "sv", "ru", "uk",
]);

// Whisper's 99 languages include every Parakeet language; spot-check the set.
const WHISPER_INCLUDES = new Set([...PARAKEET_V3, "hi", "ja", "zh", "ko", "ar", "tr", "th", "vi", "id"]);

test("every offered language is supported by both local engines", () => {
  const codes = TRANSCRIPTION_LANGUAGES.map((l) => l.code).filter((c) => c !== AUTO_LANGUAGE);
  for (const code of codes) {
    assert.ok(PARAKEET_V3.has(code), `${code} is not a Parakeet TDT v3 language`);
    assert.ok(WHISPER_INCLUDES.has(code), `${code} is not a Whisper language`);
  }
  assert.equal(new Set(codes).size, codes.length, "duplicate language codes");
  assert.equal(codes.length, PARAKEET_V3.size, "list should cover the whole intersection");
});

test("auto-detect is first and English second", () => {
  assert.equal(TRANSCRIPTION_LANGUAGES[0].code, AUTO_LANGUAGE);
  assert.equal(TRANSCRIPTION_LANGUAGES[1].code, "en");
});

test("languages Parakeet cannot transcribe are no longer selectable", () => {
  for (const code of ["hi", "ja", "zh", "ko", "ar", "tr", "th", "vi", "id"]) {
    assert.equal(isSupportedLanguage(code), false, code);
  }
  assert.equal(isSupportedLanguage("auto"), true);
  assert.equal(isSupportedLanguage("uk"), true);
  assert.equal(languageLabel("de"), "German");
  assert.equal(languageLabel("xx"), "xx");
});
