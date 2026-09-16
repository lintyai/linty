import { useState } from "react";
import { Info, X } from "lucide-react";
import { useAppStore } from "@/store/app.store";

/** A notice from Linty, set in the update policy. Hidden until the text changes once dismissed. */
export function PolicyBanner() {
  const banner = useAppStore((s) => s.policy?.banner?.trim() || null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!banner || banner === dismissed) return null;
  return (
    <div className="policy-banner" role="status">
      <Info size={14} aria-hidden="true" />
      <span>{banner}</span>
      <button className="icon-button" aria-label="Dismiss notice" onClick={() => setDismissed(banner)}>
        <X size={14} />
      </button>
    </div>
  );
}
