import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

const BAR_COUNT = 20;

interface WaveformVisualizerProps {
  amplitude: number;
  isActive: boolean;
  className?: string;
}

export function WaveformVisualizer({
  amplitude,
  isActive,
  className,
}: WaveformVisualizerProps) {
  const barsRef = useRef<number[]>(Array(BAR_COUNT).fill(0));
  const frameRef = useRef<number>(0);

  useEffect(() => {
    if (!isActive) {
      barsRef.current = Array(BAR_COUNT).fill(0);
      return;
    }

    const animate = () => {
      const bars = barsRef.current;
      for (let i = 0; i < BAR_COUNT; i++) {
        const phase = (i / BAR_COUNT) * Math.PI * 2;
        const noise = Math.sin(Date.now() * 0.003 + phase) * 0.3;
        const center = Math.abs(i - BAR_COUNT / 2) / (BAR_COUNT / 2);
        const centerBoost = 1 - center * 0.6;
        const target = Math.max(
          0.08,
          amplitude * centerBoost * (0.7 + noise * 0.3) * 3,
        );
        bars[i] =
          target > bars[i]
            ? bars[i] + (target - bars[i]) * 0.4
            : bars[i] + (target - bars[i]) * 0.12;
      }
      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [amplitude, isActive]);

  return (
    <div
      className={cn("flex items-center justify-center gap-[2.5px]", className)}
    >
      {Array.from({ length: BAR_COUNT }).map((_, i) => {
        const height = isActive
          ? Math.max(8, Math.min(100, (barsRef.current[i] || 0) * 100))
          : 8;

        return (
          <div
            key={i}
            className="w-[2.5px] rounded-full transition-all"
            style={{
              height: `${height}%`,
              background: isActive
                ? "var(--color-accent)"
                : "var(--color-border)",
              opacity: isActive ? 0.5 + (height / 100) * 0.5 : 0.2,
              transitionDuration: isActive ? "60ms" : "300ms",
              transitionTimingFunction: "ease-out",
            }}
          />
        );
      })}
    </div>
  );
}
