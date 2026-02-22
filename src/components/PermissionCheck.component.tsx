import { useState, useEffect } from "react";
import { ShieldAlert } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { checkAccessibility } from "@/services/paste.service";
import { cn } from "@/lib/utils";

export function PermissionCheck({ className }: { className?: string }) {
  const [hasPermission, setHasPermission] = useState(true);

  useEffect(() => {
    const check = async () => {
      const granted = await checkAccessibility().catch(() => false);
      setHasPermission(granted);
    };
    check();
    const interval = setInterval(check, 3000);
    return () => clearInterval(interval);
  }, []);

  if (hasPermission) return null;

  return (
    <button
      onClick={() =>
        open(
          "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        )
      }
      className={cn(
        "animate-slide-up flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors duration-150",
        "border border-[var(--color-warning-glow)] bg-[var(--color-warning-glow)]",
        "hover:bg-[rgba(212,148,10,0.15)]",
        className,
      )}
    >
      <ShieldAlert size={14} className="shrink-0 text-warning" />
      <span className="text-[11px] leading-snug text-warning">
        Accessibility permission required for auto-paste.{" "}
        <span className="underline underline-offset-2">Open Settings</span>
      </span>
    </button>
  );
}
