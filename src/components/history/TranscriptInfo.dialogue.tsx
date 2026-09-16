import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { formatDuration } from "@/lib/usage.util";
import type { TranscriptRecord } from "@/types/transcript.types";
import { formatProcessingTime, ProcessingBreakdown } from "./ProcessingBreakdown.component";

export function TranscriptInfoDialogue({ transcript, onClose }: {
  transcript: TranscriptRecord;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    close.current?.focus({ preventScroll: true });
    return () => element.close();
  }, []);

  return createPortal(
    <dialog
      ref={dialog}
      className="confirmation-dialog transcript-info-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-context`}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Tab") {
          event.preventDefault();
          close.current?.focus();
        }
      }}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
    >
      <header className="transcript-info-heading">
        <h2 id={`${id}-title`}>Dictation details</h2>
        <button ref={close} type="button" className="icon-button" aria-label="Close dictation details" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <div className="transcript-info-content">
      <p id={`${id}-context`} className="transcript-info-context">
        {transcript.application?.name && <>{transcript.application.name} · </>}
        <time dateTime={new Date(transcript.timestamp).toISOString()}>
          {new Date(transcript.timestamp).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
        </time>
      </p>
      <dl className="transcript-info-facts">
        <div><dt>Speech engine</dt><dd>{transcript.engine === "cloud" ? "Cloud" : "On-device"}</dd></div>
        <div><dt>Model</dt><dd>{transcript.modelName}</dd></div>
        <div><dt>Audio length</dt><dd>{formatDuration(transcript.durationSeconds)}</dd></div>
        <div><dt>Words</dt><dd>{transcript.wordCount.toLocaleString()}</dd></div>
        <div><dt>Total processing</dt><dd>{formatProcessingTime(transcript.processingTimeMs)}</dd></div>
      </dl>
      <ProcessingBreakdown transcript={transcript} />
      </div>
    </dialog>,
    document.body,
  );
}
