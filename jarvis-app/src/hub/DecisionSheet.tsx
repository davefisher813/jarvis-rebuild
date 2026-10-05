// SAVE A DECISION (IMPLEMENTATION-SPEC.md 06). Statement and reason
// required; alternatives optional; dependencies are real records picked
// from a list, never guessed from a title; the source is the proposal's
// evidence or "Entered by You". A conflict with an active decision is named
// with both values side by side, and the two ways out are Edit and Replace.
// Save shows the exact project and effect; there is no second confirmation.

import { useState } from "react";
import { FormSheet, Group, FieldRow, TextRow, Note, ErrorLine, Row } from "../shared/FormSheet";
import { pressable } from "../shared/pressable";
import { COMMAND_LINES } from "../substrate/commands/errors";
import { conflictsWith, REPLACE_LINE } from "./copy";
import type { Conflict, DependencyRef } from "./hubClient";
import HubFacts, { type HubFact, type HubFactInput } from "./HubFacts";
import { titleCase } from "../shared/casing";

export interface DecisionDraft {
  title: string;
  statement: string;
  rationale: string;
  /** One per line. */
  alternatives: string;
  constraintKey: string;
  constraintValue: string;
  dependencies: DependencyRef[];
}

export interface DependencyOption { id: string; label: string; kindLabel: string }

// 2026-10-05 (catalog gate, R1, R6 and the casing rule): a constraint on the
// conflict card was "trip_budget_usd · 2400", a raw key and a value joined by
// a baked dot inside a sentence class. The key is the line's one grey, in
// Title Case, and the value is its own white fact (a number with no state).
// A side with no value says nothing (the old "None" was a placeholder).
export const constraintFacts = (key: string, value: string | null | undefined): HubFactInput[] => [
  { text: titleCase(key.replace(/_/g, " ")) },
  value ? { text: value, strong: true } : null,
].filter((f): f is HubFact => !!f);

export const emptyDraft = (): DecisionDraft => ({ title: "", statement: "", rationale: "", alternatives: "", constraintKey: "", constraintValue: "", dependencies: [] });

