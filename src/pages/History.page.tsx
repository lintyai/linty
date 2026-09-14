import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/app.store";
import { formatTriggerLabel } from "@/lib/trigger.util";
import {
  Search,
  X,
  ChevronLeft,
  Mic,
  Zap,
  Wand2,
  Timer,
  Cloud,
  Cpu,
  Pencil,
  Check,
} from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useHistory } from "@/hooks/useHistory.hook";
import { useToast } from "@/hooks/useToast.hook";
import { AppIcon } from "@/components/shared/AppIcon.component";
import { CorrectionPanel } from "@/components/shared/CorrectionPanel.component";
import { useDictionary } from "@/hooks/useDictionary.hook";
import { addDictionaryEntry, ingestCorrection } from "@/services/dictionary.service";
import { updateTranscript } from "@/services/history.service";
import { recordCorrection } from "@/services/user-corrections.service";
import { diffCorrection } from "@/lib/correction-diff.util";
import type { CorrectionRecord } from "@/types/correction.types";
import { EmptyState } from "@/components/shared/EmptyState.component";
import { useAppIcon } from "@/hooks/useAppIcons.hook";
import { formatDayLabel } from "@/lib/usage.util";
import { TranscriptRow } from "@/components/shared/TranscriptRow.component";
import { TranscriptActions } from "@/components/shared/TranscriptActions.component";
import type { TranscriptRecord } from "@/types/transcript.types";

