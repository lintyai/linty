import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";

interface ConfirmResetDialogueProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmResetDialogue({ open, onConfirm, onCancel }: ConfirmResetDialogueProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    cancelRef.current?.focus();
    return () => { dialog.close(); previous?.focus(); };
  }, [open]);
  return (
    <dialog ref={dialogRef} className="confirmation-dialog" aria-labelledby="reset-title" aria-describedby="reset-description" onCancel={(e) => { e.preventDefault(); onCancel(); }}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();
        buttons[(index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }}>
      <div className="dialog-icon"><AlertTriangle size={24} /></div>
      <h2 id="reset-title">Reset all Linty data?</h2>
      <p id="reset-description">This permanently deletes your transcription history, preferences, saved API keys, and downloaded speech models. This cannot be undone.</p>
      <p>Linty will return to first-time setup.</p>
      <div className="dialog-actions">
        <button ref={cancelRef} className="standard-button" onClick={onCancel}>Cancel</button>
        <button className="standard-button destructive-button" onClick={onConfirm}>Delete Everything</button>
      </div>
    </dialog>
  );
}
