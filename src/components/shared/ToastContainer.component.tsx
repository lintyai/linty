import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { useAppStore } from "@/store/app.store";
import { cn } from "@/lib/utils";
import type { ToastType } from "@/store/slices/toast.slice";

const TOAST_ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 size={13} className="text-success" />,
  error: <AlertCircle size={13} className="text-error" />,
  warning: <AlertTriangle size={13} className="text-warning" />,
  info: <Info size={13} className="text-info" />,
};

const TOAST_BORDER: Record<ToastType, string> = {
  success: "border-success/15",
  error: "border-error/15",
  warning: "border-warning/15",
  info: "border-info/15",
};

export function ToastContainer() {
  const { toasts, removeToast } = useAppStore();

  if (!toasts.length) return null;

  return (
    <div className="fixed right-3 top-14 z-50 flex flex-col gap-1.5 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.toastId}
          className={cn(
            "animate-toast-in pointer-events-auto flex items-center gap-2 rounded-lg border px-3 py-2",
            "bg-bg-elevated/95 backdrop-blur-xl shadow-lg",
            "max-w-[280px]",
            TOAST_BORDER[toast.type],
          )}
        >
          {TOAST_ICONS[toast.type]}
          <span className="flex-1 text-[11px] text-text-primary leading-snug">
            {toast.message}
          </span>
          {toast.action && (
            <button
              onClick={toast.action.onClick}
              className="shrink-0 text-[10px] font-medium text-accent hover:text-accent-soft transition-colors"
            >
              {toast.action.label}
            </button>
          )}
          <button
            onClick={() => removeToast(toast.toastId)}
            className="shrink-0 text-text-muted hover:text-text-secondary transition-colors"
          >
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}
