import type { TranscriptRecord } from "../types/transcript.types";

export type UsagePeriod = "7d" | "30d" | "all";
export const HISTORY_LIMIT = 500;

export function periodStart(period: UsagePeriod, now: number): number {
  if (period === "all") return -Infinity;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (period === "7d" ? 6 : 29));
  return start.getTime();
}

export function filterByPeriod(
  records: TranscriptRecord[],
  period: UsagePeriod,
  now: number,
) {
  const start = periodStart(period, now);
  return records.filter((t) => t.timestamp >= start && t.timestamp <= now);
}

export function summarizeUsage(records: TranscriptRecord[]) {
  const words = records.reduce((sum, t) => sum + t.wordCount, 0);
  const seconds = records.reduce((sum, t) => sum + t.durationSeconds, 0);
  const processingMs = records.reduce((sum, t) => sum + t.processingTimeMs, 0);
  const local = records.filter((t) => t.engine === "local").length;
  return {
    words,
    seconds,
    sessions: records.length,
    local,
    avgProcessingSeconds: records.length
      ? processingMs / records.length / 1000
      : 0,
    wordsPerMinute: seconds > 0 ? Math.round((words / seconds) * 60) : 0,
    localPercent: records.length
      ? Math.round((local / records.length) * 100)
      : 0,
  };
}

export interface ApplicationUsage {
  id: string;
  name: string;
  attributed: boolean;
  words: number;
  seconds: number;
  sessions: number;
  /** Timestamp of the most recent dictation in this app. */
  lastUsedAt: number;
  /** Total speech-to-paste processing time, for per-app turnaround. */
  processingMs: number;
  /** Dictations processed on-device. */
  local: number;
}

export function usageByApplication(records: TranscriptRecord[]): ApplicationUsage[] {
  const apps = new Map<string, ApplicationUsage>();
  for (const t of records) {
    const id = t.application
      ? t.application.bundleId
        ? `bundle:${t.application.bundleId}`
        : `name:${t.application.name}`
      : "unattributed";
    const app = apps.get(id) ?? {
      id,
      name: t.application?.name ?? "Unattributed",
      attributed: !!t.application,
      words: 0,
      seconds: 0,
      sessions: 0,
      lastUsedAt: 0,
      processingMs: 0,
      local: 0,
    };
    app.words += t.wordCount;
    app.seconds += t.durationSeconds;
    app.sessions++;
    app.lastUsedAt = Math.max(app.lastUsedAt, t.timestamp);
    app.processingMs += t.processingTimeMs;
    if (t.engine === "local") app.local++;
    apps.set(id, app);
  }
  return [...apps.values()];
}

/** "Today", "Yesterday", or a short calendar date in local time. */
export function formatDayLabel(timestamp: number, now = Date.now()) {
  const date = new Date(timestamp);
  const today = new Date(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
}

/** Calendar buckets honor local time and daylight-saving boundaries. */
export function usageTimeline(
  records: TranscriptRecord[],
  period: UsagePeriod,
  now: number,
) {
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  const start = new Date(
    period === "all"
      ? Math.min(now, ...records.map((t) => t.timestamp))
      : periodStart(period, now),
  );
  start.setHours(0, 0, 0, 0);
  const monthly =
    period === "all" && end.getTime() - start.getTime() > 31 * 86400000;
  if (monthly) start.setDate(1);
  const buckets = [];
  for (const cursor = new Date(start); cursor <= end;) {
    const next = new Date(cursor);
    if (monthly) next.setMonth(next.getMonth() + 1);
    else next.setDate(next.getDate() + 1);
    const entries = records.filter(
      (t) => t.timestamp >= cursor.getTime() && t.timestamp < next.getTime(),
    );
    buckets.push({
      timestamp: cursor.getTime(),
      label: cursor.toLocaleDateString(
        [],
        monthly
          ? { month: "short", year: "2-digit" }
          : period === "7d"
            ? { weekday: "short" }
            : { day: "numeric", month: "short" },
      ),
      fullLabel: cursor.toLocaleDateString(
        [],
        monthly
          ? { month: "long", year: "numeric" }
          : { month: "short", day: "numeric", year: "numeric" },
      ),
      words: entries.reduce((sum, t) => sum + t.wordCount, 0),
      sessions: entries.length,
    });
    cursor.setTime(next.getTime());
  }
  return buckets;
}

export function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
