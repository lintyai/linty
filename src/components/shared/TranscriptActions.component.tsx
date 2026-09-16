import { useEffect, useId, useRef, useState } from "react";
import { Copy, Check, MoreHorizontal, Trash2 } from "lucide-react";
import { copyTranscript } from "@/lib/transcript-clipboard.util";
import { useToast } from "@/hooks/useToast.hook";
import type { TranscriptRecord } from "@/types/transcript.types";

interface TranscriptActionsProps {
  transcript: TranscriptRecord;
  onDelete: (transcriptId: string) => Promise<void>;
  stopPropagation?: boolean;
  menu?: boolean;
}

export function TranscriptCopyButton({
  transcript,
  labeled = false,
  stopPropagation,
}: {
  transcript: TranscriptRecord;
  labeled?: boolean;
  stopPropagation?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const resetCopy = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(resetCopy.current), []);
  return (
    <button
      type="button"
      onClick={async (event) => {
        if (stopPropagation) event.stopPropagation();
        if (await copyTranscript(transcript)) {
          clearTimeout(resetCopy.current);
          setCopied(true);
          resetCopy.current = setTimeout(() => setCopied(false), 1500);
        }
      }}
      className={
        labeled
          ? "standard-button transcript-copy-labeled"
          : "transcript-action"
      }
      aria-label="Copy transcript"
      title="Copy transcript"
    >
      {copied ? (
        <Check className="text-success" size={14} />
      ) : (
        <Copy size={14} />
      )}
      {labeled && <span>Copy</span>}
    </button>
  );
}

function TranscriptDeleteButton({
  transcript,
  onDelete,
  stopPropagation,
  labeled = false,
}: TranscriptActionsProps & { labeled?: boolean }) {
  const { error } = useToast();
  const [deleting, setDeleting] = useState(false);
  return (
    <button
      type="button"
      onClick={async (event) => {
        if (stopPropagation) event.stopPropagation();
        setDeleting(true);
        try {
          await onDelete(transcript.transcriptId);
        } catch {
          error("Could not delete transcription. Please try again.");
        } finally {
          setDeleting(false);
        }
      }}
      className={
        labeled ? "transcript-menu-delete" : "transcript-action is-destructive"
      }
      aria-label="Delete transcript"
      title="Delete transcript"
      disabled={deleting}
    >
      <Trash2 size={14} />
      {labeled && "Delete transcription"}
    </button>
  );
}

/** The native popover layer keeps row actions above scrolling panes without moving content. */
export function TranscriptMoreActions(props: TranscriptActionsProps) {
  const id = useId();
  const popover = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useEffect(() => {
    const dismiss = (event: Event) => {
      const menu = popover.current;
      if (menu?.matches(":popover-open") && !(event.target instanceof Node && menu.contains(event.target)))
        menu.hidePopover();
    };
    document.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, []);
  return (
    <>
      <button
        type="button"
        ref={trigger}
        popoverTarget={id}
        aria-label="More transcription actions"
        title="More transcription actions"
        className="transcript-action"
        onClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition({
            left: Math.max(
              8,
              Math.min(rect.right - 190, window.innerWidth - 198),
            ),
            top:
              rect.bottom + 58 <= window.innerHeight
                ? rect.bottom + 4
                : rect.top - 54,
          });
        }}
      >
        <MoreHorizontal size={15} />
      </button>
      <div
        id={id}
        ref={popover}
        popover="auto"
        role="group"
        aria-label="Transcription actions"
        className="transcript-menu"
        style={position}
        onToggle={(event) => {
          if (event.newState === "open")
            popover.current?.querySelector("button")?.focus({ preventScroll: true });
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            popover.current?.hidePopover();
            trigger.current?.focus({ preventScroll: true });
          }
        }}
      >
        <TranscriptDeleteButton {...props} labeled />
      </div>
    </>
  );
}

export function TranscriptActions({ menu, ...props }: TranscriptActionsProps) {
  return (
    <>
      <TranscriptCopyButton
        transcript={props.transcript}
        stopPropagation={props.stopPropagation}
      />
      {menu ? (
        <TranscriptMoreActions {...props} />
      ) : (
        <TranscriptDeleteButton {...props} />
      )}
    </>
  );
}
