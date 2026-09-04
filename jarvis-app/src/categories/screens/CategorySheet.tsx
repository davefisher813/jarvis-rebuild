import { useState } from "react";
import { COLOR_GROUPS, CATEGORY_KINDS, KIND_LABEL, type ColorSlot, type CategoryKind } from "../types";
import { suggestKind } from "../kinds";
import { catIcon, ICON_GROUPS } from "../icons";
import { FormSheet, Group, MenuRow, SwitchRow, Strip, DeleteRow, ErrorLine } from "../../shared/FormSheet";
import { FolderGlyph, ClockGlyph } from "../../shared/glyphs";

export interface CategoryDraft {
  name: string;
  color: ColorSlot;
  icon: string;
  kind: CategoryKind;
  season?: "paused";
  workHours?: boolean;
}

// THE AREA SHEET ON THE SHEET BAR (2026-09-02, the last form sheets). The
// name row's tile IS the area as it will look (the picked icon in the
// picked colour), so the two grids below change something he can see
// while he picks. Kind is a menu; the org settings are switches; colour
// and icon stay grids (grouped, 2026-08-21: twenty-four in one grid is
// unscannable), as strips of their group.
export default function CategorySheet({
  mode,
  initial,
  onSave,
  onDelete,
  onCancel,
}: {
  mode: "new" | "edit";
  initial?: Partial<CategoryDraft>;
  onSave: (draft: CategoryDraft) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [delArmed, setDelArmed] = useState(false);
  const [color, setColor] = useState<ColorSlot>(initial?.color ?? "blue");
  const [icon, setIcon] = useState<string>(initial?.icon ?? "folder");
  // Kind defaults from the name (never silently written; saving makes it real).
  const [kind, setKind] = useState<CategoryKind>(initial?.kind ?? suggestKind(initial?.name ?? ""));
  const [season, setSeason] = useState<"paused" | undefined>(initial?.season);
  const [workHours, setWorkHours] = useState(!!initial?.workHours);
  const [touched, setTouched] = useState(false);
  // B12's fix (MoneyFlow's Account/Payday sheets), generalized: Save creates
  // an area, so two taps created two. The first valid tap latches.
  const [saving, setSaving] = useState(false);

  const valid = name.trim().length > 0;
  const save = () => {
    if (!valid) {
      setTouched(true);
      return;
    }
    if (saving) return;
    setSaving(true);
    onSave({
      name: name.trim(),
      color,
      icon,
      kind,
      // Org settings only mean something on an org category; leaving org
      // clears them so a paused Work category cannot haunt a renamed one.
      season: kind === "org" ? season : undefined,
      workHours: kind === "org" ? workHours : undefined,
    });
  };

  return (
    <FormSheet title={mode === "new" ? "New Area" : "Edit Area"} onCancel={onCancel} onSave={save} saveDisabled={!valid} saveLabel={saving ? "Saving" : "Save"}>
      <Group label="Area">
        <div className="row xs-row">
          <div className={"row-ico cat-bg-" + color}>{catIcon(icon)}</div>
          <input className={"xs-input" + (touched && !valid ? " input-error" : "")} placeholder="Area Name" aria-label="Area name"
            value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <MenuRow tone="graphite" glyph={<FolderGlyph />} label="Kind" value={kind} ariaLabel="Kind"
          options={CATEGORY_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} onPick={(v) => setKind(v as CategoryKind)} />
      </Group>
      <ErrorLine text={touched && !valid ? "Add a category name." : null} />
      {kind === "org" && (
        <Group label="Season">
          {/* Paused = suggestions leave it alone until you wake it.
              Bills never pause; a low month cannot silence rent. */}
          <SwitchRow tone="sand" glyph={<ClockGlyph />} label="Paused" meta={season === "paused" ? "Suggestions leave it alone until you wake it" : "In season"}
            on={season === "paused"} onToggle={() => setSeason(season === "paused" ? undefined : "paused")} ariaLabel="Paused" />
          <SwitchRow tone="blue" glyph={<ClockGlyph />} label="Work Hours" meta={workHours ? "Follows my work hours" : "Any hour"}
            on={workHours} onToggle={() => setWorkHours((w) => !w)} ariaLabel="Work hours" />
        </Group>
      )}
      <Group label="Color">
        {COLOR_GROUPS.map((g) => (
          <Strip plain key={g.label}>
            <div className="pick-fam">{g.label}</div>
            <div className="swatch-pick">
              {g.slots.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={"swatch cat-bg-" + s + (s === color ? " sel" : "")}
                  aria-label={s}
                  aria-pressed={s === color}
                  onClick={() => setColor(s)}
                />
              ))}
            </div>
          </Strip>
        ))}
      </Group>
      <Group label="Icon">
        {ICON_GROUPS.map((g) => (
          <Strip plain key={g.label}>
            <div className="pick-fam">{g.label}</div>
            <div className="icon-pick">
              {g.keys.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={"icpick" + (k === icon ? " sel" : "")}
                  aria-label={k}
                  aria-pressed={k === icon}
                  onClick={() => setIcon(k)}
                >
                  {catIcon(k)}
                </button>
              ))}
            </div>
          </Strip>
        ))}
      </Group>
      {/* Armed two-tap (2026-08-09): deleting a category orphans every
          task, note, and project tagged with it, and it fired on ONE tap
          of a red button. Same pattern as Redo Setup. */}
      {mode === "edit" && onDelete && (
        <Group className="xs-actions">
          <DeleteRow label={delArmed ? "Tap Again to Delete" : "Delete Category"} onClick={() => { if (delArmed) { onDelete(); } else { setDelArmed(true); } }} />
        </Group>
      )}
    </FormSheet>
  );
}
