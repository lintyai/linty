import { useState } from "react";
import { Copy, Check, Trash2 } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useToast } from "@/hooks/useToast.hook";
import type { TranscriptRecord } from "@/types/transcript.types";

interface TranscriptActionsProps {
  transcript: TranscriptRecord;
  onDelete: (transcriptId: string) => Promise<void>;
  stopPropagation?: boolean;
}

export function TranscriptActions({
  transcript,
  onDelete,
  stopPropagation,
}: TranscriptActionsProps) {
  const { success, error } = useToast();
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
    try {
      await writeText(transcript.finalText);
      setCopied(true);
      success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch { error("Could not copy transcription. Please try again."); }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
    setDeleting(true);
    try {
      await onDelete(transcript.transcriptId);
    } catch {
      error("Could not delete transcription. Please try again.");
    } finally { setDeleting(false); }
  };

  return (
    <>
      <button
        onClick={handleCopy}
        className="flex h-[26px] w-[26px] items-center justify-center rounded-md hover:bg-bg-active transition-colors"
        aria-label="Copy transcript"
        title="Copy transcript"
      >
        {copied ? (
          <Check size={13} className="text-success" />
        ) : (
          <Copy size={13} className="text-text-muted" />
        )}
      </button>
      <button
        onClick={handleDelete}
        className="flex h-[26px] w-[26px] items-center justify-center rounded-md hover:bg-error-glow transition-colors"
        aria-label="Delete transcript"
        disabled={deleting}
        title="Delete transcript"
      >
        <Trash2
          size={13}
          className="text-text-muted hover:text-error"
        />
      </button>
    </>
  );
}
