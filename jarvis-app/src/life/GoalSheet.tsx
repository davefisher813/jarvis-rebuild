import { useState } from "react";
import type { GoalData } from "./types";
import type { Category } from "../categories/types";
import type { Measure, Cadence } from "../bigger/measure";
import { todayISO } from "../tasks/grouping";
import { FormSheet, Group, Row, FieldRow, MenuRow, DeleteRow, ErrorLine, Note } from "../shared/FormSheet";
import HeadMenu from "../shared/HeadMenu";
import { Tag, Calendar } from "../shared/icons";
import { TargetGlyph, BullseyeGlyph, RepeatGlyph, DollarGlyph } from "../shared/glyphs";

type MeasureKind = "none" | "count" | "cadence" | "projects";
const KINDS: { key: MeasureKind; label: string }[] = [
  { key: "none", label: "None" },
  { key: "count", label: "Count" },
  { key: "cadence", label: "Rhythm" },
  { key: "projects", label: "Projects" },
];

// A goal is just a name plus the projects pointing at it. Session 6 removed
// BOTH self-reported controls that used to live here:
//   - Area: Life Areas were retired (state nobody maintained).
//   - Status: progress is now DERIVED from the goal's projects and their tasks,
//     so asking the user to also declare "on track" was a decision that changed
//     nothing they would ever see.
// Stored values for both are preserved on save rather than destroyed.
//
// ARCHITECTURE C (2026-08-22): plus the areas it covers. This is the one field
// that lets a goal see work nobody filed, which in Dave's data is nearly all of
// it. It is a WATCH LIST, not a move: nothing is refiled, nothing is copied,
// and unpicking an area changes only what the goal can see.
//
// ON THE SHEET BAR (2026-09-02, the last form sheets): the name as the row,
// the areas as the task sheet's multi menu, the finish line as a menu whose
// choice reveals only the fields that choice needs, the date and the dollar
// target typed at the right of their labels.
export default function GoalSheet({ mode, initial, categories = [], onSave, onDelete, onCancel }: {
  mode: "new" | "edit"; initial?: GoalData; categories?: Category[];
  onSave: (d: GoalData) => void; onDelete?: () => void; onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  // Money v1: an optional dollar target turns this into a savings goal.
  // Progress stays DERIVED (from logged entries), so this is a target, not a
  // self-reported status; it earns its field.
  const [target, setTarget] = useState(initial?.moneyTarget ? String(initial.moneyTarget) : "");
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  // D12 (2026-08-31): a lift or training measure is set FROM THE GYM (its
  // own sheet knows how to pick an exercise and a target set; this one does
  // not). This sheet neither edits nor destroys one: it is carried through
  // on save exactly as it arrived, and the menu below reads "None" for it
  // rather than pretending the goal has no finish line.
  const externalMeasure = initial?.measure?.kind === "lift" || initial?.measure?.kind === "training" ? initial.measure : undefined;
  // PICKS 13 + 14: the finish line and the date. Both optional, both derived
  // once set: nothing here asks him to report a status, only to say what
  // "done" means and when he wants it.
  const initialKind: MeasureKind =
    initial?.measure?.kind === "count" || initial?.measure?.kind === "cadence" || initial?.measure?.kind === "projects"
      ? initial.measure.kind : "none";
  const [kind, setKind] = useState<MeasureKind>(initialKind);
  const [count, setCount] = useState(initial?.measure?.kind === "count" ? String(initial.measure.target) : "");
  const [times, setTimes] = useState(initial?.measure?.kind === "cadence" ? String(initial.measure.times) : "3");
  const [per, setPer] = useState<Cadence>(initial?.measure?.kind === "cadence" ? initial.measure.per : "week");
  const [by, setBy] = useState(initial?.by ?? "");
  const [touched, setTouched] = useState(false);
  // B12's fix (MoneyFlow's Account/Payday sheets), generalized: Save creates
  // a goal, so two taps created two. The first valid tap latches.
  const [saving, setSaving] = useState(false);
  const targetOk = target.trim() === "" || (Number.isFinite(Number(target)) && Number(target) > 0);
  const countOk = kind !== "count" || (Number.isFinite(Number(count)) && Number(count) > 0);
  const timesOk = kind !== "cadence" || (Number.isFinite(Number(times)) && Number(times) > 0);
  const valid = title.trim().length > 0 && targetOk && countOk && timesOk;
  const measureOf = (): Measure | undefined => {
    if (kind === "count") return {
      kind: "count", target: Number(count),
      // Stamped so a count NEVER inherits the tagged history behind it. Kept
      // when the target is only edited, so editing does not reset progress.
      since: initial?.measure?.kind === "count" ? initial.measure.since ?? todayISO() : todayISO(),
    };
    if (kind === "cadence") return { kind: "cadence", times: Number(times), per };
    if (kind === "projects") return { kind: "projects" };
    return externalMeasure; // "None" here means "untouched", not "cleared", when a gym goal owns it
  };
  const toggleTag = (id: string) => setTags((t) => (id === "" ? [] : t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const areaNames = tags.map((id) => categories.find((c) => c.id === id)?.data.name).filter((n): n is string => !!n);
  const areaWord = areaNames.length === 0 ? "None" : areaNames.length === 1 ? areaNames[0]! : `${areaNames[0]} +${areaNames.length - 1}`;
  const dated = kind !== "none" || !!externalMeasure;
  const save = () => {
    if (!valid) { setTouched(true); return; }
    if (saving) return;
    setSaving(true);
    onSave({
      title: title.trim(),
      state: initial?.state ?? "on_track",
      ...(initial?.areaId ? { areaId: initial.areaId } : {}),
      ...(initial?.saved ? { saved: initial.saved } : {}),
      ...(initial?.dropped ? { dropped: initial.dropped } : {}),
      ...(tags.length ? { tags } : {}),
      measure: measureOf(),
      by: dated && by ? by : undefined,
      moneyTarget: target.trim() ? Number(target) : undefined,
    });
  };
  return (
    <FormSheet title={mode === "new" ? "New Goal" : "Edit Goal"} onCancel={onCancel} onSave={save} saveDisabled={!valid} saveLabel={saving ? "Saving" : "Save"}>
      <Group label="Goal">
        <FieldRow tone="red" glyph={<TargetGlyph />} value={title} onChange={setTitle} placeholder="e.g. Run a half marathon"
          ariaLabel="Goal title" error={touched && !title.trim()} right={false} />
      </Group>
      <ErrorLine text={touched && !title.trim() ? "Add a goal." : null} />
      {categories.length > 0 && (
        <>
          <Group label="Areas It Covers">
            <Row tone="blue" glyph={<Tag className="ic" />} label="Areas">
              <HeadMenu variant="value" ariaLabel="Areas" value={tags[0] ?? ""} label={areaWord} off={tags.length === 0} multi picked={tags}
                options={[{ value: "", label: "None" }, ...categories.map((c) => ({ value: c.id, label: c.data.name, dot: c.data.color as string }))]}
                onPick={toggleTag} />
            </Row>
          </Group>
          <Note>Tasks in these areas count toward this goal without being filed under a project.</Note>
        </>
      )}
      <Group label="Finish Line">
        <MenuRow tone="orange" glyph={<BullseyeGlyph />} label="Done Means" value={kind} ariaLabel="Finish line" off={kind === "none"}
          options={KINDS.map((k) => ({ value: k.key, label: k.label }))} onPick={(v) => setKind(v as MeasureKind)} />
        {kind === "count" && (
          <FieldRow tone="green" glyph={<RepeatGlyph />} label="How Many" value={count} onChange={setCount} placeholder="e.g. 12" inputMode="numeric"
            ariaLabel="How many" error={touched && !countOk} />
        )}
        {kind === "cadence" && (
          <>
            <FieldRow tone="green" glyph={<RepeatGlyph />} label="Times" value={times} onChange={setTimes} placeholder="e.g. 3" inputMode="numeric"
              ariaLabel="How many times" error={touched && !timesOk} />
            <MenuRow tone="sky" glyph={<Calendar className="ic" />} label="Per" value={per} ariaLabel="Per"
              options={[{ value: "week", label: "A Week" }, { value: "month", label: "A Month" }]} onPick={(v) => setPer(v as Cadence)} />
          </>
        )}
        {dated && (
          <FieldRow tone="indigo" glyph={<Calendar className="ic" />} label="Wanted By" type="date" value={by} onChange={setBy} ariaLabel="Wanted by" />
        )}
      </Group>
      <Note>
        {externalMeasure
          ? "Set from the gym · Picking one of these replaces it"
          : dated
            ? "Counted from real completions, never typed in · A date turns it into a rate"
            : "What finished looks like · Counted from real completions, never typed in"}
      </Note>
      <Group label="Money">
        <FieldRow tone="green" glyph={<DollarGlyph />} label="Dollar Target" value={target} onChange={setTarget} placeholder="Optional" inputMode="numeric"
          ariaLabel="Dollar target" error={touched && !targetOk} />
      </Group>
      <ErrorLine text={touched && !targetOk ? "A number, or empty" : null} />
      {mode === "edit" && onDelete && (
        <Group className="xs-actions"><DeleteRow label="Delete Goal" onClick={onDelete} /></Group>
      )}
    </FormSheet>
  );
}
