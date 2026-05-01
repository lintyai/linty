import { useState, useMemo } from "react";
import {
  Mic,
  Clock,
  Zap,
  BarChart3,
  FileText,
  ArrowRight,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { useHistory } from "@/hooks/useHistory.hook";
import { useAppStore } from "@/store/app.store";
import { EmptyState } from "@/components/shared/EmptyState.component";
import { TranscriptRow } from "@/components/shared/TranscriptRow.component";
import { TranscriptActions } from "@/components/shared/TranscriptActions.component";
import { cn } from "@/lib/utils";

type Period = "7d" | "30d" | "all";

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds.toFixed(0)}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

export function DashboardPage() {
  const { allTranscripts, deleteTranscript } = useHistory();
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const [period, setPeriod] = useState<Period>("7d");

  const now = Date.now();
  const periodMs =
    period === "7d"
      ? 7 * 86400000
      : period === "30d"
        ? 30 * 86400000
        : Infinity;

  const filtered = allTranscripts.filter((t) => now - t.timestamp < periodMs);

  const stats = {
    total: filtered.length,
    totalRecording: filtered.reduce((s, t) => s + t.durationSeconds, 0),
    avgSpeed:
      filtered.length > 0
        ? filtered.reduce((s, t) => s + t.processingTimeMs, 0) /
          filtered.length /
          1000
        : 0,
    cloudCount: filtered.filter((t) => t.engine === "cloud").length,
    localCount: filtered.filter((t) => t.engine === "local").length,
    totalWords: filtered.reduce((s, t) => s + t.wordCount, 0),
  };

  const localPct =
    stats.total > 0 ? Math.round((stats.localCount / stats.total) * 100) : 0;
  const cloudPct = stats.total > 0 ? 100 - localPct : 0;

  const todayStats = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    const todayCount = allTranscripts.filter(
      (t) => t.timestamp >= todayStart.getTime(),
    ).length;
    const yesterdayCount = allTranscripts.filter(
      (t) =>
        t.timestamp >= yesterdayStart.getTime() &&
        t.timestamp < todayStart.getTime(),
    ).length;

    const delta =
      yesterdayCount > 0
        ? Math.round(((todayCount - yesterdayCount) / yesterdayCount) * 100)
        : todayCount > 0
          ? 100
          : 0;

    return { todayCount, delta };
  }, [allTranscripts]);

  const dayBuckets: { label: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(now);
    dayStart.setDate(dayStart.getDate() - i);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const count = allTranscripts.filter(
      (t) =>
        t.timestamp >= dayStart.getTime() && t.timestamp < dayEnd.getTime(),
    ).length;
    dayBuckets.push({
      label: dayStart.toLocaleDateString([], { weekday: "short" }),
      count,
    });
  }
  const maxBucket = Math.max(...dayBuckets.map((b) => b.count), 1);

  if (allTranscripts.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <div
          data-tauri-drag-region
          className="flex h-[52px] shrink-0 items-center px-6"
        >
          <h1
            className="text-[16px] font-semibold text-text-primary tracking-[-0.01em]"
            data-tauri-drag-region
          >
            Dashboard
          </h1>
        </div>
        <EmptyState
          icon={<BarChart3 size={22} />}
          title="Not enough data"
          description="Complete a few transcriptions to see your usage statistics here."
          className="flex-1"
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div
        data-tauri-drag-region
        className="flex h-[52px] shrink-0 items-center justify-between px-6"
      >
        <h1
          className="text-[16px] font-semibold text-text-primary tracking-[-0.01em]"
          data-tauri-drag-region
        >
          Dashboard
        </h1>
        <div className="flex gap-px rounded-[var(--radius-sm)] bg-bg-input p-[3px] ring-1 ring-border-subtle">
          {(["7d", "30d", "all"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "rounded-[5px] px-3 py-[5px] text-[12px] font-medium transition-all duration-150",
                period === p
                  ? "bg-bg-elevated text-text-primary shadow-[var(--shadow-sm)] ring-1 ring-border"
                  : "text-text-muted hover:text-text-secondary",
              )}
            >
              {p === "7d" ? "7 days" : p === "30d" ? "30 days" : "All time"}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex flex-col gap-3.5 shrink-0 px-6 pt-4 pb-3">
          {/* Hero metric + stat cards row */}
          <div className="grid grid-cols-5 gap-3">
            {/* Hero: Today's count */}
            <div
              className="col-span-1 rounded-[var(--radius-md)] bg-bg-elevated shadow-[var(--shadow-sm)] ring-1 ring-border-subtle p-4 flex flex-col justify-between animate-slide-up"
              style={{ animationFillMode: "both" }}
            >
              <span className="text-[11px] font-medium text-text-muted uppercase tracking-wide">
                Today
              </span>
              <div className="mt-1">
                <span className="text-[36px] font-bold text-text-primary leading-none tracking-tight tabular-nums">
                  {todayStats.todayCount}
                </span>
                {todayStats.delta !== 0 && (
                  <div className={cn(
                    "flex items-center gap-0.5 mt-1 text-[11px] font-medium",
                    todayStats.delta > 0 ? "text-success" : "text-error",
                  )}>
                    {todayStats.delta > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                    {todayStats.delta > 0 ? "+" : ""}{todayStats.delta}%
                  </div>
                )}
              </div>
            </div>

            {/* Stat cards */}
            <StatCard
              icon={<Mic size={13} />}
              iconColor="accent"
              value={stats.total.toString()}
              label="Transcriptions"
              delay={1}
            />
            <StatCard
              icon={<Clock size={13} />}
              iconColor="info"
              value={formatDuration(stats.totalRecording)}
              label="Recorded"
              delay={2}
            />
            <StatCard
              icon={<Zap size={13} />}
              iconColor="warning"
              value={stats.avgSpeed > 0 ? `${stats.avgSpeed.toFixed(1)}s` : "—"}
              label="Avg speed"
              delay={3}
            />
            <StatCard
              icon={<FileText size={13} />}
              iconColor="success"
              value={formatNumber(stats.totalWords)}
              label="Words"
              delay={4}
            />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-2 gap-3">
            {/* Bar chart */}
            <div className="rounded-[var(--radius-md)] bg-bg-elevated shadow-[var(--shadow-sm)] ring-1 ring-border-subtle p-4 flex flex-col">
              <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-3">
                Usage trend
              </h3>
              <div className="flex items-end gap-1.5 flex-1 min-h-0">
                {dayBuckets.map((bucket, i) => {
                  const isToday = i === dayBuckets.length - 1;
                  const barPct = Math.max(6, (bucket.count / maxBucket) * 100);
                  return (
                    <div
                      key={i}
                      className="flex flex-1 flex-col items-center gap-1.5 h-full"
                    >
                      <div className="relative w-full flex items-end justify-center flex-1 group">
                        {bucket.count > 0 && (
                          <span className="absolute -top-4 text-[10px] font-medium text-text-secondary tabular-nums opacity-0 group-hover:opacity-100 transition-opacity">
                            {bucket.count}
                          </span>
                        )}
                        <div
                          className={cn(
                            "w-full max-w-[22px] rounded-t-[3px] rounded-b-[1px] transition-all duration-300",
                            isToday
                              ? "bg-accent"
                              : bucket.count > 0
                                ? "bg-accent/40"
                                : "bg-border-subtle",
                          )}
                          style={{ height: `${barPct}%` }}
                        />
                      </div>
                      <span
                        className={cn(
                          "text-[10px] tabular-nums shrink-0",
                          isToday
                            ? "text-text-secondary font-medium"
                            : "text-text-muted",
                        )}
                      >
                        {bucket.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Engine split */}
            <div className="rounded-[var(--radius-md)] bg-bg-elevated shadow-[var(--shadow-sm)] ring-1 ring-border-subtle p-4 flex flex-col">
              <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-3">
                Engine split
              </h3>
              <div className="flex items-center gap-4 flex-1 min-h-0">
                <div className="relative h-[72px] w-[72px] shrink-0">
                  <svg viewBox="0 0 36 36" className="h-[72px] w-[72px] -rotate-90">
                    <circle
                      cx="18"
                      cy="18"
                      r="15"
                      fill="none"
                      stroke="var(--color-border-subtle)"
                      strokeWidth="5"
                    />
                    {cloudPct > 0 && (
                      <circle
                        cx="18"
                        cy="18"
                        r="15"
                        fill="none"
                        stroke="var(--color-info)"
                        strokeWidth="5"
                        strokeDasharray={`${cloudPct} ${100 - cloudPct}`}
                        strokeDashoffset="0"
                        strokeLinecap="round"
                        className="transition-all duration-500"
                      />
                    )}
                    {localPct > 0 && (
                      <circle
                        cx="18"
                        cy="18"
                        r="15"
                        fill="none"
                        stroke="var(--color-success)"
                        strokeWidth="5"
                        strokeDasharray={`${localPct} ${100 - localPct}`}
                        strokeDashoffset={`${-cloudPct}`}
                        strokeLinecap="round"
                        className="transition-all duration-500"
                      />
                    )}
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[15px] font-bold text-text-primary tabular-nums">
                      {stats.total}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-3 flex-1 min-w-0">
                  <EngineRow
                    color="success"
                    label="Local"
                    count={stats.localCount}
                    total={stats.total}
                  />
                  <EngineRow
                    color="info"
                    label="Cloud"
                    count={stats.cloudCount}
                    total={stats.total}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Activity */}
        <div className="flex-1 flex flex-col min-h-0 px-6 pb-4">
          <div className="flex items-center justify-between py-2.5 shrink-0">
            <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">
              Recent Activity
            </h3>
            <button
              onClick={() => setCurrentView("history")}
              className="flex items-center gap-1 text-[11px] font-medium text-text-muted hover:text-accent transition-colors duration-150"
            >
              View all
              <ArrowRight size={11} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto rounded-[var(--radius-md)] bg-bg-elevated shadow-[var(--shadow-sm)] ring-1 ring-border-subtle">
            {filtered.length === 0 ? (
              <EmptyState
                icon={<Clock size={22} />}
                title={`No activity in the last ${period === "7d" ? "7 days" : "30 days"}`}
                description="Try selecting a longer time range."
              />
            ) : (
              filtered.map((t, i) => (
                <TranscriptRow
                  key={t.transcriptId}
                  transcript={t}
                  className={cn(
                    i < filtered.length - 1 &&
                      "border-b border-border-subtle",
                  )}
                  actions={
                    <TranscriptActions
                      transcript={t}
                      onDelete={deleteTranscript}
                    />
                  }
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const iconColorMap = {
  accent: "bg-accent-glow text-accent",
  success: "bg-success-glow text-success",
  warning: "bg-warning-glow text-warning",
  info: "bg-info-glow text-info",
  error: "bg-error-glow text-error",
} as const;

function StatCard({
  icon,
  iconColor,
  value,
  label,
  delay,
}: {
  icon: React.ReactNode;
  iconColor: keyof typeof iconColorMap;
  value: string;
  label: string;
  delay: number;
}) {
  return (
    <div
      className="rounded-[var(--radius-md)] bg-bg-elevated shadow-[var(--shadow-sm)] ring-1 ring-border-subtle p-3.5 animate-slide-up"
      style={{ animationDelay: `${delay * 40}ms`, animationFillMode: "both" }}
    >
      <div
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] mb-2.5",
          iconColorMap[iconColor],
        )}
      >
        {icon}
      </div>
      <div className="text-[18px] font-semibold text-text-primary tracking-tight leading-none mb-1 tabular-nums">
        {value}
      </div>
      <div className="text-[11px] text-text-muted">{label}</div>
    </div>
  );
}

function EngineRow({
  color,
  label,
  count,
  total,
}: {
  color: "success" | "info";
  label: string;
  count: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[12px] text-text-secondary font-medium">
          <span
            className={cn(
              "inline-block h-2 w-2 rounded-full",
              color === "success" ? "bg-success" : "bg-info",
            )}
          />
          {label}
        </span>
        <span className="text-[12px] text-text-primary tabular-nums font-medium">
          {count}
          <span className="text-text-muted ml-1 font-normal">({pct}%)</span>
        </span>
      </div>
      <div className="h-1 w-full rounded-full bg-border-subtle overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            color === "success" ? "bg-success" : "bg-info",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
