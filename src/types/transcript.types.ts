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
