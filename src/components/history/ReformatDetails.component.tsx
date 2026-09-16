import { ChevronDown } from "lucide-react";
import type { TranscriptRecord } from "@/types/transcript.types";

export function ReformatDetails({ transcript }: { transcript: TranscriptRecord }) {
  const metrics = transcript.reformatting;
  return <>
    {metrics?.enabled && transcript.reformattedText != null && transcript.reformattedText !== transcript.rawText && <details className="original-transcript">
      <summary>Reformatted by S1-mini <ChevronDown size={14} /></summary>
      <p>{transcript.reformattedText}</p>
    </details>}
    {transcript.pastedText != null && transcript.pastedText !== transcript.finalText && <details className="original-transcript">
      <summary>Originally pasted text <ChevronDown size={14} /></summary>
      <p>{transcript.pastedText}</p>
    </details>}
  </>;
}
