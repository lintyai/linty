import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { advanceWaveform, flatWaveform } from "@/lib/dictation-waveform";
import { cn } from "@/lib/utils";

interface WaveformVisualizerProps {
  isActive: boolean;
  className?: string;
}

export function WaveformVisualizer({ isActive, className }: WaveformVisualizerProps) {
  const [levels, setLevels] = useState(flatWaveform);

  useEffect(() => {
    setLevels(flatWaveform());
    if (!isActive) return;
    let disposed = false;
    // Consume every native frame, including repeated zeroes. A single amplitude
    // prop can skip identical values and leave old speech visible during silence.
    const unlisten = listen<number>("audio-amplitude", ({ payload }) => {
      if (!disposed) setLevels(previous => advanceWaveform(previous, payload));
    });
    return () => {
      disposed = true;
      void unlisten.then(off => off());
    };
  }, [isActive]);

  return (
    <div className={cn("flex items-center justify-center gap-[2px]", className)} aria-hidden="true">
      {levels.map((level, i) => (
        <div
          key={i}
          className="waveform-bar w-[2px] h-full shrink-0 rounded-full"
          style={{
            background: isActive ? "var(--color-accent)" : "var(--color-border)",
            transform: `scaleY(${0.1 + level * 0.9})`,
            opacity: isActive ? 0.4 + level * 0.6 : 0.2,
          }}
        />
      ))}
    </div>
  );
}
