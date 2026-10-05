import { useEffect, useMemo, useState } from "react";
import { haptics } from "../../shared/haptics";
import { rowDoor } from "../../shared/rowDoor";
import { Facts } from "../factsLine";
import type { ReplyRequirements } from "../mailContracts";
import {
  coverageKey, coverageSummary, evaluateCoverage,
  type AttachmentFact, type CoverageItem, type CoverageOverride, type CoverageOverrides,
} from "../replyCoverage";

// "ANSWERED 3 OF 4" (2026-09-29).
//
// A quiet line under the reply that says how much of what was asked the draft
// answers. Tap it and the checklist opens: each ask, whether the words answer
// it, and one control to say "I did" or "I did not" when the reading is wrong.
//
// It never blocks Send and never sends. It never calls anything: the asks came
// from the thread's one brief (replyRequirements) and the check is a local
// function of the words (replyCoverage.ts). The only timer is a 300 ms
// debounce, so typing does not redraw a list on every key.
//
// A complete read that found nothing asked shows nothing at all. A partial one
// says so ("Answered 3 of 4 Found · Review Requests") and explains, because a
// count over a conversation that was only partly read is not the count.

/** The pause after the last keystroke before the check runs. */
export const COVERAGE_DEBOUNCE_MS = 300;

export default function ReplyCoverage({
  requirements, text, attachments, overrides, onOverride, debounceMs = COVERAGE_DEBOUNCE_MS,
}: {
  /** Undefined means the thread was not analysed: nothing is shown. */
  requirements: ReplyRequirements | undefined;
  /** The draft's own words. */
  text: string;
  /** What is actually attached. */
  attachments: readonly AttachmentFact[];
  overrides: CoverageOverrides;
  /** null clears the mark. */
  onOverride: (key: string, mark: CoverageOverride | null) => void;
  debounceMs?: number;
}) {
  const [open, setOpen] = useState(false);
  // The words the check last ran on. The first render uses them as they are;
  // after that they trail the keystrokes by the debounce.
  const [seen, setSeen] = useState({ text, attachments });
  // Keyed on the file names, not the array, so a caller that builds the list
  // inline does not restart the timer on every render.
  const attKey = attachments.map((a) => a.filename).join("\u241F");
  useEffect(() => {
    const t = setTimeout(() => setSeen({ text, attachments }), debounceMs);
    return () => clearTimeout(t);
  }, [text, attKey, debounceMs]);

  const items = requirements?.items;
  const result = useMemo(
    () => (items ? evaluateCoverage(items, seen.text, seen.attachments, overrides) : null),
    [items, seen, overrides],
  );
  if (!requirements || !result) return null;
  const summary = coverageSummary(result, requirements.completeSource);
  if (!summary) return null;
  const toggle = () => { haptics.selection(); setOpen((v) => !v); };
  return (
    <div className="card">
      {/* Clean rows (Dave 2026-10-05, locked): the row is the door that opens the checklist; no Check, Hide or Review Requests
          capsule sits on it. */}
      <div className="row" {...rowDoor(toggle)} aria-expanded={open}>
        <div className="row-grow">
          <div className="conn-name">{summary.label}</div>
          {summary.incomplete && <div className="conn-meta">Not Every Message Was Read</div>}
        </div>
        <div className="chev" />
      </div>
      {open && result.items.map((item) => (
        <Line key={item.requirement.id} item={item} mark={overrides[coverageKey(item.requirement)]} onOverride={onOverride} />
      ))}
    </div>
  );
}

/** The one fact a line leads with: the state, and the reason when the reading has one. */
function statusFact(item: CoverageItem): string {
  const word = item.status === "addressed" ? "Answered" : item.status === "uncertain" ? "Maybe" : "Open";
  if (!item.note) return word;
  // A hand mark says everything itself ("Marked Answered"); a note that repeats the word adds nothing.
  if (/^Marked /.test(item.note) || item.note.startsWith(word)) return item.note;
  return word + ", " + item.note;
}

function Line({ item, mark, onOverride }: { item: CoverageItem; mark: CoverageOverride | undefined; onOverride: (key: string, mark: CoverageOverride | null) => void }) {
  const key = coverageKey(item.requirement);
  // One tap per line: take the mark back, or make one the reading did not.
  const next: CoverageOverride | null = mark ? null : item.status === "addressed" ? "open" : "addressed";
  const go = () => { haptics.selection(); onOverride(key, next); };
  const answered = item.status === "addressed";
  return (
    // Clean rows (Dave 2026-10-05, locked): whether the ask is answered is STATE, so it is the inline check, and the row's
    // tap flips the mark. No Mark Answered, Mark Open or Clear Mark capsule sits on the row.
    <div className="row" {...rowDoor(go)} aria-label={item.requirement.label + (answered ? ", Answered" : ", Open")}>
      <span className={"cb" + (answered ? " on" : "")} aria-hidden="true">{answered ? "\u2713" : ""}</span>
      <div className="row-grow">
        <div className="conn-name">{item.requirement.label}</div>
        {/* 2026-10-05 (the catalog gate): ONE toned fact, then the sender's own words
            as the row's one grey (R1). The status and its note were two facts, the
            status plain grey when Open, the note a plain grey beside the quote: two
            or three greys on a row. The state wears the key (answered is green; a
            Maybe or an Open ask needs you, amber), and its reason rides inside it
            ("Open, Nothing Is Attached"). A mark's note is the whole fact. */}
        <Facts facts={[{ text: statusFact(item), tone: item.status === "addressed" ? "good" : "warn" }]} />
        <div className="conn-meta">{item.requirement.sourceQuote}</div>
      </div>
    </div>
  );
}
