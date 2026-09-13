import { useState } from "react";
import type { DecisionLinkType, DecisionLink } from "./types";
import { FormSheet, Group, FieldRow, Strip, ErrorLine } from "../shared/FormSheet";
import { todayISO, addDays } from "../schedule/calendar";
import { pressable } from "../shared/pressable";

// The capture sheet (Screen 03) and the supersede sheet (Screen 05), one
// component: a supersede is a capture with Attached To and Ruled Out carried
// over and the Decided/Why fields empty. Two fields required by the spec's
// spirit, one by its letter: the decision line. Save is never disabled;
// missing Why saves anyway and the record shows "No reason recorded". A
// blocked Save is a confirm gate, which is banned.

export interface AttachOption { type: DecisionLinkType; id: string; label: string }

export interface DecisionDraft {
  decision: string;
  why?: string;
  ruledOut?: string[];
  linkedType?: DecisionLinkType;
  linkedId?: string;
  linkedLabel?: string;
  revisitOn?: string;
  // C-53 (Astra, 2026-09-12): what he expects of it, and every home it is
  // attached to. The triple above still carries links[0] for old readers.
  expected?: string;
  links?: DecisionLink[];
}

// BRAIN-F-02 (2026-09-05): the revisit dates used to be computed here with
// a fixed 86,400,000ms step and toISOString(), which reads the UTC date.
// East of Greenwich that made Week land 6 days out and Month 29, and on a
// clocks-change day the fixed step drifts too. todayISO and addDays from the
// calendar module walk with setDate and format from local getters.

export default function DecisionCaptureSheet({
  mode = "new",
  initial,
  attachOptions,
  onSave,
  onCancel,
}: {
  // supersede: Screen 05, prefilled links, empty decision.
  mode?: "new" | "supersede";
  initial?: Partial<DecisionDraft>;
  attachOptions: AttachOption[];
  onSave: (draft: DecisionDraft) => void;
  onCancel: () => void;
}) {
  const [decision, setDecision] = useState(initial?.decision ?? "");
  const [why, setWhy] = useState(initial?.why ?? "");
  const [ruledOut, setRuledOut] = useState<string[]>(initial?.ruledOut ?? []);
  const [ruleDraft, setRuleDraft] = useState("");
  // C-53: multi-select. Seeded from links, or from the old triple.
  const [attached, setAttached] = useState<string[]>(
    initial?.links?.map((l) => l.id) ?? (initial?.linkedId ? [initial.linkedId] : []),
  );
  const [expected, setExpected] = useState(initial?.expected ?? "");
  const [revisit, setRevisit] = useState(initial?.revisitOn ?? "");
  const [err, setErr] = useState(false);
  const today = todayISO();
  const revisitMode = revisit === "" ? "none" : revisit === addDays(today, 7) ? "week" : revisit === addDays(today, 30) ? "month" : "pick";

  const addRule = () => {
    const v = ruleDraft.trim();
    if (!v) return;
    if (!ruledOut.some((r) => r.toLowerCase() === v.toLowerCase())) setRuledOut([...ruledOut, v]);
    setRuleDraft("");
  };

  // BRAIN-F-17 (2026-09-05): attachOptions is the "common homes" list, and it
  // drops closed projects, achieved and dropped goals, and non-org areas. A
  // supersede of a decision attached to one of those found nothing to match
  // on save, so the new call saved with NO attachment and no warning, and the
  // old home's decision banner went with it. The record's own link is carried
  // as an option of its own, from the label the record already stores, so
  // Change It keeps the attachment it inherited and the menu can still say it.
  const seeded: AttachOption[] = initial?.links?.map((l) => ({ type: l.type, id: l.id, label: l.label }))
    ?? (initial?.linkedId && initial.linkedType && initial.linkedLabel ? [{ type: initial.linkedType, id: initial.linkedId, label: initial.linkedLabel }] : []);
  const carried: AttachOption[] = seeded.filter((c) => !attachOptions.some((o) => o.id === c.id));
  const options: AttachOption[] = [...attachOptions, ...carried];
  const toggleAttach = (id: string) => setAttached((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const save = () => {
    if (!decision.trim()) { setErr(true); return; }
    const picked = options.filter((o) => attached.includes(o.id));
    const first = picked[0];
    onSave({
      decision: decision.trim(),
      why: why.trim() || undefined,
      ruledOut: ruledOut.length ? ruledOut : undefined,
      linkedType: first?.type,
      linkedId: first?.id,
      linkedLabel: first?.label,
      links: picked.length ? picked.map((o) => ({ type: o.type, id: o.id, label: o.label })) : undefined,
      expected: expected.trim() || undefined,
      revisitOn: revisit || undefined,
    });
  };

  return (
    <FormSheet title={mode === "supersede" ? "New Call" : "New Decision"} onCancel={onCancel} onSave={save}>
      <Group label="What You Decided">
        <FieldRow
          ariaLabel="What you decided"
          placeholder="e.g. Fall clinics run Saturdays only"
          value={decision}
          onChange={(v) => { setDecision(v); if (err) setErr(false); }}
          error={err}
        />
      </Group>
      <ErrorLine text={err ? "Add the decision." : null} />

      <Group label="Why">
        <FieldRow ariaLabel="Why" placeholder="The reason you will forget · One line is enough" value={why} onChange={setWhy} />
      </Group>

      <Group label="Expected">
        <FieldRow ariaLabel="Expected" placeholder="What This Should Do · One line" value={expected} onChange={setExpected} />
      </Group>

      <Group label="Ruled Out">
        {ruledOut.length > 0 && (
          <Strip>
            {ruledOut.map((r) => (
              <div {...pressable(() => setRuledOut(ruledOut.filter((x) => x !== r)))} key={r} className="chip active">{r}</div>
            ))}
          </Strip>
        )}
        <FieldRow ariaLabel="Option you closed" placeholder="Option you closed · Enter adds" value={ruleDraft} onChange={setRuleDraft} onEnter={addRule} />
      </Group>

      <Group label="Revisit">
        <Strip>
          <div {...pressable(() => setRevisit(""))} className={"chip" + (revisitMode === "none" ? " active" : "")}>None</div>
          <div {...pressable(() => setRevisit(addDays(today, 7)))} className={"chip" + (revisitMode === "week" ? " active" : "")}>Week</div>
          <div {...pressable(() => setRevisit(addDays(today, 30)))} className={"chip" + (revisitMode === "month" ? " active" : "")}>Month</div>
          <div {...pressable(() => setRevisit(revisitMode === "pick" && revisit ? revisit : addDays(today, 14)))} className={"chip" + (revisitMode === "pick" ? " active" : "")}>Pick</div>
        </Strip>
        {revisitMode === "pick" && (
          <FieldRow ariaLabel="Revisit date" type="date" value={revisit} onChange={setRevisit} />
        )}
      </Group>

      {options.length > 0 && (
        <Group label="Attached To">
          {/* C-53: as many homes as it has. Choosers, so filled chips. */}
          <Strip>
            {options.map((o) => (
              <div key={o.id} className={"chip" + (attached.includes(o.id) ? " active" : "")} role="checkbox" aria-checked={attached.includes(o.id)} tabIndex={0}
                onClick={() => toggleAttach(o.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleAttach(o.id); } }}>
                {o.label}
              </div>
            ))}
          </Strip>
        </Group>
      )}
    </FormSheet>
  );
}
