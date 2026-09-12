import { isTauri } from "@tauri-apps/api/core";
import { showTranscriptMenu } from "@/lib/transcript-menu.util";
import { Cloud, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TranscriptRecord } from "@/types/transcript.types";

interface TranscriptRowProps {
  transcript: TranscriptRecord;
  selected?: boolean;
  onClick?: () => void;
  onDelete?: (id: string) => Promise<void>;
  actions?: React.ReactNode;
  className?: string;
}

export function TranscriptRow({ transcript: t, selected, onClick, onDelete, actions, className }: TranscriptRowProps) {
  const content = <>
    <p className="transcript-preview">{t.finalText}</p>
    <span className="transcript-metadata">
      <time dateTime={new Date(t.timestamp).toISOString()}>{new Date(t.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
      {t.application && <><span aria-hidden="true">·</span><span>{t.application.name}</span></>}
      <span aria-hidden="true">·</span><span>{t.wordCount} words</span>
      <span className="transcript-engine" title={t.modelName}>{t.engine === "cloud" ? <Cloud size={11} /> : <Cpu size={11} />}{t.engine === "cloud" ? "Cloud" : "Local"}</span>
    </span>
  </>;
  return (
    <div className={cn("transcript-row group", selected && "is-selected", className)}
      onContextMenu={(e) => {
        if (!isTauri() || !onDelete) return;
        e.preventDefault(); onClick?.(); void showTranscriptMenu(t, onDelete);
      }}
      onKeyDown={(e) => {
        if (isTauri() && onDelete && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) {
          e.preventDefault(); onClick?.(); void showTranscriptMenu(t, onDelete);
        }
      }}>
      {onClick ? <button type="button" data-transcript-id={t.transcriptId} aria-pressed={!!selected} onClick={(e) => { e.currentTarget.focus(); onClick(); }} className="transcript-select">{content}</button> : <div className="transcript-select select-text">{content}</div>}
      {actions && <div className="transcript-actions">{actions}</div>}
    </div>
  );
}
