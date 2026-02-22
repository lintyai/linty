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
  const { success } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
    await writeText(transcript.finalText);
    setCopied(true);
    success("Copied to clipboard");
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
    await onDelete(transcript.transcriptId);
    success("Transcript deleted");
  };

  return (
    <>
      <button
        onClick={handleCopy}
        className="flex h-[26px] w-[26px] items-center justify-center rounded-md hover:bg-bg-active transition-colors"
        title="Copy"
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
        title="Delete"
      >
        <Trash2
          size={13}
          className="text-text-muted hover:text-error"
        />
      </button>
    </>
  );
}
