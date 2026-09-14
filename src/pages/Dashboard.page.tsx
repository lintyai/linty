import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  AudioLines,
  Clock3,
  FileText,
  Layers3,
  ShieldCheck,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useHistory } from "@/hooks/useHistory.hook";
import { useAppStore } from "@/store/app.store";
import { AppIcon } from "@/components/shared/AppIcon.component";
import { StatCard } from "@/components/shared/StatCard.component";
import { useAppIcons } from "@/hooks/useAppIcons.hook";
import { useDictionary } from "@/hooks/useDictionary.hook";
import { correctionsPer100Words } from "@/lib/dictionary.util";
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
  // The full per-app breakdown lives on the Apps page; show the top three here.
  const topApps = usageByApplication(filtered)
    .filter((app) => app.attributed)
    .sort((a, b) => b.words - a.words || a.name.localeCompare(b.name))
    .slice(0, 3);
  const appIcons = useAppIcons(topApps.map((app) => app.bundleId));
  const { corrections } = useDictionary();
  // Real-use accuracy proxy: corrections the person made per 100 pasted words, per engine.
  const fixRate = (engine: "local" | "cloud") => {
    const ids = new Set(filtered.filter((t) => t.engine === engine).map((t) => t.transcriptId));
    const words = filtered.filter((t) => t.engine === engine).reduce((sum, t) => sum + t.wordCount, 0);
    return correctionsPer100Words(corrections.filter((c) => ids.has(c.transcriptId)), words);
  };
  const localFixRate = fixRate("local");
  const cloudFixRate = fixRate("cloud");
  const maxWords = Math.max(1, ...timeline.map((day) => day.words));
  const hasHistory = allTranscripts.length > 0;
  const openHistory = (query = "") => {
    setSearchQuery(query);
    setCurrentView("history");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="dashboard-scroll">
        <div className="dashboard-heading">
          <div>
            <h1>
              Your dictation
            </h1>
            <p className="text-text-secondary">
              Your recent words and activity, at a glance.
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
              <h2 className="font-semibold">Ready for your first dictation</h2>
              <p className="text-[12px] text-text-secondary">
                Open an app, hold <kbd>{formatTriggerLabel(triggerKey)}</kbd>,
                speak, then release to paste your words.
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
          />
          <StatCard
            icon={<Clock3 size={17} />}
            value={formatDuration(stats.seconds)}
            label="Time dictating"
            detail="From captured audio"
          />
          <StatCard
            icon={<Zap size={17} />}
            value={
              stats.sessions ? `${stats.avgProcessingSeconds.toFixed(1)}s` : "—"
            }
            label="Average turnaround"
            detail="Speech to paste attempt"
          />
          <StatCard
            icon={<TrendingUp size={17} />}
            value={stats.seconds ? number(stats.wordsPerMinute) : "—"}
            label="Words per minute"
            detail="Transcribed words per audio minute"
          />
        </div>

        <section className="insight-card recent-card">
          <div className="section-heading">
            <div>
              <h2>Recent transcriptions</h2>
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
                  onDelete={deleteTranscript}
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

        <div className="insights-grid">
          <section className="insight-card activity-card">
            <div className="section-heading">
              <div>
                <h2>Dictation activity</h2>
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
                    : "Activity will appear after your first dictation"}
                </div>
              )}
            </div>
          </section>

          <section className="insight-card privacy-card">
            <div className="section-heading">
              <div>
                <h2>Processing</h2>
                <p>How your speech was processed</p>
              </div>
              <ShieldCheck size={17} className="text-text-muted" />
            </div>
            <div className="privacy-summary">
              <div
                className="privacy-ring"
                role="img"
                aria-label={`${stats.localPercent}% of dictations processed locally`}

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
                    <i className="bg-text-secondary" />
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
              Corrections per 100 words: Local {localFixRate === null ? "—" : localFixRate.toFixed(1)} · Cloud {cloudFixRate === null ? "—" : cloudFixRate.toFixed(1)}. Counted from your edits in History.
            </p>
          </section>
        </div>

        <section className="insight-card applications-card">
          <div className="section-heading">
            <div>
              <h2>
                <Layers3 size={16} className="text-text-muted" /> Dictation by app
              </h2>
              <p>See where you use Linty most</p>
            </div>
            <button className="text-link" onClick={() => setCurrentView("apps")}>
              View all apps <ArrowRight size={13} />
            </button>
          </div>
          {topApps.length > 0 ? (
            <div className="app-table-scroll">
              <table className="app-usage-table">
                <thead>
                  <tr>
                    <th>Application</th>
                    <th>Words</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {topApps.map((app) => {
                    const share = stats.words
                      ? Math.round((app.words / stats.words) * 100)
                      : 0;
                    return (
                      <tr key={app.id}>
                        <td>
                          <button
                            className="app-name"
                            onClick={() => openHistory(app.name)}
                            title={`View ${app.name} transcripts`}
                          >
                            <AppIcon
                              name={app.name}
                              icon={app.bundleId ? appIcons[app.bundleId] : null}
                            />
                            <span className="min-w-0">
                              <strong>{app.name}</strong>
                              <span className="app-share-track">
                                <span style={{ width: `${share}%` }} />
                              </span>
                            </span>
                          </button>
                        </td>
                        <td className="font-semibold">{number(app.words)}</td>
                        <td>{share}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="app-empty">
              <h3>
                {tracking ? "No app activity yet" : "App attribution is paused"}
              </h3>
              <p>
                {tracking
                  ? "Dictate in your favorite apps to see where your words go."
                  : "Turn on app attribution in Settings → Privacy & Storage for new dictations."}
              </p>
            </div>
          )}
        </section>

        <p className="dashboard-footnote">
          Based on your last 500 saved transcriptions. Deleting history also
          removes its statistics.
        </p>
      </div>
    </div>
  );
}