export default function DecisionSheet({ mode, initial, projectTitle, sourceLine, sourceWhen, options, conflicts, busy = false, onSave, onReplace, onDismiss, onCancel }: {
  mode: "save" | "replace";
  initial: Partial<DecisionDraft>;
  projectTitle: string;
  sourceLine: string;
  /** The moment the source was written, as date facts under the source line. */
  sourceWhen?: HubFact[];
  options: DependencyOption[];
  /** Named by the server when the last save conflicted. */
  conflicts: Conflict[];
  busy?: boolean;
  onSave: (draft: DecisionDraft) => void;
  /** Replace the conflicting decision with this one, in one transaction. */
  onReplace: (draft: DecisionDraft, itemId: string) => void;
  onDismiss?: () => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<DecisionDraft>({ ...emptyDraft(), ...initial });
  const [tried, setTried] = useState(false);
  const set = <K extends keyof DecisionDraft>(k: K, v: DecisionDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const missing = {
    title: d.title.trim().length === 0,
    statement: d.statement.trim().length === 0,
    rationale: d.rationale.trim().length === 0,
  };
  const incomplete = missing.title || missing.statement || missing.rationale;
  const toggleDep = (id: string) => setD((x) => ({ ...x, dependencies: x.dependencies.some((r) => r.item_id === id) ? x.dependencies.filter((r) => r.item_id !== id) : [...x.dependencies, { item_id: id, kind: "depends_on" }] }));
  const verb = mode === "replace" ? "Replace Decision" : "Save Decision";
  const title = mode === "replace" ? "Replace Decision" : "Save Decision";
  const first = conflicts[0];

  return (
    <FormSheet title={title} onCancel={onCancel} saveLabel={busy ? "Saving…" : verb} saveDisabled={busy} dirty={d.dependencies.length > 0}
      onSave={() => { setTried(true); if (!incomplete && !busy) onSave(d); }}>
      <Group label="Project">
        <div className="row"><div className="row-grow"><div className="conn-name">{projectTitle}</div><div className="conn-meta">{mode === "replace" ? REPLACE_LINE : "Saved as a Decision You Can Replace or Withdraw Later"}</div></div></div>
      </Group>
      <Group label="Decision">
        <FieldRow value={d.title} onChange={(v) => set("title", v)} placeholder="A Short Name" ariaLabel="Decision title" error={tried && missing.title} right={false} />
        <TextRow value={d.statement} onChange={(v) => set("statement", v)} placeholder="What We Decided" ariaLabel="Statement" rows={3} />
      </Group>
      <Group label="Because">
        <TextRow value={d.rationale} onChange={(v) => set("rationale", v)} placeholder="The Reason You Will Forget" ariaLabel="Reason" rows={3} />
      </Group>
      <Group label="Ruled Out">
        <TextRow value={d.alternatives} onChange={(v) => set("alternatives", v)} placeholder="One Per Line, Optional" ariaLabel="Alternatives" rows={2} />
      </Group>
      <Group label="Constraint">
        <FieldRow label="Key" value={d.constraintKey} onChange={(v) => set("constraintKey", v)} placeholder="trip_budget_usd" ariaLabel="Constraint key" />
        <FieldRow label="Value" value={d.constraintValue} onChange={(v) => set("constraintValue", v)} placeholder="2400" ariaLabel="Constraint value" />
      </Group>
      {options.length > 0 && (
        <Group label="Depends On">
          {options.map((o) => {
            const on = d.dependencies.some((r) => r.item_id === o.id);
            return (
              <Row key={o.id} label={o.label} meta={o.kindLabel} onClick={() => toggleDep(o.id)}>
                <div className={"radio" + (on ? " on" : "")} role="checkbox" aria-checked={on} aria-label={o.label} />
              </Row>
            );
          })}
        </Group>
      )}
      <Group label="Source">
        <div className="row"><div className="row-grow"><div className="conn-name">{sourceLine}</div><HubFacts facts={sourceWhen ?? []} /></div></div>
      </Group>
      {first && (
        <Group label={conflictsWith(titleCase(first.title))}>
          <div className="row"><div className="row-grow hub-compare">
            <div><div className="eyebrow">Saved</div><div className="hub-text hub-text-strong">{first.statement}</div><HubFacts facts={constraintFacts(first.key, first.theirs)} /></div>
            <div><div className="eyebrow">This One</div><div className="hub-text hub-text-strong">{d.statement}</div><HubFacts facts={constraintFacts(first.key, first.mine)} /></div>
          </div></div>
          {/* The conflict card has its own words (both sides, side by side) and its one answer, so the answer is the card's own
              action row, the settled notice-card home (Dave 2026-10-05). */}
          <div className="notice-actions">
            {/* row-tap: the row IS the button; it fills the row */}
            <div {...pressable(() => { if (!incomplete && !busy) onReplace(d, first.item_id); })} className="row row-act">Replace {titleCase(first.title)} With This</div>
          </div>
        </Group>
      )}
      {tried && incomplete && <ErrorLine text={COMMAND_LINES.MISSING_DETAILS} />}
      {/* AN ACTION NEVER SITS ALONE IN A BOX (Dave 2026-10-05, rule 12): the dismissal stands by itself, not in a plate. */}
      {onDismiss && <div className="notice-clear-row"><button className="row-act hub-danger" onClick={onDismiss}>Dismiss Suggestion</button></div>}
      <Note>Dependencies Are Records You Pick · A Changed One Suggests a Review, Never a Rewrite</Note>
    </FormSheet>
  );
}

/** The sheet's lines back into what the function takes. */
export function draftToInput(d: DecisionDraft): { title: string; statement: string; rationale: string; alternatives: string[]; constraints: Array<{ key: string; value: string }>; dependencies: DependencyRef[] } {
  return {
    title: d.title.trim(),
    statement: d.statement.trim(),
    rationale: d.rationale.trim(),
    alternatives: d.alternatives.split("\n").map((s) => s.trim()).filter(Boolean),
    constraints: d.constraintKey.trim() && d.constraintValue.trim() ? [{ key: d.constraintKey.trim(), value: d.constraintValue.trim() }] : [],
    dependencies: d.dependencies,
  };
}
