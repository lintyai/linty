import { cn } from "@/lib/utils";

const SHORTCUTS = [
  { action: "Push-to-talk", mac: "fn (hold)" },
  { action: "Push-to-talk (alt)", mac: "⌘⇧Space" },
  { action: "Settings", mac: "⌘," },
  { action: "Search history", mac: "⌘F" },
  { action: "Copy transcript", mac: "⌘C" },
  { action: "Dismiss / Back", mac: "Esc" },
  { action: "Quit", mac: "⌘Q" },
];

export function ShortcutsPage() {
  return (
    <div className="flex h-full flex-col">
      <div
        data-tauri-drag-region
        className="flex h-[52px] shrink-0 items-center px-6"
      >
        <h1
          className="text-[16px] font-semibold text-text-primary tracking-[-0.01em]"
          data-tauri-drag-region
        >
          Keyboard Shortcuts
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-[480px]">
          <div className="rounded-[var(--radius-md)] bg-bg-elevated shadow-[var(--shadow-sm)] ring-1 ring-border-subtle overflow-hidden">
            <div className="flex flex-col">
              {SHORTCUTS.map((s, i) => (
                <div
                  key={s.action}
                  className={cn(
                    "flex items-center justify-between px-4 py-3",
                    i < SHORTCUTS.length - 1 && "border-b border-border-subtle",
                  )}
                >
                  <span className="text-[13px] text-text-primary">{s.action}</span>
                  <kbd
                    className="rounded-[var(--radius-sm)] bg-bg-hover px-2.5 py-1 text-[12px] font-medium text-text-secondary tabular-nums shadow-[var(--shadow-sm)] ring-1 ring-border-subtle"
                    style={{ fontFamily: "inherit" }}
                  >
                    {s.mac}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
