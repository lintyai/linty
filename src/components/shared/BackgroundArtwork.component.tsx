import { SoundPattern } from "@/components/shared/BrandMark.component";
import { cn } from "@/lib/utils";

export type BackgroundMotif = "flow" | "contour";

/** Decorative voice contours: shared geometry, theme colors, no interactive surface. */
export function BackgroundArtwork({
  motif = "flow",
  className,
}: {
  motif?: BackgroundMotif;
  className?: string;
}) {
  return (
    <span
      className={cn("background-artwork", `background-artwork-${motif}`, className)}
      aria-hidden="true"
    >
      {motif === "contour" ? (
        <SoundPattern />
      ) : (
        <svg viewBox="0 0 420 180" preserveAspectRatio="none" fill="none" focusable="false">
          {Array.from({ length: 7 }, (_, i) => (
            <path
              key={i}
              d={`M -12 ${114 + i * 9} C 82 ${142 + i * 5}, 148 ${22 + i * 10}, 244 ${36 + i * 10} S 360 ${126 + i * 7}, 440 ${54 + i * 12}`}
              stroke="currentColor"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      )}
    </span>
  );
}
