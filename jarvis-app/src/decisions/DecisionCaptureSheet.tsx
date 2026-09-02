import { useState } from "react";
import type { DecisionLinkType } from "./types";
import { FormSheet, Group, Row, FieldRow, Strip, ErrorLine } from "../shared/FormSheet";
import HeadMenu from "../shared/HeadMenu";

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
}

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const addDaysISO = (iso: string, n: number) =>
  new Date(new Date(iso + "T00:00:00").getTime() + n * 86400000).toISOString().slice(0, 10);

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
  const [attach, setAttach] = useState<string>(initial?.linkedId ?? "");
  const [revisit, setRevisit] = useState(initial?.revisitOn ?? "");
  const [err, setErr] = useState(false);
  const today = todayISO();
  const revisitMode = revisit === "" ? "none" : revisit === addDaysISO(today, 7) ? "week" : revisit === addDaysISO(today, 30) ? "month" : "pick";

  const addRule = () => {
    const v = ruleDraft.trim();
    if (!v) return;
    if (!ruledOut.some((r) => r.toLowerCase() === v.toLowerCase())) setRuledOut([...ruledOut, v]);
    setRuleDraft("");
  };

  const save = () => {
    if (!decision.trim()) { setErr(true); return; }
    const opt = attachOptions.find((o) => o.id === attach);
    onSave({
      decision: decision.trim(),
      why: why.trim() || undefined,
      ruledOut: ruledOut.length ? ruledOut : undefined,
      linkedType: opt?.type,
      linkedId: opt?.id,
      linkedLabel: opt?.label,
      revisitOn: revisit || undefined,
    });
  };

  const attachLabel = attachOptions.find((o) => o.id === attach)?.label ?? "None";

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

      <Group label="Ruled Out">
        {ruledOut.length > 0 && (
          <Strip>
            {ruledOut.map((r) => (
              <div key={r} className="chip active" role="button" tabIndex={0} onClick={() => setRuledOut(ruledOut.filter((x) => x !== r))}>{r}</div>
            ))}
          </Strip>
        )}
        <FieldRow ariaLabel="Option you closed" placeholder="Option you closed · Enter adds" value={ruleDraft} onChange={setRuleDraft} onEnter={addRule} />
      </Group>

      <Group label="Revisit">
        <Strip>
          <div className={"chip" + (revisitMode === "none" ? " active" : "")} role="button" tabIndex={0} onClick={() => setRevisit("")}>None</div>
          <div className={"chip" + (revisitMode === "week" ? " active" : "")} role="button" tabIndex={0} onClick={() => setRevisit(addDaysISO(today, 7))}>Week</div>
          <div className={"chip" + (revisitMode === "month" ? " active" : "")} role="button" tabIndex={0} onClick={() => setRevisit(addDaysISO(today, 30))}>Month</div>
          <div className={"chip" + (revisitMode === "pick" ? " active" : "")} role="button" tabIndex={0} onClick={() => setRevisit(revisitMode === "pick" && revisit ? revisit : addDaysISO(today, 14))}>Pick</div>
        </Strip>
        {revisitMode === "pick" && (
          <FieldRow ariaLabel="Revisit date" type="date" value={revisit} onChange={setRevisit} />
        )}
      </Group>

      {attachOptions.length > 0 && (
        <Group label="Attached To">
          <Row label="Link">
            <HeadMenu
              variant="value"
              ariaLabel="Attached to"
              value={attach}
              off={attach === ""}
              label={attachLabel}
              options={[{ value: "", label: "None" }, ...attachOptions.map((o) => ({ value: o.id, label: o.label }))]}
              onPick={setAttach}
            />
          </Row>
        </Group>
      )}
    </FormSheet>
  );
}
