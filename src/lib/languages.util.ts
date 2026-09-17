/**
 * Transcription languages offered in Settings.
 *
 * Kept to the languages BOTH local engines handle: Parakeet TDT v3 covers these
 * 25 European languages, and every one of them is also in Whisper's 99. Whisper
 * alone would allow far more (Hindi, Japanese, Chinese…), but offering a language
 * the default engine cannot transcribe would silently fall back to auto-detect.
 * Codes are ISO 639-1 and are passed to both engines as-is.
 */
export const AUTO_LANGUAGE = "auto";
export const DEFAULT_TRANSCRIPTION_LANGUAGE = "en";

export const TRANSCRIPTION_LANGUAGES: { code: string; label: string }[] = [
  { code: AUTO_LANGUAGE, label: "Auto-detect" },
  { code: "en", label: "English" },
  { code: "bg", label: "Bulgarian" },
  { code: "hr", label: "Croatian" },
  { code: "cs", label: "Czech" },
  { code: "da", label: "Danish" },
  { code: "nl", label: "Dutch" },
  { code: "et", label: "Estonian" },
  { code: "fi", label: "Finnish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "el", label: "Greek" },
  { code: "hu", label: "Hungarian" },
  { code: "it", label: "Italian" },
  { code: "lv", label: "Latvian" },
  { code: "lt", label: "Lithuanian" },
  { code: "mt", label: "Maltese" },
  { code: "pl", label: "Polish" },
  { code: "pt", label: "Portuguese" },
  { code: "ro", label: "Romanian" },
  { code: "ru", label: "Russian" },
  { code: "sk", label: "Slovak" },
  { code: "sl", label: "Slovenian" },
  { code: "es", label: "Spanish" },
  { code: "sv", label: "Swedish" },
  { code: "uk", label: "Ukrainian" },
];

export function isSupportedLanguage(code: string | null | undefined): boolean {
  return TRANSCRIPTION_LANGUAGES.some((lang) => lang.code === code);
}

export function languageLabel(code: string): string {
  return TRANSCRIPTION_LANGUAGES.find((lang) => lang.code === code)?.label ?? code;
}
