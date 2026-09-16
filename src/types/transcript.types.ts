import type { ReformatMetrics } from "./reformat.types";

export interface ApplicationIdentity {
  name: string;
  bundleId: string | null;
}

export interface TranscriptRecord {
  transcriptId: string;
  rawText: string;
  finalText: string;
  /** Immutable output from S1-mini, before dictionary replacements or user edits. */
  reformattedText?: string;
  /** Immutable delivered text; finalText may subsequently be edited in History. */
  pastedText?: string;
  reformatting?: ReformatMetrics;
  reformatTimeMs?: number;
  transcriptionLanguage?: string;
  speechModelId?: string;
  audioSampleCount?: number;
  deliveryStatus?: "pasted" | "failed";
  cloudRefinementStatus?: "disabled" | "applied" | "unchanged" | "fallback" | "superseded-by-s1";
  originalWordCount?: number;
  engine: "cloud" | "local";
  modelName: string;
  durationSeconds: number;
  processingTimeMs: number;
  sttTimeMs?: number;
  correctionTimeMs?: number;
  pasteTimeMs?: number;
  wordCount: number;
  timestamp: number;
  corrected: boolean;
  /** Foreground app when dictation started; absent for older/private sessions. */
  application?: ApplicationIdentity | null;
  /** Dictionary replacements applied before paste, as wrong → right pairs. */
  dictionaryApplied?: { from: string; to: string }[];
}

export interface UsageStats {
  totalTranscriptions: number;
  totalRecordingSeconds: number;
  totalProcessingMs: number;
  successCount: number;
  errorCount: number;
  cloudCount: number;
  localCount: number;
  totalWords: number;
}
