import { useState } from "react";
import type { PersonData } from "../types";
import type { ColorSlot } from "../../categories/types";
import { AVATAR_COLORS, avatarClass } from "../types";
import { LABEL_CHIPS } from "../views";
import { FormSheet, Group, Row, FieldRow, MenuRow, TextRow, Strip, DeleteRow, ErrorLine } from "../../shared/FormSheet";
import HeadMenu from "../../shared/HeadMenu";
import { User, Tag, PenLine } from "../../shared/icons";
import { PeopleGlyph, EnvelopeGlyph, GiftGlyph, PhoneGlyph } from "../../shared/glyphs";
import { pressable } from "../../shared/pressable";

export interface SheetCategoryOpt { id: string; name: string; color: ColorSlot }

export interface PersonDraft {
  name: string;
  /** The other names you call them, one per line as typed. "Mom" for Linda
   *  Fisher: one person, not a second contact. */
  aliases: string[];
  relationship: string;
  /** Who they are in a given area, for the people who wear two hats. Keyed by
   *  area id, and only for areas they are actually in. */
  roles: { categoryId: string; role: string }[];
  birthday: string;
  notes: string;
  color: ColorSlot;
  // Person pass (2026-08-03)
  email: string;
  phone: string;
  register?: "casual" | "professional" | "friend";
  categoryIds: string[];
}

type Register = NonNullable<PersonDraft["register"]>;
// Register, deliberately NOT closeness: nobody taps "Not really" about
// their mother. Unset = unknown = clean prose. Ordered as a looseness
// scale; "Close Friend" (not "Friend") so the option never shares its
// exact title with the label chip above.
const REGISTERS: { value: Register | ""; label: string }[] = [
  { value: "", label: "Not Set" },
  { value: "friend", label: "Close Friend" },
  { value: "casual", label: "Casual" },
  { value: "professional", label: "Professional" },
];

