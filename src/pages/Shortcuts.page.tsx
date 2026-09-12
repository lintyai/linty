import { useSettings } from "@/hooks/useSettings.hook";
import {
  TRIGGER_KEY_OPTIONS,
  FALLBACK_TRIGGER_ACCELERATOR,
} from "@/store/slices/settings.slice";
import { isModifierHoldTrigger, formatTriggerDisplay } from "@/lib/trigger.util";
import { TriggerKeyPicker } from "@/components/shared/TriggerKeyPicker.component";
import { cn } from "@/lib/utils";

const STATIC_SHORTCUTS = [
  { action: "Search Linty", mac: "⌘K" },
  { action: "Show / hide sidebar", mac: "⌃⌘S" },
  { action: "Settings", mac: "⌘," },
  { action: "Search history", mac: "⌘F" },
  { action: "Copy selected transcript", mac: "⌘C" },
  { action: "Dismiss / Back", mac: "Esc" },
  { action: "Quit", mac: "⌘Q" },
];

export function ShortcutsPage() {
  const { triggerKey, saveTriggerKey } = useSettings();

  const shortcuts = [
    { action: "Push-to-talk", mac: formatTriggerDisplay(triggerKey) },
    // modifier-hold users keep the always-registered alternate combo
    ...(isModifierHoldTrigger(triggerKey)
      ? [
          {
            action: "Push-to-talk (alt)",
            mac:
              TRIGGER_KEY_OPTIONS.find((o) => o.value === FALLBACK_TRIGGER_ACCELERATOR)
                ?.display ?? "⌘⇧Space (hold)",
          },
        ]
      : []),
    ...STATIC_SHORTCUTS,
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Content */}
      <div className="preferences-scroll">
        <div className="preferences-content">
          <div className="page-intro"><h2>A shortcut to your words</h2><p>Choose a dictation trigger and navigate Linty from your keyboard.</p></div>
          <div className="mb-2.5">
            <span className="text-[13px] font-semibold text-text-primary">
              Trigger Key
            </span>
          </div>
          <TriggerKeyPicker
            value={triggerKey}
            onChange={saveTriggerKey}
            className="mb-6"
          />

          <div className="mb-2.5">
            <span className="text-[13px] font-semibold text-text-primary">
              Shortcuts
            </span>
          </div>
          <div className="rounded-[10px] bg-bg-elevated border border-border-subtle overflow-hidden">
            <div className="flex flex-col">
              {shortcuts.map((s, i) => (
                <div
                  key={s.action}
                  className={cn(
                    "flex items-center justify-between px-4 py-[10px]",
                    i < shortcuts.length - 1 && "border-b border-border-subtle",
                  )}
                >
                  <span className="text-[13px] text-text-primary">{s.action}</span>
                  <kbd className="rounded-md bg-bg-hover border border-border-subtle px-2.5 py-1 text-[12px] font-medium text-text-secondary tabular-nums">
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
