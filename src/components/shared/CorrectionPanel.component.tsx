import { BookPlus, Check, Pencil, ScanLine } from "lucide-react";
import { isKnownToDictionary, learnablePairs } from "@/lib/dictionary.util";
import { cn } from "@/lib/utils";
import type { CorrectionRecord, DictionaryEntry } from "@/types/correction.types";

interface CorrectionPanelProps {
  corrections: CorrectionRecord[];
  entries: DictionaryEntry[];
  onAddToDictionary: (right: string, wrong: string) => void;
}

/** What the person changed after a dictation, with one-click dictionary adds (styles: .correction-panel). */
export function CorrectionPanel({ corrections, entries, onAddToDictionary }: CorrectionPanelProps) {
  if (!corrections.length) return null;
  return (
    <section className="correction-panel" aria-label="Corrections">
      {corrections.map((record) => {
        const learnable = learnablePairs(record.pairs);
        return (
          <div key={record.correctionId} className="correction-record">
            <p className="correction-meta">
              {record.source === "edit" ? <Pencil size={11} /> : <ScanLine size={11} />}
              {record.source === "edit" ? "Edited in Linty" : `Corrected in ${record.application?.name ?? "another app"}`}
              {" · "}
              {new Date(record.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              {record.rewrite && <span className="correction-rewrite">rewrite, not used for learning</span>}
            </p>
            <ul className="correction-pairs">
              {record.pairs.map((pair, i) => {
                const learn = learnable.find((l) => pair.kind === "substitution" && pair.from.includes(l.from) && pair.to.includes(l.to));
                const known = learn ? isKnownToDictionary(entries, learn.from, learn.to) : false;
                return (
                  <li key={i} className={cn("correction-pair", `is-${pair.kind}`)}>
                    {pair.kind !== "insertion" && <del>{pair.from}</del>}
                    {pair.kind === "substitution" && <span aria-hidden="true">→</span>}
                    {pair.kind !== "deletion" && <ins>{pair.to}</ins>}
                    {learn && !record.rewrite && (
                      known ? (
                        <span className="correction-known" title="Already in your dictionary">
                          <Check size={11} /> in dictionary
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="correction-add"
                          onClick={() => onAddToDictionary(learn.to, learn.from)}
                          aria-label={`Add ${learn.to} to dictionary, replacing ${learn.from}`}
                        >
                          <BookPlus size={11} /> Add to dictionary
                        </button>
                      )
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
