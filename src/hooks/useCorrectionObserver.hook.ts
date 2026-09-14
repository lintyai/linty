import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "@/store/app.store";
import { judgeCorrection } from "@/lib/correction-diff.util";
import { ingestCorrection } from "@/services/dictionary.service";
import { recordCorrection } from "@/services/user-corrections.service";
import type { ApplicationIdentity } from "@/types/transcript.types";
import type { CorrectionPair, CorrectionRecord } from "@/types/correction.types";

/** Payload of the Rust `correction-observed` event (src-tauri/src/corrections.rs). */
interface ObservedCorrection {
  transcriptId: string;
  pasted: string;
  wordCount: number;
  application: ApplicationIdentity;
  pairs: CorrectionPair[];
  secondsAfterPaste: number;
}

/**
 * Turns fixes the person made in the app they dictated into (seen by the
 * Accessibility watch after a paste) into corrections, exactly like an edit
 * made in History: recorded, then folded into suggestions or the dictionary.
 */
export function useCorrectionObserver() {
  useEffect(() => {
    const unlisten = listen<ObservedCorrection>("correction-observed", async ({ payload }) => {
      const { transcripts, autoLearnWords, transcriptionLanguage, addToast } = useAppStore.getState();
      const transcript = transcripts.find((t) => t.transcriptId === payload.transcriptId);
      const record: CorrectionRecord = {
        correctionId: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        transcriptId: payload.transcriptId,
        timestamp: Date.now(),
        source: "observed",
        engine: transcript?.engine ?? "local",
        modelName: transcript?.modelName ?? "",
        language: transcriptionLanguage,
        application: payload.application,
        wordCount: payload.wordCount,
        ...judgeCorrection(payload.pairs, payload.wordCount),
        pairs: payload.pairs,
      };
      try {
        await recordCorrection(record);
        const { suggested, learned } = await ingestCorrection(record, autoLearnWords);
        const where = payload.application.name;
        if (learned) {
          addToast({ type: "success", message: `Learned ${learned} word${learned === 1 ? "" : "s"} from your fix in ${where}.` });
        } else if (suggested) {
          addToast({ type: "info", message: `Noticed a fix in ${where}. Review it on the Dictionary page.` });
        }
      } catch (error) {
        console.error("Failed to record an observed correction:", error);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}
