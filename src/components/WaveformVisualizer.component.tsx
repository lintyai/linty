import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

const BAR_COUNT = 20;

interface WaveformVisualizerProps {
  amplitude: number;
  isActive: boolean;
  className?: string;
}

export function WaveformVisualizer({ amplitude, isActive, className }: WaveformVisualizerProps) {
  const elements = useRef<(HTMLDivElement | null)[]>([]);
  const amplitudeRef = useRef(amplitude);
  amplitudeRef.current = amplitude;

  useEffect(() => {
    if (!isActive) {
      elements.current.forEach((bar) => {
        if (bar) { bar.style.transform = "scaleY(0.08)"; bar.style.opacity = "0.2"; }
      });
      return;
    }
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const levels = Array<number>(BAR_COUNT).fill(0.08);
    let frame = 0;
    let previousTime = 0;
    const draw = (time: number) => {
      const elapsed = previousTime ? Math.min(time - previousTime, 64) : 16;
      previousTime = time;
      elements.current.forEach((bar, i) => {
        if (!bar) return;
        const phase = (i / BAR_COUNT) * Math.PI * 2;
        const noise = motion.matches ? 0 : Math.sin(time * 0.003 + phase) * 0.3;
        const centerBoost = 1 - Math.abs(i - BAR_COUNT / 2) / (BAR_COUNT / 2) * 0.6;
        const target = Math.max(0.08, Math.min(1, amplitudeRef.current * centerBoost * (0.7 + noise * 0.3) * 3));
        const smoothing = 1 - Math.exp(-elapsed / (target > levels[i] ? 35 : 120));
        levels[i] = motion.matches ? target : levels[i] + (target - levels[i]) * smoothing;
        // Paint at display cadence without React rerenders or changing bar layout.
        bar.style.transform = `scaleY(${levels[i]})`;
        bar.style.opacity = String(0.5 + levels[i] * 0.5);
      });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [isActive]);

  return (
    <div className={cn("flex items-center justify-center gap-[2.5px]", className)} aria-hidden="true">
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <div
          key={i}
          ref={(element) => { elements.current[i] = element; }}
          className="waveform-bar w-[2.5px] h-full rounded-full"
          style={{ background: isActive ? "var(--color-accent)" : "var(--color-border)" }}
        />
      ))}
    </div>
  );
}