function groupByDate(
  transcripts: TranscriptRecord[],
): { date: string; items: TranscriptRecord[] }[] {
  const groups = new Map<string, TranscriptRecord[]>();
  for (const t of transcripts) {
    const dateKey = formatDayLabel(t.timestamp);
    if (!groups.has(dateKey)) groups.set(dateKey, []);
    groups.get(dateKey)!.push(t);
  }
  return Array.from(groups.entries()).map(([date, items]) => ({ date, items }));
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
  const { success, error } = useToast();
  const triggerKey = useAppStore((s) => s.triggerKey);
  const transcriptionLanguage = useAppStore((s) => s.transcriptionLanguage);
  const autoLearnWords = useAppStore((s) => s.autoLearnWords);
  const { corrections, entries } = useDictionary();
  const readingRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const groups = groupByDate(transcripts);
  const selectedTranscript = transcripts.find(
    (t) => t.transcriptId === selectedTranscriptId,
  );
  const visibleTranscriptId = selectedTranscript?.transcriptId;
  const selectedAppIcon = useAppIcon(selectedTranscript?.application?.bundleId);
  const selectedCorrections = selectedTranscript
    ? corrections.filter((c) => c.transcriptId === selectedTranscript.transcriptId)
    : [];

  // Leaving a transcript discards an unsaved draft.
  useEffect(() => {
    setEditing(false);
  }, [visibleTranscriptId]);

  const startEdit = () => {
    if (!selectedTranscript) return;
    setDraft(selectedTranscript.finalText);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!selectedTranscript) return;
    const edited = draft.trim();
    if (!edited || edited === selectedTranscript.finalText) {
      setEditing(false);
      return;
    }
    const diff = diffCorrection(selectedTranscript.finalText, edited);
    setSaving(true);
    // Only spacing changed: keep the edit, but there is no correction to learn from.
    if (!diff.pairs.length) {
      try {
        await updateTranscript(selectedTranscript.transcriptId, { finalText: edited });
        success("Saved.");
        setEditing(false);
      } catch {
        error("Could not save the edit. Please try again.");
      } finally {
        setSaving(false);
      }
      return;
    }
    const record: CorrectionRecord = {
      correctionId: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      transcriptId: selectedTranscript.transcriptId,
      timestamp: Date.now(),
      source: "edit",
      engine: selectedTranscript.engine,
      modelName: selectedTranscript.modelName,
      language: transcriptionLanguage,
      application: selectedTranscript.application ?? null,
      wordCount: diff.wordCount,
      changedRatio: diff.changedRatio,
      rewrite: diff.rewrite,
      pairs: diff.pairs,
    };
    try {
      // Word count stays as dictated: usage statistics count what was spoken, not the edit.
      await updateTranscript(selectedTranscript.transcriptId, { finalText: edited });
      await recordCorrection(record);
      const { suggested, learned } = await ingestCorrection(record, autoLearnWords);
      success(
        learned
          ? `Saved. ${learned} word${learned === 1 ? "" : "s"} added to your dictionary.`
          : suggested
            ? `Saved. ${suggested} suggestion${suggested === 1 ? "" : "s"} waiting on the Dictionary page.`
            : diff.rewrite
              ? "Saved as a rewrite; rewrites are not used for learning."
              : "Correction saved.",
      );
      setEditing(false);
    } catch {
      error("Could not save the edit. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const addPairToDictionary = (right: string, wrong: string) => {
    addDictionaryEntry(right, [wrong], "learned")
      .then(() => success(`“${right}” added to your dictionary`))
      .catch(() => error("Could not update the dictionary. Please try again."));
  };

  useEffect(() => {
    if (!visibleTranscriptId) return;
    const narrowWindow = window.matchMedia("(max-width: 800px)");
    const focusDetail = () => {
      const active = document.activeElement;
      if (narrowWindow.matches && (active === document.body || active?.closest(".history-list"))) {
        readingRef.current?.focus();
      }
    };
    focusDetail();
    narrowWindow.addEventListener("change", focusDetail);
    return () => narrowWindow.removeEventListener("change", focusDetail);
  }, [visibleTranscriptId]);

  const handleDeleteWithDeselect = async (transcriptId: string) => {
    await deleteTranscript(transcriptId);
    if (useAppStore.getState().selectedTranscriptId === transcriptId) {
      setSelectedTranscriptId(null);
    }
  };

  const handleCopyContent = useCallback(async () => {
    if (!selectedTranscript) return;
    try {
      await writeText(selectedTranscript.finalText);
      success("Copied to clipboard");
    } catch { error("Could not copy transcription. Please try again."); }
  }, [selectedTranscript, success, error]);

  useEffect(() => {
    const copy = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.defaultPrevented || document.querySelector("dialog[open]") || target.closest("input, textarea, [contenteditable=true]") || window.getSelection()?.toString()) return;
      if (e.metaKey && e.key.toLowerCase() === "c" && selectedTranscript) { e.preventDefault(); void handleCopyContent(); }
    };
    const nativeCopy = (e: ClipboardEvent) => {
      if (!selectedTranscript || document.querySelector("dialog[open]") || (e.target as HTMLElement).closest("input, textarea, [contenteditable=true]") || window.getSelection()?.toString()) return;
      e.preventDefault();
      if (e.clipboardData) e.clipboardData.setData("text/plain", selectedTranscript.finalText);
      else void handleCopyContent();
    };
    window.addEventListener("keydown", copy);
    document.addEventListener("copy", nativeCopy);
    return () => { window.removeEventListener("keydown", copy); document.removeEventListener("copy", nativeCopy); };
  }, [handleCopyContent, selectedTranscript]);

  return (
    <div className="flex h-full flex-col">
      {/* Content */}
      <div className={`history-layout ${selectedTranscript ? "has-detail" : ""}`}>
        <div className="history-list" aria-label="Transcription history" onKeyDown={(e) => {
          const row = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-transcript-id]");
          if (!row || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
          e.preventDefault();
          const rows = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-transcript-id]"));
          const index = rows.indexOf(row);
          const next = e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : Math.min(rows.length - 1, Math.max(0, index + (e.key === "ArrowDown" ? 1 : -1)));
          rows[next]?.focus();
          if (rows[next]) setSelectedTranscriptId(rows[next].dataset.transcriptId!);
        }}>
        <div className="history-list-heading"><span>{searchQuery ? `${transcripts.length} results` : "All transcriptions"}</span><span>{allTranscripts.length} saved</span></div>
          {allTranscripts.length === 0 ? (
            <EmptyState
              icon={<Mic size={22} />}
              title="No transcriptions yet"
              description={`In any app, hold ${formatTriggerLabel(triggerKey)}, speak, then release. Your transcriptions will be saved here.`}
            />
          ) : transcripts.length === 0 ? (
            <EmptyState
              icon={<Search size={22} />}
              title="No results"
              description="Try another word or application name."
              action={<button className="standard-button" onClick={() => setSearchQuery("")}>Clear search</button>}
            />
          ) : (
            groups.map((group) => (
              <div key={group.date}>
                <div className="history-date">
                  <span className="text-[12px] font-medium text-text-secondary">
                    {group.date}
                  </span>
                </div>
                {group.items.map((t) => (
                  <TranscriptRow
                    key={t.transcriptId}
                    transcript={t}
                    onDelete={handleDeleteWithDeselect}
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
          <div className="history-detail animate-fade-in">
            {/* Close button */}
            <div className="detail-toolbar">
              <span>Transcription</span>
              {!editing && (
                <button
                  type="button"
                  aria-label="Edit transcription"
                  title="Edit transcription"
                  className="detail-edit icon-button"
                  onClick={startEdit}
                >
                  <Pencil size={13} />
                </button>
              )}
              <TranscriptActions transcript={selectedTranscript} onDelete={handleDeleteWithDeselect} />
              <button aria-label="Back to history" title="Back to history (Esc)"
                onClick={() => {
                  const id = selectedTranscript.transcriptId;
                  setSelectedTranscriptId(null);
                  requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-transcript-id="${CSS.escape(id)}"]`)?.focus());
                }}
                className="detail-close flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-secondary transition-all"
              >
                <ChevronLeft size={14} className="detail-back-icon" /><X size={13} className="detail-x-icon" /><span className="detail-close-label">History</span>
              </button>
            </div>

            {/* Selectable reading area; copy actions stay in the toolbar. */}
            <div
              ref={readingRef}
              tabIndex={0}
              role="region"
              aria-label="Transcription text"
              className="transcript-reading flex-1 overflow-y-auto p-6 space-y-6"
            >
              <div>
                <p className="text-[12px] text-text-secondary mb-4">
                  {new Date(selectedTranscript.timestamp).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                  {selectedTranscript.application && (
                    <>
                      {" · "}
                      <span className="transcript-app">
                        <AppIcon size="sm" name={selectedTranscript.application.name} icon={selectedAppIcon} />
                        {selectedTranscript.application.name}
                      </span>
                    </>
                  )}
                </p>
                {editing ? (
                  <div className="transcript-editor">
                    <textarea
                      id="transcript-editor"
                      aria-label="Edit transcription text"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={Math.min(14, Math.max(4, draft.split("\n").length + 2))}
                      autoFocus
                      spellCheck
                    />
                    <div className="transcript-editor-actions">
                      <span className="text-[11px] text-text-muted">Fix what the engine got wrong. Linty learns from single-word fixes.</span>
                      <button type="button" className="standard-button" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
                      <button type="button" className="standard-button primary-button" onClick={() => void saveEdit()} disabled={saving}>
                        <Check size={12} /> Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-[14px] leading-[1.75] text-text-primary select-text whitespace-pre-wrap">
                    {selectedTranscript.finalText}
                  </p>
                )}
              </div>
              <CorrectionPanel
                corrections={selectedCorrections}
                entries={entries}
                onAddToDictionary={addPairToDictionary}
              />
              {selectedTranscript.dictionaryApplied?.length ? (
                <p className="dictionary-applied-note">
                  Dictionary applied before paste:{" "}
                  {selectedTranscript.dictionaryApplied.map((a) => `${a.from} → ${a.to}`).join(", ")}
                </p>
              ) : null}
              {selectedTranscript.corrected && selectedTranscript.rawText !== selectedTranscript.finalText && (
                <details className="original-transcript">
                  <summary>Original dictation</summary>
                  <p className="text-[13px] leading-[1.75] text-text-secondary select-text whitespace-pre-wrap mt-3">{selectedTranscript.rawText}</p>
                </details>
              )}
            </div>

            {/* Metrics footer */}
            <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle px-4 py-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary">
                {selectedTranscript.engine === "cloud" ? (
                  <Cloud size={10} className="text-text-muted" />
                ) : (
                  <Cpu size={10} className="text-text-muted" />
                )}
                {selectedTranscript.modelName}
              </div>
              <span className="text-border-subtle text-[11px]">/</span>
              <div className="flex items-center gap-1.5">
                <Mic size={11} className="text-text-muted" />
                <span className="text-[11px] text-text-muted">Rec</span>
                <span className="text-[11px] font-medium tabular-nums text-text-secondary">
                  {selectedTranscript.durationSeconds < 60
                    ? `${selectedTranscript.durationSeconds.toFixed(1)}s`
                    : `${Math.floor(selectedTranscript.durationSeconds / 60)}:${Math.floor(selectedTranscript.durationSeconds % 60).toString().padStart(2, "0")}`}
                </span>
              </div>
              {selectedTranscript.sttTimeMs != null && (
                <>
                  <span className="text-border-subtle text-[11px]">/</span>
                  <div className="flex items-center gap-1.5">
                    <Zap size={11} className="text-text-muted" />
                    <span className="text-[11px] text-text-muted">STT</span>
                    <span className="text-[11px] font-medium tabular-nums text-text-secondary">
                      {(selectedTranscript.sttTimeMs / 1000).toFixed(1)}s
                    </span>
                  </div>
                </>
              )}
              {selectedTranscript.correctionTimeMs != null && selectedTranscript.correctionTimeMs > 0 && (
                <>
                  <span className="text-border-subtle text-[11px]">/</span>
                  <div className="flex items-center gap-1.5">
                    <Wand2 size={11} className="text-text-muted" />
                    <span className="text-[11px] text-text-muted">LLM</span>
                    <span className="text-[11px] font-medium tabular-nums text-text-secondary">
                      {(selectedTranscript.correctionTimeMs / 1000).toFixed(1)}s
                    </span>
                  </div>
                </>
              )}
              <span className="text-border-subtle text-[11px]">/</span>
              <div className="flex items-center gap-1.5">
                <Timer size={11} className="text-text-muted" />
                <span className="text-[11px] text-text-muted">Total</span>
                <span className="text-[11px] font-medium tabular-nums text-text-secondary">
                  {(selectedTranscript.processingTimeMs / 1000).toFixed(1)}s
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
