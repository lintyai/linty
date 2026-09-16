import { useSettings } from "@/hooks/useSettings.hook";
import {
  TRIGGER_KEY_OPTIONS,
  FALLBACK_TRIGGER_ACCELERATOR,
} from "@/store/slices/settings.slice";
import {
  isModifierHoldTrigger,
  formatTriggerDisplay,
} from "@/lib/trigger.util";
import { TriggerKeyPicker } from "@/components/shared/TriggerKeyPicker.component";
import {
  PageLayout,
  PageHeader,
} from "@/components/shared/PageLayout.component";
import { formatTriggerKeycap } from "@/lib/trigger.util";

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
              TRIGGER_KEY_OPTIONS.find(
                (o) => o.value === FALLBACK_TRIGGER_ACCELERATOR,
              )?.display ?? "⌘⇧Space (hold)",
          },
        ]
      : []),
    ...STATIC_SHORTCUTS,
  ];

  return (
    <PageLayout reading>
      <PageHeader page="shortcuts" />
      <div className="shortcuts-hero">
        <kbd>{formatTriggerKeycap(triggerKey)}</kbd>
        <div>
          <h2>Hold, speak, release.</h2>
          <p>Your words appear where your cursor is.</p>
        </div>
      </div>
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
      <div className="shortcut-list">
        {shortcuts.map((shortcut) => (
          <div key={shortcut.action}>
            <span>{shortcut.action}</span>
            <kbd>{shortcut.mac}</kbd>
          </div>
        ))}
      </div>
    </PageLayout>
  );
}
