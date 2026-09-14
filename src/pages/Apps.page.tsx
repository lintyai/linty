import { useEffect, useMemo, useState } from "react";
import {
  Clock3,
  FileText,
  Layers3,
  ShieldCheck,
  Sparkles,
  Trophy,
} from "lucide-react";
import { useHistory } from "@/hooks/useHistory.hook";
import { useAppStore } from "@/store/app.store";
import { StatCard } from "@/components/shared/StatCard.component";
import { cn } from "@/lib/utils";
import {
  filterByPeriod,
  formatDayLabel,
  formatDuration,
  summarizeUsage,
  usageByApplication,
  type ApplicationUsage,
  type UsagePeriod,
} from "@/lib/usage.util";

const number = (value: number) => value.toLocaleString();

type SortKey = "words" | "seconds" | "sessions" | "lastUsedAt";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "words", label: "Words" },
  { value: "seconds", label: "Dictation time" },
  { value: "sessions", label: "Sessions" },
  { value: "lastUsedAt", label: "Last used" },
];

/** Per-application dictation statistics for the selected period. */
export function AppsPage() {
  const { allTranscripts, setSearchQuery } = useHistory();
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const setSettingsSection = useAppStore((s) => s.setSettingsSection);
  const tracking = useAppStore((s) => s.trackApplicationUsage);
  const [period, setPeriod] = useState<UsagePeriod>("30d");
  const [sort, setSort] = useState<SortKey>("words");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const asOf = Math.max(now, Date.now());
  const filtered = useMemo(
    () => filterByPeriod(allTranscripts, period, asOf),
    [allTranscripts, period, asOf],
  );
  const stats = summarizeUsage(filtered);
  const apps = useMemo(
    () =>
      usageByApplication(filtered).sort(
        (a, b) => b[sort] - a[sort] || a.name.localeCompare(b.name),
      ),
    [filtered, sort],
  );
  const attributed = apps.filter((app) => app.attributed);
  const attributedWords = attributed.reduce((sum, app) => sum + app.words, 0);
  const attributedSeconds = attributed.reduce((sum, app) => sum + app.seconds, 0);
  const topApp = [...attributed].sort((a, b) => b.words - a.words)[0];
  const hasHistory = allTranscripts.length > 0;
  const openHistory = (query: string) => {
    setSearchQuery(query);
    setCurrentView("history");
  };
  const share = (app: ApplicationUsage) =>
    stats.words ? Math.round((app.words / stats.words) * 100) : 0;
  // Share strip: the top apps by words plus one "Other" segment, shaded by rank.
  const byWords = [...attributed].sort((a, b) => b.words - a.words);
  const segments = byWords.slice(0, 5).map((app, i) => ({
    id: app.id,
    name: app.name,
    words: app.words,
    opacity: 1 - i * 0.16,
  }));
  const otherWords = byWords.slice(5).reduce((sum, app) => sum + app.words, 0);
  if (otherWords > 0) {
    segments.push({ id: "other", name: "Other apps", words: otherWords, opacity: 0.2 });
  }
  const segmentWidth = (words: number) =>
    attributedWords ? (words / attributedWords) * 100 : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="dashboard-scroll">
        <div className="dashboard-heading">
          <div>
            <h1>Dictation by app</h1>
            <p className="text-text-secondary">See where you use Linty most.</p>
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

        <div className="stat-grid">
          <StatCard
            icon={<Layers3 size={17} />}
            value={number(attributed.length)}
            label="Apps used"
            detail={`${number(attributed.reduce((sum, app) => sum + app.sessions, 0))} attributed dictation${attributed.length === 1 ? "" : "s"}`}
          />
          <StatCard
            icon={<Trophy size={17} />}
            value={topApp ? topApp.name : "—"}
            label="Most used"
            detail={topApp ? `${number(topApp.words)} words · ${share(topApp)}% of all words` : "By words in this period"}
          />
          <StatCard
            icon={<FileText size={17} />}
            value={number(attributedWords)}
            label="Words in apps"
            detail={
              stats.words
                ? `${Math.round((attributedWords / stats.words) * 100)}% of ${number(stats.words)} words attributed`
                : "Words dictated into a known app"
            }
          />
          <StatCard
            icon={<Clock3 size={17} />}
            value={formatDuration(attributedSeconds)}
            label="Time in apps"
            detail="Dictation time with a known app"
          />
        </div>

        <section className="insight-card applications-card">
          <div className="section-heading">
            <div>
              <h2>
                <Layers3 size={16} className="text-text-muted" /> All apps
              </h2>
              <p>Every app you dictated into during this period</p>
            </div>
            <label className="sort-control">
              <span>Sort by</span>
              <select
                aria-label="Sort applications"
                value={sort}
                onChange={(event) => setSort(event.target.value as SortKey)}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {segments.length > 0 && (
            <>
              <div
                className="app-share-bar"
                role="img"
                aria-label={`Share of words by app: ${segments
                  .map((s) => `${s.name} ${Math.round(segmentWidth(s.words))}%`)
                  .join(", ")}`}
              >
                {segments.map((s) => (
                  <span
                    key={s.id}
                    style={{
                      width: `${segmentWidth(s.words)}%`,
                      ["--share-opacity" as string]: s.opacity,
                    }}
                  />
                ))}
              </div>
              <div className="app-share-legend" aria-hidden="true">
                {segments.map((s) => (
                  <span key={s.id}>
                    <i style={{ ["--share-opacity" as string]: s.opacity }} />
                    {s.name} <strong>{Math.round(segmentWidth(s.words))}%</strong>
                  </span>
                ))}
              </div>
            </>
          )}
          {apps.length > 0 ? (
            <div className="app-table-scroll">
              <table className="app-usage-table is-dense">
                <thead>
                  <tr>
                    <th>Application</th>
                    <th>Words</th>
                    <th>Dictation time</th>
                    <th>Sessions</th>
                    <th>Words / session</th>
                    <th>Avg length</th>
                    <th>Turnaround</th>
                    <th>Last used</th>
                  </tr>
                </thead>
                <tbody>
                  {apps.map((app) => (
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
                          <span className="app-avatar">
                            {app.attributed ? app.name.slice(0, 1).toUpperCase() : "?"}
                          </span>
                          <span className="min-w-0">
                            <strong>{app.name}</strong>
                            <span className="app-share-track">
                              <span style={{ width: `${share(app)}%` }} />
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="font-semibold" title={`${share(app)}% of all words`}>
                        {number(app.words)}
                      </td>
                      <td title={`${(app.seconds / 3600).toFixed(3)} hours`}>
                        {formatDuration(app.seconds)}
                      </td>
                      <td>{number(app.sessions)}</td>
                      <td>{number(Math.round(app.words / app.sessions))}</td>
                      <td>{formatDuration(app.seconds / app.sessions)}</td>
                      <td
                        title={`${app.local} of ${app.sessions} processed on-device`}
                      >
                        {(app.processingMs / app.sessions / 1000).toFixed(1)}s
                      </td>
                      <td>{formatDayLabel(app.lastUsedAt, asOf)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="app-empty">
              <h3>
                {!hasHistory
                  ? "No dictations yet"
                  : tracking
                    ? "No app activity in this period"
                    : "App attribution is paused"}
              </h3>
              <p>
                {!hasHistory
                  ? "Dictate in your favorite apps to see their words, time, and sessions here."
                  : tracking
                    ? "Try a wider time range, or dictate in an app to start tracking it."
                    : "Turn on app attribution in Settings → Privacy & Storage for new dictations."}
              </p>
              {hasHistory && !tracking && (
                <button
                  className="text-link mt-3"
                  onClick={() => setSettingsSection("privacy")}
                >
                  Open privacy settings
                </button>
              )}
            </div>
          )}
          <div className="app-usage-note">
            <ShieldCheck size={13} />
            <span>
              App captured when dictation starts. Time counts dictation only.{" "}
              {tracking ? "Saved locally." : "Attribution paused for new sessions."}
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

        <p className="dashboard-footnote">
          Based on your last 500 saved transcriptions. Deleting history also
          removes its statistics.
        </p>
      </div>
    </div>
  );
}
