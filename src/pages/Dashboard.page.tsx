import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  AudioLines,
  Clock3,
  FileText,
  Layers3,
  Mic,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useHistory } from "@/hooks/useHistory.hook";
import { useAppStore } from "@/store/app.store";
import { TranscriptRow } from "@/components/shared/TranscriptRow.component";
import { TranscriptActions } from "@/components/shared/TranscriptActions.component";
import { cn } from "@/lib/utils";
import {
  filterByPeriod,
  formatDuration,
  summarizeUsage,
  usageByApplication,
  usageTimeline,
  type UsagePeriod,
} from "@/lib/usage.util";
import { formatTriggerLabel } from "@/lib/trigger.util";

const number = (value: number) => value.toLocaleString();

export function DashboardPage() {
  const { allTranscripts, deleteTranscript, setSearchQuery } = useHistory();
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const triggerKey = useAppStore((s) => s.triggerKey);
  const tracking = useAppStore((s) => s.trackApplicationUsage);
  const [period, setPeriod] = useState<UsagePeriod>("7d");
  const [sort, setSort] = useState<"words" | "seconds">("words");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const { filtered, timeline } = useMemo(() => {
    // Use the same clock for the cards and chart when a session crosses midnight.
    const asOf = Math.max(now, Date.now());
    const filtered = filterByPeriod(allTranscripts, period, asOf);
    return { filtered, timeline: usageTimeline(filtered, period, asOf) };
  }, [allTranscripts, period, now]);
  const stats = summarizeUsage(filtered);
  const apps = usageByApplication(filtered).sort(
    (a, b) => b[sort] - a[sort] || a.name.localeCompare(b.name),
  );
  const maxWords = Math.max(1, ...timeline.map((day) => day.words));
  const topApp = apps
    .filter((app) => app.attributed)
    .sort((a, b) => b.words - a.words)[0];
  const hasHistory = allTranscripts.length > 0;
  const openHistory = (query = "") => {
    setSearchQuery(query);
    setCurrentView("history");
  };

  return (
    <div className="flex h-full flex-col">
      <header data-tauri-drag-region className="page-toolbar">
        <span
          data-tauri-drag-region
          className="text-[13px] font-medium text-text-secondary"
        >
          Your workspace <span className="mx-2 text-border">/</span>{" "}
          <span className="text-text-primary">Overview</span>
        </span>
        <span className="local-badge">
          <ShieldCheck size={12} /> Stored on this Mac
        </span>
      </header>
      <main className="dashboard-scroll">
        <div className="dashboard-heading">
          <div>
            <p className="eyebrow">A LITTLE VOICE. A LOT OF POSSIBILITY.</p>
            <h1>
              Your words, at work<span className="text-accent">.</span>
            </h1>
            <p className="text-text-secondary">
              A clearer picture of where your voice takes you.
            </p>
          </div>
          <div className="period-control" aria-label="Usage period">
            {(["7d", "30d", "all"] as UsagePeriod[]).map((p) => (
              <button
                key={p}
                aria-pressed={period === p}
                onClick={() => setPeriod(p)}
                className={cn(period === p && "is-selected")}
              >
                {p === "7d" ? "7 days" : p === "30d" ? "30 days" : "All time"}
              </button>
            ))}
          </div>
        </div>

        {!hasHistory && (
          <div className="first-dictation-banner animate-slide-up">
            <div className="voice-mark">
              <AudioLines size={24} />
            </div>
            <div className="flex-1">
              <h2 className="font-semibold">Your next thought starts here</h2>
              <p className="text-[12px] text-text-secondary">
                Open an app, hold <kbd>{formatTriggerLabel(triggerKey)}</kbd>,
                and speak. Your real stats will appear here.
              </p>
            </div>
            <button
              onClick={() => setCurrentView("system-check")}
              className="text-link"
            >
              Check setup <ArrowRight size={14} />
            </button>
          </div>
        )}

        <div className="stat-grid">
          <StatCard
            icon={<FileText size={17} />}
            value={number(stats.words)}
            label="Words transcribed"
            detail={`${number(stats.sessions)} completed dictation${stats.sessions === 1 ? "" : "s"}`}
            color="coral"
            delay={0}
          />
          <StatCard
            icon={<Clock3 size={17} />}
            value={formatDuration(stats.seconds)}
            label="Time dictating"
            detail="From captured audio"
            color="blue"
            delay={1}
          />
          <StatCard
            icon={<Zap size={17} />}
            value={
              stats.sessions ? `${stats.avgProcessingSeconds.toFixed(1)}s` : "—"
            }
            label="Average turnaround"
            detail="Transcription through paste attempt"
            color="amber"
            delay={2}
          />
          <StatCard
            icon={<TrendingUp size={17} />}
            value={stats.seconds ? number(stats.wordsPerMinute) : "—"}
            label="Words per minute"
            detail="Output words ÷ dictation minutes"
            color="green"
            delay={3}
          />
        </div>

        <div className="insights-grid">
          <section className="insight-card activity-card">
            <div className="section-heading">
              <div>
                <h2>Find your flow</h2>
                <p>Words transcribed over time</p>
              </div>
              <span className="metric-pill">{number(stats.words)} words</span>
            </div>
            <div
              className="usage-chart"
              style={{ gap: timeline.length > 14 ? 3 : 8 }}
              role="group"
              aria-label="Words transcribed over time"
            >
              <div className="chart-grid" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              {timeline.map((day, i) => (
                <div className="chart-column" key={day.timestamp}>
                  <div className="chart-track">
                    <button
                      className={cn(
                        "chart-bar",
                        i === timeline.length - 1 && "is-latest",
                        day.words === 0 && "is-empty",
                      )}
                      style={{
                        height: day.words
                          ? `${Math.max(2, (day.words / maxWords) * 100)}%`
                          : "3px",
                        animationDelay: `${Math.min(i * 25, 400)}ms`,
                      }}
                      aria-label={`${day.fullLabel}: ${number(day.words)} words, ${day.sessions} dictations`}
                    >
                      <span className="chart-tooltip">
                        {day.fullLabel}
                        <strong>
                          {number(day.words)} words · {day.sessions} dictations
                        </strong>
                      </span>
                    </button>
                  </div>
                  <span className="chart-label">
                    {timeline.length <= 8 ||
                    i === 0 ||
                    i === timeline.length - 1 ||
                    i % Math.ceil(timeline.length / 5) === 0
                      ? day.label
                      : ""}
                  </span>
                </div>
              ))}
              {!stats.words && (
                <div className="chart-empty">
                  {hasHistory
                    ? "No words in this period"
                    : "Your first words will start the story"}
                </div>
              )}
            </div>
          </section>

          <section className="insight-card privacy-card">
            <div className="section-heading">
              <div>
                <h2>On your terms</h2>
                <p>How your speech was processed</p>
              </div>
              <ShieldCheck size={17} className="text-success" />
            </div>
            <div className="privacy-summary">
              <div
                className="privacy-ring"
                role="img"
                aria-label={`${stats.localPercent}% of dictations processed locally`}
                style={{
                  background: `conic-gradient(var(--color-success) ${stats.localPercent}%, var(--color-border-subtle) 0)`,
                }}
              >
                <div>
                  <strong>
                    {stats.sessions ? `${stats.localPercent}%` : "—"}
                  </strong>
                  <span>on-device</span>
                </div>
              </div>
              <div className="flex-1 space-y-3">
                <div className="engine-legend">
                  <span>
                    <i className="bg-success" />
                    Local
                  </span>
                  <strong>{number(stats.local)}</strong>
                </div>
                <div className="engine-legend">
                  <span>
                    <i className="bg-border" />
                    Cloud
                  </span>
                  <strong>{number(stats.sessions - stats.local)}</strong>
                </div>
              </div>
            </div>
            <p className="privacy-caption">
              App usage stays on this Mac, with either speech engine.
            </p>
          </section>
        </div>

        <section className="insight-card applications-card">
          <div className="section-heading">
            <div>
              <h2>
                <Layers3 size={16} className="text-accent" /> Dictation by app
              </h2>
              <p>See where you use Linty most</p>
            </div>
            <label className="sort-control">
              <span>Sort by</span>
              <select
                aria-label="Sort applications"
                value={sort}
                onChange={(event) =>
                  setSort(event.target.value as "words" | "seconds")
                }
              >
                <option value="words">Words</option>
                <option value="seconds">Dictation time</option>
              </select>
            </label>
          </div>
          {apps.length > 0 ? (
            <div className="app-table-scroll">
              <table className="app-usage-table">
                <thead>
                  <tr>
                    <th>Application</th>
                    <th>Words</th>
                    <th>Dictation time</th>
                    <th>Sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {apps.map((app, index) => (
                    <tr key={app.id}>
                      <td>
                        <button
                          className="app-name"
                          disabled={!app.attributed}
                          onClick={() => openHistory(app.name)}
                          title={
                            app.attributed
                              ? `View ${app.name} transcripts`
                              : "Older sessions or app attribution unavailable"
                          }
                        >
                          <span className={`app-avatar app-tone-${index % 4}`}>
                            {app.attributed
                              ? app.name.slice(0, 1).toUpperCase()
                              : "?"}
                          </span>
                          <span className="min-w-0">
                            <strong>{app.name}</strong>
                            <span className="app-share-track">
                              <span
                                style={{
                                  width: `${stats.words ? (app.words / stats.words) * 100 : 0}%`,
                                }}
                              />
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="font-semibold">{number(app.words)}</td>
                      <td title={`${(app.seconds / 3600).toFixed(3)} hours`}>
                        {formatDuration(app.seconds)}
                      </td>
                      <td>{number(app.sessions)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="app-empty">
              <div className="empty-app-icons">
                <span>
                  <FileText size={19} />
                </span>
                <span>
                  <Mic size={22} />
                </span>
                <span>
                  <Layers3 size={19} />
                </span>
              </div>
              <h3>
                {tracking
                  ? "Your voice works everywhere"
                  : "App attribution is paused"}
              </h3>
              <p>
                {tracking
                  ? "Dictate in your favorite apps to see their words, time, and sessions here."
                  : "Turn on app attribution in Settings → Privacy & Storage for new dictations."}
              </p>
            </div>
          )}
          <div className="app-usage-note">
            <ShieldCheck size={13} />
            <span>
              App captured when dictation starts. Time counts dictation only.{" "}
              {tracking
                ? "Saved locally."
                : "Attribution paused for new sessions."}
            </span>
          </div>
        </section>

        {topApp && (
          <div className="usage-insight">
            <Sparkles size={16} />
            <p>
              <strong>{topApp.name}</strong> is your most used app by words in
              this period, with <strong>{number(topApp.words)}</strong> words
              across {topApp.sessions} dictation
              {topApp.sessions === 1 ? "" : "s"}.
            </p>
          </div>
        )}

        <section className="insight-card recent-card">
          <div className="section-heading">
            <div>
              <h2>Fresh off the mic</h2>
              <p>Your latest dictations in this period</p>
            </div>
            <button className="text-link" onClick={() => openHistory()}>
              View history <ArrowRight size={13} />
            </button>
          </div>
          {filtered.length ? (
            filtered
              .slice(0, 5)
              .map((t) => (
                <TranscriptRow
                  key={t.transcriptId}
                  transcript={t}
                  className="border-t border-border-subtle"
                  actions={
                    <TranscriptActions
                      transcript={t}
                      onDelete={deleteTranscript}
                    />
                  }
                />
              ))
          ) : (
            <p className="px-5 pb-6 text-[12px] text-text-muted">
              {hasHistory
                ? "No dictations in this period. Try a wider time range."
                : "Your completed dictations will appear here."}
            </p>
          )}
        </section>
        <p className="dashboard-footnote">
          Based on your last 500 saved transcriptions. Deleting history also
          removes its statistics.
        </p>
      </main>
    </div>
  );
}

function StatCard({
  icon,
  value,
  label,
  detail,
  color,
  delay,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  detail: string;
  color: string;
  delay: number;
}) {
  return (
    <section
      className={`stat-card stat-${color}`}
      style={{ animationDelay: `${delay * 55}ms` }}
    >
      <div className="stat-card-top">
        <span>{label}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <div className="stat-value" key={value}>
        {value}
      </div>
      <p>{detail}</p>
    </section>
  );
}
