import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, X } from "lucide-react";
import { copyTranscript } from "@/lib/transcript-clipboard.util";
import { AppIcon } from "@/components/shared/AppIcon.component";
import { useAppIcon } from "@/hooks/useAppIcons.hook";
import { useAppStore } from "@/store/app.store";
import { useToast } from "@/hooks/useToast.hook";
import { useDictionary } from "@/hooks/useDictionary.hook";
import {
  addDictionaryEntry,
  ingestCorrection,
} from "@/services/dictionary.service";
import { getCorrections, updateTranscript } from "@/services/history.service";
import { recordCorrection } from "@/services/user-corrections.service";
import { diffCorrection } from "@/lib/correction-diff.util";
import { formatDayLabel } from "@/lib/usage.util";
import { CorrectionPanel } from "@/components/shared/CorrectionPanel.component";
import {
  TranscriptCopyButton,
  TranscriptMoreActions,
} from "@/components/shared/TranscriptActions.component";
import type { CorrectionRecord } from "@/types/correction.types";
import type { TranscriptRecord } from "@/types/transcript.types";
import { ReformatDetails } from "./ReformatDetails.component";

export function TranscriptDetail({
  transcript: selectedTranscript,
  onDelete,
  onClose,
}: {
  transcript: TranscriptRecord;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const { success, error } = useToast();
  const transcriptionLanguage = useAppStore((s) => s.transcriptionLanguage);
  const autoLearnWords = useAppStore((s) => s.autoLearnWords);
  const { entries } = useDictionary();
  const revision = useAppStore((s) => s.historySnapshot.revision);
  const [correctionsError, setCorrectionsError] = useState(false);
  const [correctionsLoaded, setCorrectionsLoaded] = useState(false);
  const [correctionsRetry, setCorrectionsRetry] = useState(0);
  const [selectedCorrections, setSelectedCorrections] = useState<
    CorrectionRecord[]
  >([]);
  const readingRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const reformatted = selectedTranscript.reformatting?.enabled && selectedTranscript.reformatting.status === "applied";
  const hasCorrections = reformatted || selectedTranscript.cloudRefinementStatus === "applied"
    || Boolean(selectedTranscript.dictionaryApplied?.length) || selectedCorrections.length > 0;

  const selectedAppIcon = useAppIcon(selectedTranscript.application?.bundleId);
  const visibleTranscriptId = selectedTranscript.transcriptId;
  useEffect(() => {
    let stale = false;
    setCorrectionsError(false);
    setCorrectionsLoaded(false);
    if (visibleTranscriptId)
      void getCorrections(visibleTranscriptId)
        .then((records) => {
          if (!stale) {
            setSelectedCorrections(records.filter((record) => record.pairs.length > 0));
            setCorrectionsLoaded(true);
          }
        })
        .catch(() => {
          if (!stale) {
            setCorrectionsError(true);
            setCorrectionsLoaded(true);
          }
        });
    return () => {
      stale = true;
    };
  }, [visibleTranscriptId, revision, correctionsRetry]);

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
        await updateTranscript(selectedTranscript.transcriptId, {
          finalText: edited,
        });
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
      language: selectedTranscript.transcriptionLanguage ?? transcriptionLanguage,
      application: selectedTranscript.application ?? null,
      wordCount: diff.wordCount,
      changedRatio: diff.changedRatio,
      rewrite: diff.rewrite,
      pairs: diff.pairs,
    };
    try {
      // Word count stays as dictated: usage statistics count what was spoken, not the edit.
      await updateTranscript(selectedTranscript.transcriptId, {
        finalText: edited,
      });
      await recordCorrection(record);
      const { suggested, learned } = await ingestCorrection(
        record,
        autoLearnWords,
      );
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
      if (
        narrowWindow.matches &&
        (active === document.body || active?.closest(".history-list"))
      ) {
        readingRef.current?.focus({ preventScroll: true });
      }
    };
    focusDetail();
    narrowWindow.addEventListener("change", focusDetail);
    return () => narrowWindow.removeEventListener("change", focusDetail);
  }, [visibleTranscriptId]);

  const handleCopyContent = useCallback(async () => {
    await copyTranscript(selectedTranscript);
  }, [selectedTranscript]);

  useEffect(() => {
    const copy = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        e.defaultPrevented ||
        document.querySelector("dialog[open]") ||
        target.closest("input, textarea, [contenteditable=true]") ||
        window.getSelection()?.toString()
      )
        return;
      if (e.metaKey && e.key.toLowerCase() === "c" && selectedTranscript) {
        e.preventDefault();
        void handleCopyContent();
      }
    };
    const nativeCopy = (e: ClipboardEvent) => {
      if (
        !selectedTranscript ||
        document.querySelector("dialog[open]") ||
        (e.target as HTMLElement).closest(
          "input, textarea, [contenteditable=true]",
        ) ||
        window.getSelection()?.toString()
      )
        return;
      e.preventDefault();
      if (e.clipboardData)
        e.clipboardData.setData("text/plain", selectedTranscript.finalText);
      else void handleCopyContent();
    };
    window.addEventListener("keydown", copy);
    document.addEventListener("copy", nativeCopy);
    return () => {
      window.removeEventListener("keydown", copy);
      document.removeEventListener("copy", nativeCopy);
    };
  }, [handleCopyContent, selectedTranscript]);

  return (
    <section className="history-detail" aria-label="Selected transcription">
      <div className="detail-toolbar">
        <p className="reading-context">
          <AppIcon
            size="sm"
            name={
              selectedTranscript.application?.name ?? "Application not recorded"
            }
            icon={selectedAppIcon}
            showNameOnHover
          />
          <span aria-hidden="true"> · </span>
          <time dateTime={new Date(selectedTranscript.timestamp).toISOString()}>
            {formatDayLabel(selectedTranscript.timestamp)},{" "}
            {new Date(selectedTranscript.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        </p>
        <TranscriptMoreActions
          transcript={selectedTranscript}
          onDelete={onDelete}
        />
        <button
          type="button"
          aria-label="Back to history"
          data-tooltip="Back to history (Esc)"
          onClick={onClose}
          className="detail-close icon-button"
        >
          <ChevronLeft size={14} className="detail-back-icon" />
          <X size={14} className="detail-x-icon" />
          <span className="detail-close-label">History</span>
        </button>
      </div>
      <div className="reading-actions">
        <TranscriptCopyButton transcript={selectedTranscript} labeled />
        <button
          type="button"
          className="standard-button"
          aria-label="Edit transcription"
          disabled={editing}
          onClick={startEdit}
        >
          Edit text
        </button>
      </div>
      <div
        ref={readingRef}
        tabIndex={0}
        role="region"
        aria-label="Transcription text"
        className="transcript-reading"
      >
        {editing ? (
          <div className="transcript-editor">
            <textarea
              id="transcript-editor"
              aria-label="Edit transcription text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(14, Math.max(4, selectedTranscript.finalText.split("\n").length + 2))}
              autoFocus
              spellCheck
            />
            <div className="transcript-editor-actions">
              <span className="text-[11px] text-text-muted">
                Fix what the engine got wrong. Linty learns from single-word
                fixes.
              </span>
              <button
                type="button"
                className="standard-button"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="standard-button primary-button"
                onClick={() => void saveEdit()}
                disabled={saving}
              >
                <Check size={12} /> Save
              </button>
            </div>
          </div>
        ) : (
          <p className="reading-text">{selectedTranscript.finalText}</p>
        )}
        {hasCorrections && <section
          className="reading-corrections"
          aria-labelledby="history-corrections-title"
          aria-busy={!correctionsLoaded}
        >
          <h2 id="history-corrections-title">Corrections</h2>
          {reformatted && (
            <p className="reading-note">
              <strong>S1-mini:</strong> Automatically reformatted this transcription.
            </p>
          )}
          {selectedTranscript.cloudRefinementStatus === "applied" && (
            <p className="reading-note">
              <strong>Cloud refinement:</strong> Automatically refined this transcription.
            </p>
          )}
          {selectedTranscript.dictionaryApplied?.length ? (
            <p className="dictionary-applied-note">
              Dictionary applied before paste:{" "}
              {selectedTranscript.dictionaryApplied
                .map((a) => `${a.from} → ${a.to}`)
                .join(", ")}
            </p>
          ) : null}
          {selectedCorrections.length > 0 && (
            <>
              <p className="reading-note"><strong>Your edits</strong></p>
              <CorrectionPanel
                corrections={selectedCorrections}
                entries={entries}
                onAddToDictionary={addPairToDictionary}
              />
            </>
          )}
        </section>}
        {correctionsError && (
          <p className="reading-note" role="alert">
            Could not load your edits.{" "}
            <button type="button" className="text-link" onClick={() => setCorrectionsRetry((n) => n + 1)}>
              Retry
            </button>
          </p>
        )}
        <details className="original-transcript">
          <summary>
            Original transcription <ChevronDown size={14} />
          </summary>
          <p>{selectedTranscript.rawText}</p>
        </details>
        <ReformatDetails transcript={selectedTranscript} />
      </div>
    </section>
  );
}
