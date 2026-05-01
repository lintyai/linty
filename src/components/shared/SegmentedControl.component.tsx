import { useRef, useEffect, useState } from "react";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [pillStyle, setPillStyle] = useState({ left: 0, width: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const activeIndex = segments.findIndex((s) => s.value === value);
    const buttons = container.querySelectorAll<HTMLButtonElement>("[data-segment]");
    const activeButton = buttons[activeIndex];
    if (activeButton) {
      setPillStyle({
        left: activeButton.offsetLeft,
        width: activeButton.offsetWidth,
      });
    }
  }, [value, segments]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative inline-flex rounded-[var(--radius-sm)] bg-bg-input p-[3px] ring-1 ring-border-subtle",
        className,
      )}
    >
      <div
        className="absolute top-[3px] h-[calc(100%-6px)] rounded-[5px] bg-bg-elevated shadow-[var(--shadow-sm)] ring-1 ring-border transition-all duration-250"
        style={{
          left: pillStyle.left,
          width: pillStyle.width,
          transitionTimingFunction: "cubic-bezier(0.22, 0.61, 0.36, 1)",
        }}
      />
      {segments.map((segment) => {
        const isActive = segment.value === value;
        return (
          <button
            key={segment.value}
            data-segment
            onClick={() => onChange(segment.value)}
            className={cn(
              "relative z-10 flex items-center justify-center gap-1.5 rounded-[5px] px-3 py-[5px] text-[12px] font-medium transition-colors duration-150",
              isActive
                ? "text-text-primary"
                : "text-text-secondary hover:text-text-primary",
            )}
          >
            {segment.icon && (
              <span className={cn(isActive ? "text-accent" : "text-text-muted", "transition-colors duration-150")}>
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
