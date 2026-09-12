export interface ApplicationIdentity {
  name: string;
  bundleId: string | null;
}

export interface TranscriptRecord {
  transcriptId: string;
  rawText: string;
  finalText: string;
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
