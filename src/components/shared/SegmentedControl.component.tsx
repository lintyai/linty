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
}

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={cn(
        "inline-flex gap-px rounded-lg bg-bg-input p-[3px] border border-border-subtle",
        className,
      )}
    >
      {segments.map((segment) => {
        const isActive = segment.value === value;
        return (
          <button
            key={segment.value}
            onClick={() => onChange(segment.value)}
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
