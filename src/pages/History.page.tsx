import {
  Search,
  X,
  Mic,
  Sparkles,
  Zap,
  Wand2,
  Timer,
  Cloud,
  Cpu,
  Copy,
} from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useHistory } from "@/hooks/useHistory.hook";
import { useToast } from "@/hooks/useToast.hook";
import { EmptyState } from "@/components/shared/EmptyState.component";
import { TranscriptRow } from "@/components/shared/TranscriptRow.component";
import { TranscriptActions } from "@/components/shared/TranscriptActions.component";
import { cn } from "@/lib/utils";
import type { TranscriptRecord } from "@/types/transcript.types";

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
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

function groupByDate(
  transcripts: TranscriptRecord[],
): { date: string; items: TranscriptRecord[] }[] {
  const groups = new Map<string, TranscriptRecord[]>();
  for (const t of transcripts) {
    const dateKey = formatDate(t.timestamp);
    if (!groups.has(dateKey)) groups.set(dateKey, []);
    groups.get(dateKey)!.push(t);
  }
  return Array.from(groups.entries()).map(([date, items]) => ({ date, items }));
}

function MetricPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full bg-bg-hover px-2.5 py-1 text-[10px]">
      <span className="text-text-muted">{icon}</span>
      <span className="text-text-muted">{label}</span>
      <span className="font-medium tabular-nums text-text-secondary">{value}</span>
    </div>
  );
}

export function HistoryPage() {
  const {
    transcripts,
    allTranscripts,
    searchQuery,
    deleteTranscript,
    setSearchQuery,
    selectedTranscriptId,
    setSelectedTranscriptId,
  } = useHistory();
  const { success } = useToast();

  const groups = groupByDate(transcripts);
  const selectedTranscript = allTranscripts.find(
    (t) => t.transcriptId === selectedTranscriptId,
  );

  const handleDeleteWithDeselect = async (transcriptId: string) => {
    await deleteTranscript(transcriptId);
    if (selectedTranscriptId === transcriptId) {
      setSelectedTranscriptId(null);
    }
  };

  const handleCopyContent = async () => {
    if (!selectedTranscript) return;
    await writeText(selectedTranscript.finalText);
    success("Copied to clipboard");
  };

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
          History
        </h1>
        {allTranscripts.length > 0 && (
          <div className="relative">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              spellCheck={false}
              className={cn(
                "w-[180px] rounded-[var(--radius-sm)] bg-bg-elevated/60 py-[6px] pl-[30px]",
                "text-[12px] text-text-primary placeholder:text-text-muted",
                "outline-none ring-1 ring-border-subtle transition-all duration-200",
                "focus:ring-border-focus focus:bg-bg-elevated focus:w-[220px]",
                searchQuery ? "pr-7" : "pr-2.5",
              )}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 flex h-4 w-4 items-center justify-center rounded text-text-muted hover:text-text-secondary transition-colors"
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 min-h-0">
        {/* List */}
        <div
          className={cn(
            "flex flex-col overflow-y-auto",
            selectedTranscript
              ? "w-[55%] border-r border-border-subtle"
              : "w-full",
          )}
        >
          {allTranscripts.length === 0 ? (
            <EmptyState
              icon={<Mic size={22} />}
              title="No transcriptions yet"
              description="Press fn to start your first recording. Your transcriptions will appear here."
            />
          ) : transcripts.length === 0 ? (
            <EmptyState
              icon={<Search size={22} />}
              title="No results"
              description="Try a different search term."
            />
          ) : (
            groups.map((group) => (
              <div key={group.date}>
                <div
                  className="sticky top-0 z-10 px-5 py-2 border-b border-border-subtle"
                  style={{
                    background: "var(--color-bg-secondary)",
                    backdropFilter: "blur(8px) saturate(1.4)",
                    WebkitBackdropFilter: "blur(8px) saturate(1.4)",
                  }}
                >
                  <span className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
                    {group.date}
                  </span>
                </div>
                {group.items.map((t) => (
                  <TranscriptRow
                    key={t.transcriptId}
                    transcript={t}
                    selected={selectedTranscriptId === t.transcriptId}
                    onClick={() => setSelectedTranscriptId(t.transcriptId)}
                    className="border-b border-border-subtle"
                    actions={
                      <TranscriptActions
                        transcript={t}
                        onDelete={handleDeleteWithDeselect}
                        stopPropagation
                      />
                    }
                  />
                ))}
              </div>
            ))
          )}
        </div>

        {/* Detail panel */}
        {selectedTranscript && (
          <div className="flex-1 flex flex-col min-w-0 animate-slide-in-right">
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
              <button
                onClick={handleCopyContent}
                className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text-secondary transition-colors"
              >
                <Copy size={11} />
                Click to copy
              </button>
              <button
                onClick={() => setSelectedTranscriptId(null)}
                className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-bg-hover hover:text-text-secondary transition-all"
              >
                <X size={13} />
              </button>
            </div>

            <div
              onClick={handleCopyContent}
              className="flex-1 overflow-y-auto p-5 space-y-4 cursor-pointer rounded-md transition-colors duration-150 hover:bg-bg-elevated/30 active:bg-bg-elevated/50"
            >
              {selectedTranscript.corrected &&
                selectedTranscript.rawText !== selectedTranscript.finalText && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Mic size={12} className="text-text-muted" />
                      <span className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
                        Dictated
                      </span>
                    </div>
                    <p className="text-[13px] leading-[1.7] text-text-secondary select-text whitespace-pre-wrap">
                      {selectedTranscript.rawText}
                    </p>
                  </div>
                )}

              <div>
                {selectedTranscript.corrected &&
                  selectedTranscript.rawText !==
                    selectedTranscript.finalText && (
                    <div className="flex items-center gap-1.5 mb-2">
                      <Sparkles size={12} className="text-accent" />
                      <span className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
                        Corrected
                      </span>
                    </div>
                  )}
                <p className="text-[13px] leading-[1.7] text-text-primary select-text whitespace-pre-wrap">
                  {selectedTranscript.finalText}
                </p>
              </div>
            </div>

            {/* Metrics footer */}
            <div className="flex flex-wrap items-center gap-1.5 border-t border-border-subtle px-4 py-3">
              <MetricPill
                icon={selectedTranscript.engine === "cloud" ? <Cloud size={9} /> : <Cpu size={9} />}
                label=""
                value={selectedTranscript.modelName}
              />
              <MetricPill icon={<Mic size={9} />} label="Rec" value={
                selectedTranscript.durationSeconds < 60
                  ? `${selectedTranscript.durationSeconds.toFixed(1)}s`
                  : `${Math.floor(selectedTranscript.durationSeconds / 60)}:${Math.floor(selectedTranscript.durationSeconds % 60).toString().padStart(2, "0")}`
              } />
              {selectedTranscript.sttTimeMs != null && (
                <MetricPill icon={<Zap size={9} />} label="STT" value={`${(selectedTranscript.sttTimeMs / 1000).toFixed(1)}s`} />
              )}
              {selectedTranscript.correctionTimeMs != null && selectedTranscript.correctionTimeMs > 0 && (
                <MetricPill icon={<Wand2 size={9} />} label="LLM" value={`${(selectedTranscript.correctionTimeMs / 1000).toFixed(1)}s`} />
              )}
              <MetricPill icon={<Timer size={9} />} label="Total" value={`${(selectedTranscript.processingTimeMs / 1000).toFixed(1)}s`} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
