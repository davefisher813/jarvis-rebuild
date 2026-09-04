import { useState } from "react";
import { PROJECT_META, PROJECT_STATES, type ProjectData, type ProjectStatus } from "./types";
import type { Category } from "../categories/types";
import type { Goal } from "../life/types";
import { FormSheet, Group, FieldRow, MenuRow, DeleteRow, ErrorLine } from "../shared/FormSheet";
import { FolderKanban, Tag, Calendar } from "../shared/icons";
import { TargetGlyph, PulseGlyph } from "../shared/glyphs";

// THE PROJECT SHEET ON THE SHEET BAR (2026-09-02, the form sheets after the
// task sheet): the name as the row, Status, Back On when it is on hold, Area
// and Goal as values that open the dropdown, Delete as the last group.
export default function ProjectSheet({ mode, categories, goals = [], initial, onSave, onDelete, onCancel }: {
  mode: "new" | "edit"; categories: Category[]; goals?: Goal[]; initial?: Partial<ProjectData>;
  onSave: (d: ProjectData) => void; onDelete?: () => void; onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [status, setStatus] = useState<ProjectStatus>(initial?.status ?? "active");
  const [category, setCategory] = useState<string>(initial?.category ?? "");
  const [goalId, setGoalId] = useState<string>(initial?.goalId ?? "");
  // PICK 20: a hold with no end is a project that disappeared.
  const [holdUntil, setHoldUntil] = useState<string>(initial?.holdUntil ?? "");
  const [touched, setTouched] = useState(false);
  // B12's fix (MoneyFlow's Account/Payday sheets), generalized: Save creates
  // a project, so two taps created two. The first valid tap latches.
  const [saving, setSaving] = useState(false);
  const valid = title.trim().length > 0;
  const save = () => {
    if (!valid) { setTouched(true); return; }
    if (saving) return;
    setSaving(true);
    onSave({ title: title.trim(), status, category: category || undefined, goalId: goalId || undefined, holdUntil: status === "on_hold" && holdUntil ? holdUntil : undefined });
  };
  return (
    <FormSheet title={mode === "new" ? "New Project" : "Edit Project"} onCancel={onCancel} onSave={save} saveDisabled={!valid} saveLabel={saving ? "Saving" : "Save"}>
      <Group label="Project">
        <FieldRow tone="indigo" glyph={<FolderKanban className="ic" />} value={title} onChange={setTitle} placeholder="e.g. Q3 launch plan"
          ariaLabel="Project title" error={touched && !valid} right={false} />
      </Group>
      <ErrorLine text={touched && !valid ? "Add a title." : null} />
      <Group label="State">
        <MenuRow tone="orange" glyph={<PulseGlyph />} label="Status" value={status} ariaLabel="Status"
          options={PROJECT_STATES.map((s) => ({ value: s, label: PROJECT_META[s].label }))} onPick={(v) => setStatus(v as ProjectStatus)} />
        {status === "on_hold" && (
          <FieldRow tone="sky" glyph={<Calendar className="ic" />} label="Back On" type="date" value={holdUntil} onChange={setHoldUntil} ariaLabel="Back on" />
        )}
      </Group>
      {status === "on_hold" && <div className="xs-note">The day it comes back. A hold with no date is a project that disappeared.</div>}
      {(categories.length > 0 || goals.length > 0) && (
        <Group label="Where">
          {categories.length > 0 && (
            <MenuRow tone="blue" glyph={<Tag className="ic" />} label="Area" value={category} ariaLabel="Area" off={category === ""}
              options={[{ value: "", label: "None" }, ...categories.map((c) => ({ value: c.id, label: c.data.name, dot: c.data.color as string }))]}
              onPick={setCategory} />
          )}
          {goals.length > 0 && (
            <MenuRow tone="red" glyph={<TargetGlyph />} label="Goal" value={goalId} ariaLabel="Goal" off={goalId === ""}
              options={[{ value: "", label: "None" }, ...goals.map((g) => ({ value: g.id, label: g.data.title }))]}
              onPick={setGoalId} />
          )}
        </Group>
      )}
      {mode === "edit" && onDelete && (
        <Group className="xs-actions"><DeleteRow label="Delete Project" onClick={onDelete} /></Group>
      )}
    </FormSheet>
  );
}
