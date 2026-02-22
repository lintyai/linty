import { useState, useEffect } from "react";
import { Copy, Check } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { cn } from "@/lib/utils";

interface TranscriptionResultProps {
  text: string;
  className?: string;
}

export function TranscriptionResult({
  text,
  className,
}: TranscriptionResultProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (copied) {
      const t = setTimeout(() => setCopied(false), 1500);
      return () => clearTimeout(t);
    }
  }, [copied]);

  const handleCopy = async () => {
    await writeText(text);
    setCopied(true);
  };

  if (!text) return null;

  return (
    <div className={cn("animate-slide-up w-full", className)}>
      <div className="group relative rounded-lg border border-border-subtle bg-bg-elevated px-3 py-2.5">
        <p className="pr-8 text-[13px] leading-relaxed text-text-primary line-clamp-3">
          {text}
        </p>
        <button
          onClick={handleCopy}
          className={cn(
            "absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md transition-all duration-150",
            "opacity-0 group-hover:opacity-100",
            "hover:bg-bg-hover active:scale-95",
            copied && "opacity-100",
          )}
          title={copied ? "Copied!" : "Copy to clipboard"}
        >
          {copied ? (
            <Check size={13} className="text-success" />
          ) : (
            <Copy size={13} className="text-text-muted" />
          )}
        </button>
      </div>
    </div>
  );
}
