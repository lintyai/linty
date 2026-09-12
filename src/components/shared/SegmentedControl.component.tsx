import { cn } from "@/lib/utils";

interface Segment<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

interface SegmentedControlProps<T extends string> {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  label?: string;
}

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  className,
  label = "Options",
}: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={label}
      className={cn(
        "segmented-control",
        className,
      )}
    >
      {segments.map((segment) => {
        const isActive = segment.value === value;
        return (
          <button
            key={segment.value}
            type="button"
            aria-pressed={isActive}
            tabIndex={isActive ? 0 : -1}
            onKeyDown={(e) => {
              const index = segments.findIndex((item) => item.value === value);
              let next = index;
              if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % segments.length;
              else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + segments.length) % segments.length;
              else if (e.key === "Home") next = 0;
              else if (e.key === "End") next = segments.length - 1;
              else return;
              e.preventDefault();
              onChange(segments[next].value);
              (e.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus();
            }}
            onClick={(e) => { e.currentTarget.focus(); onChange(segment.value); }}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-[6px] px-3 py-[5px] text-[12px] font-medium transition-all duration-200",
              isActive
                ? "bg-bg-elevated border border-border text-text-primary shadow-sm"
                : "border border-transparent text-text-secondary hover:text-text-primary",
            )}
          >
            {segment.icon && (
              <span className={cn(isActive ? "text-accent" : "text-text-muted")}>
                {segment.icon}
              </span>
            )}
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}
