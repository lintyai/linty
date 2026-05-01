import { cn } from "@/lib/utils";

interface ToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function Toggle({
  enabled,
  onChange,
  label,
  description,
  disabled,
}: ToggleProps) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!enabled)}
      disabled={disabled}
      className={cn(
        "flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left transition-colors duration-150",
        "hover:bg-bg-hover",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[13px] text-text-primary truncate">
          {label}
        </span>
        {description && (
          <span className="text-[12px] text-text-muted leading-snug">
            {description}
          </span>
        )}
      </div>
      <div
        className={cn(
          "relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200",
          enabled ? "bg-success" : "bg-bg-active",
        )}
      >
        <div
          className={cn(
            "absolute top-[3px] h-[16px] w-[16px] rounded-full bg-white transition-all duration-200",
            enabled ? "left-[19px] scale-100" : "left-[3px] scale-100",
            "shadow-[0_1px_3px_rgba(0,0,0,0.2),0_1px_1px_rgba(0,0,0,0.1)]",
          )}
          style={{
            transitionTimingFunction: "cubic-bezier(0.22, 0.61, 0.36, 1)",
          }}
        />
      </div>
    </button>
  );
}
