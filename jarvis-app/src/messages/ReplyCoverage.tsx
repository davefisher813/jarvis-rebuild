import { useEffect, useMemo, useState } from "react";
import { haptics } from "../shared/haptics";
import { rowDoor } from "../shared/rowDoor";
import { Facts } from "./factsLine";
import type { ReplyRequirements } from "./mailContracts";
import {
  coverageKey, coverageSummary, evaluateCoverage,
  type AttachmentFact, type CoverageItem, type CoverageOverride, type CoverageOverrides,
} from "./replyCoverage";

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
      <div className="row" {...rowDoor(toggle)}>
        <div className="row-grow">
          <div className="conn-name">{summary.label}</div>
          {summary.incomplete && <div className="conn-meta">Not Every Message Was Read</div>}
        </div>
        <button className="pill-act" aria-expanded={open} onClick={(e) => { e.stopPropagation(); toggle(); }}>{open ? "Hide" : summary.incomplete ? "Review Requests" : "Check"}</button>
      </div>
      {open && result.items.map((item) => (
        <Line key={item.requirement.id} item={item} mark={overrides[coverageKey(item.requirement)]} onOverride={onOverride} />
      ))}
    </div>
  );
}

function Line({ item, mark, onOverride }: { item: CoverageItem; mark: CoverageOverride | undefined; onOverride: (key: string, mark: CoverageOverride | null) => void }) {
  const key = coverageKey(item.requirement);
  // One control per line: take the mark back, or make one the reading did not.
  const action: { label: string; next: CoverageOverride | null } =
    mark ? { label: "Clear Mark", next: null }
    : item.status === "addressed" ? { label: "Mark Open", next: "open" }
    : { label: "Mark Answered", next: "addressed" };
  const go = () => { haptics.selection(); onOverride(key, action.next); };
  return (
    <div className="row" {...rowDoor(go)}>
      <div className="row-grow">
        <div className="conn-name">{item.requirement.label}</div>
        <Facts facts={[
          item.status === "addressed" ? { text: "Answered", tone: "good" } : item.status === "uncertain" ? { text: "Maybe", tone: "warn" } : { text: "Open" },
          item.note ? { text: item.note } : null,
        ]} />
        <div className="conn-meta">{item.requirement.sourceQuote}</div>
      </div>
      <button className="pill-act" onClick={(e) => { e.stopPropagation(); go(); }}>{action.label}</button>
    </div>
  );
}
