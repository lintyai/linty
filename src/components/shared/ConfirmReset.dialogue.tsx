import { useEffect, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConfirmResetDialogueProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmResetDialogue({
  open,
  onConfirm,
  onCancel,
}: ConfirmResetDialogueProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus cancel button when dialog opens and handle Escape
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div className="relative w-[400px] rounded-xl border border-border-subtle bg-bg-elevated shadow-2xl animate-scale-in">
        {/* Close button */}
        <button
          onClick={onCancel}
          className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-secondary transition-all"
        >
          <X size={14} />
        </button>

        <div className="p-5">
          {/* Icon + Title */}
          <div className="flex items-start gap-3 mb-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-error/10 border border-error/20">
              <AlertTriangle size={18} className="text-error" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-text-primary">
                Reset All Data
              </h3>
              <p className="text-[12px] text-text-muted mt-0.5">
                This action cannot be undone
              </p>
            </div>
          </div>

          {/* Description */}
          <div className="rounded-lg bg-bg-elevated/50 border border-border-subtle px-3.5 py-3 mb-5">
            <p className="text-[12px] text-text-secondary leading-relaxed mb-2.5">
              This will permanently delete:
            </p>
            <ul className="space-y-1.5">
              {[
                "All transcription history",
                "All settings and preferences",
                "All downloaded speech engine models",
                "Saved API keys",
              ].map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-2 text-[12px] text-text-secondary"
                >
                  <span className="h-1 w-1 rounded-full bg-error/60 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
            <p className="text-[12px] text-text-muted mt-2.5">
              The app will restart fresh as if newly installed.
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2">
            <button
              ref={cancelRef}
              onClick={onCancel}
              className={cn(
                "flex h-[34px] items-center rounded-lg px-4 text-[13px] font-medium",
                "bg-bg-elevated border border-border text-text-secondary",
                "hover:bg-bg-hover hover:text-text-primary transition-all duration-150",
                "active:scale-[0.97]",
              )}
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className={cn(
                "flex h-[34px] items-center rounded-lg px-4 text-[13px] font-medium",
                "bg-error text-white border border-error",
                "hover:bg-error/90 transition-all duration-150",
                "active:scale-[0.97]",
              )}
            >
              Delete Everything
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
