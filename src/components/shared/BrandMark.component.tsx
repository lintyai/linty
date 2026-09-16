import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("brand-mark", className)} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

/** A complete, scalable voice motif shared by navigation and setup. */
export function SoundPattern({ className }: { className?: string }) {
  return (
    <svg
      className={cn("sound-pattern", className)}
      viewBox="0 0 240 360"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g transform="rotate(-25 120 180)">
        {Array.from({ length: 8 }, (_, i) => (
          <ellipse
            key={i}
            cx={120 + i * 0.8}
            cy={180 - i * 1.6}
            rx={28 + i * 7.6}
            ry={62 + i * 12.4}
            stroke="currentColor"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    </svg>
  );
}
