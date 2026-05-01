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

const TOAST_STRIPE: Record<ToastType, string> = {
  success: "bg-success",
  error: "bg-error",
  warning: "bg-warning",
  info: "bg-info",
};

export function ToastContainer() {
  const { toasts, removeToast } = useAppStore();

  if (!toasts.length) return null;

  return (
    <div className="fixed right-3 bottom-10 z-50 flex flex-col-reverse gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.toastId}
          className={cn(
            "animate-toast-in pointer-events-auto flex items-center gap-2.5 overflow-hidden",
            "rounded-[var(--radius-md)] bg-bg-elevated/90 shadow-[var(--shadow-lg)] ring-1 ring-border-subtle",
            "max-w-[300px]",
          )}
          style={{
            backdropFilter: "blur(16px) saturate(1.6)",
            WebkitBackdropFilter: "blur(16px) saturate(1.6)",
          }}
        >
          <div className={cn("w-[3px] self-stretch shrink-0", TOAST_STRIPE[toast.type])} />
          <div className="flex items-center gap-2.5 py-2.5 pr-3">
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
        </div>
      ))}
    </div>
  );
}