// THE PERSON SHEET ON THE SHEET BAR (2026-09-02, the last form sheets): the
// name as the row; who they are as the chip strip (chips first, typing
// second: the label field existed for months and stayed empty because it
// was a blank box) with the free line under it; how JARVIS writes to them
// as a menu; email and phone typed at the right; the areas as the multi
// menu; the colour as a strip of swatches; birthday and notes last.
export default function PersonSheet({
  mode,
  initial,
  categories = [],
  onSave,
  onDelete,
  onCancel,
}: {
  mode: "new" | "edit";
  initial?: PersonData;
  categories?: SheetCategoryOpt[];
  // BRAIN-F-09 (2026-09-05): a parent that writes hands back whether the
  // write landed, so the Saving latch below can let go when it did not.
  onSave: (draft: PersonDraft) => void | Promise<boolean | void>;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  // Typed as one line per name, which is the only shape that works on a phone
  // without a chip editor. Stored as a list.
  const [aliasText, setAliasText] = useState((initial?.aliases ?? []).join(", "));
  const [relationship, setRelationship] = useState(initial?.relationship ?? "");
  const [roles, setRoles] = useState<Record<string, string>>(
    Object.fromEntries((initial?.roles ?? []).map((r) => [r.categoryId, r.role])),
  );
  const [birthday, setBirthday] = useState(initial?.birthday ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [color, setColor] = useState<ColorSlot>(initial?.color ?? "red");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [register, setRegister] = useState<Register | undefined>(initial?.register);
  const [categoryIds, setCategoryIds] = useState<string[]>(initial?.categoryIds ?? []);
  const [touched, setTouched] = useState(false);
  // B12's fix (MoneyFlow's Account/Payday sheets), generalized: Save creates
  // a person, so two taps created two. The first valid tap latches.
  const [saving, setSaving] = useState(false);

  // MULTI-select on purpose: a person can be Family AND Bridge. Single-tag
  // here would rebuild the exclusive-bucket mistake one layer down.
  const toggleCategory = (id: string) =>
    setCategoryIds((cur) => (id === "" ? [] : cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id]));
  const areaNames = categoryIds.map((id) => categories.find((c) => c.id === id)?.name).filter((n): n is string => !!n);
  const areaWord = areaNames.length === 0 ? "None" : areaNames.length === 1 ? areaNames[0]! : `${areaNames[0]} +${areaNames.length - 1}`;

  const valid = name.trim().length > 0;
  const save = () => {
    if (!valid) { setTouched(true); return; }
    if (saving) return;
    setSaving(true);
    // BRAIN-F-09 (2026-09-05): offline, the latch used to hold forever: the
    // button read "Saving" with no toast and no way out but Cancel, which
    // threw the edit away. A save that comes back false (or throws on the
    // way) unlatches, so the sheet is usable again with the typing intact.
    const r = onSave({
      name: name.trim(),
      aliases: aliasText.split(/[,\n]/).map((a) => a.trim()).filter(Boolean),
      relationship: relationship.trim(),
      // Only for areas they are actually in: a role left behind by an area
      // that was unticked is not a fact about them any more.
      roles: categoryIds
        .map((id) => ({ categoryId: id, role: (roles[id] ?? "").trim() }))
        .filter((r) => r.role !== ""),
      birthday: birthday.trim(),
      notes: notes.trim(),
      color,
      email: email.trim(),
      phone: phone.trim(),
      register,
      categoryIds,
    });
    void Promise.resolve(r).then((ok) => { if (ok === false) setSaving(false); }, () => setSaving(false));
  };

  return (
    <FormSheet title={mode === "new" ? "New Person" : "Edit Person"} onCancel={onCancel} onSave={save} saveDisabled={!valid} saveLabel={saving ? "Saving" : "Save"}>
      <Group label="Person">
        <FieldRow tone="pink" glyph={<User className="ic" />} value={name} onChange={setName} placeholder="Full Name" ariaLabel="Name"
          error={touched && !valid} right={false} />
        {/* ONE PERSON, EVERY NAME YOU CALL THEM. Search and the mention
            matcher read these, so "call Mom" finds Linda Fisher without a
            second contact for her existing. */}
        <FieldRow tone="purple" glyph={<PeopleGlyph />} label="Also Called" value={aliasText} onChange={setAliasText}
          placeholder="Mom, Linda" ariaLabel="Other names for this person" />
      </Group>
      <ErrorLine text={touched && !valid ? "Add a name." : null} />
      <Group label="Who They Are to You">
        <Strip>
          {LABEL_CHIPS.map((l) => (
            <div {...pressable(() => setRelationship(relationship === l ? "" : l))} key={l} className={"chip" + (relationship === l ? " active" : "")} aria-pressed={relationship === l}
>{l}</div>
          ))}
        </Strip>
        <FieldRow tone="purple" glyph={<PeopleGlyph />} value={(LABEL_CHIPS as readonly string[]).includes(relationship) ? "" : relationship}
          onChange={setRelationship} placeholder="Or Say It Your Way" ariaLabel="Who they are to you" right={false} />
        <MenuRow tone="indigo" glyph={<PenLine className="ic" />} label="JARVIS Writes" value={register ?? ""} ariaLabel="How JARVIS writes to them"
          off={!register} options={REGISTERS} onPick={(v) => setRegister(v === "" ? undefined : (v as Register))} />
      </Group>
      <Group label="Contact">
        <FieldRow tone="blue" glyph={<EnvelopeGlyph />} label="Email" type="email" value={email} onChange={setEmail} placeholder="Optional" ariaLabel="Email" />
        <FieldRow tone="green" glyph={<PhoneGlyph />} label="Phone" type="tel" value={phone} onChange={setPhone} placeholder="Optional" ariaLabel="Phone" />
      </Group>
      {categories.length > 0 && (
        <Group label="Part Of">
          <Row tone="sky" glyph={<Tag className="ic" />} label="Areas">
            <HeadMenu variant="value" ariaLabel="Areas" value={categoryIds[0] ?? ""} label={areaWord} off={categoryIds.length === 0} multi picked={categoryIds}
              options={[{ value: "", label: "None" }, ...categories.map((c) => ({ value: c.id, label: c.name, dot: c.color as string }))]}
              onPick={toggleCategory} />
          </Row>
          {/* A ROLE PER AREA, and only for the areas they are in (People
              handoff, 2026-09-16: "Mother belongs to Family context; Board
              secretary belongs to Bridge context"). One label for the whole
              person could not hold both, and picking one of them to be THE
              answer is how a professional draft ends up carrying family
              words. Blank is the normal case and says nothing. */}
          {categoryIds.map((id) => {
            const cat = categories.find((c) => c.id === id);
            if (!cat) return null;
            return (
              <FieldRow key={id} tone={cat.color} glyph={<Tag className="ic" />} label={cat.name}
                value={roles[id] ?? ""} onChange={(v) => setRoles((r) => ({ ...r, [id]: v }))}
                placeholder="Their Role Here" ariaLabel={"Role in " + cat.name} />
            );
          })}
        </Group>
      )}
      <Group label="Color">
        <Strip plain>
          <div className="swatch-row">
            {AVATAR_COLORS.map((sl) => (
              <button key={sl} type="button" aria-label={sl} aria-pressed={color === sl} className={"av-swatch " + avatarClass(sl) + (color === sl ? " sel" : "")} onClick={() => setColor(sl)} />
            ))}
          </div>
        </Strip>
      </Group>
      <Group label="More">
        <FieldRow tone="orange" glyph={<GiftGlyph />} label="Birthday" value={birthday} onChange={setBirthday} placeholder="e.g. March 4" ariaLabel="Birthday" />
        <TextRow value={notes} onChange={setNotes} placeholder="What JARVIS Should Remember" ariaLabel="Notes" />
      </Group>
      {mode === "edit" && onDelete && (
        <Group className="xs-actions"><DeleteRow label="Delete Person" onClick={onDelete} /></Group>
      )}
    </FormSheet>
  );
}
