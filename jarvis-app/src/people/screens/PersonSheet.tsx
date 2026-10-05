import { useState } from "react";
import type { PersonData } from "../types";
import type { ColorSlot } from "../../categories/types";
import { AVATAR_COLORS } from "../types";
import { LABEL_CHIPS } from "../views";
import { FormSheet, Group, Row, FieldRow, MenuRow, TextRow, Strip, DeleteRow, ErrorLine } from "../../shared/FormSheet";
import HeadMenu from "../../shared/HeadMenu";
import { User, Tag, PenLine, Check } from "../../shared/icons";
import { PeopleGlyph, EnvelopeGlyph, GiftGlyph, PhoneGlyph } from "../../shared/glyphs";

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
  // A label that is not one of the seven is the person's own words ("Attorney"), which the menu's last option opens a field for.
  const [ownWords, setOwnWords] = useState(!!initial?.relationship && !(LABEL_CHIPS as readonly string[]).includes(initial.relationship));
  const [roles, setRoles] = useState<Record<string, string>>(
    // The roles key is shared with Brain triage (string entries): the sheet
    // edits the per-area roles only, so the triage strings are filtered out
    // here and preserved on save in PeopleFlow.
    Object.fromEntries(
      (initial?.roles ?? [])
        .filter((r): r is { categoryId: string; role: string } => typeof r !== "string")
        .map((r) => [r.categoryId, r.role]),
    ),
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
        {/* EVERY ROW HAS ITS LABEL (Dave 2026-10-05, the review: the name was a bare value in regular weight under a bold
            "Also Called"). */}
        <FieldRow tone="pink" glyph={<User className="ic" />} label="Name" value={name} onChange={setName} placeholder="Full Name" ariaLabel="Name"
          error={touched && !valid} />
        {/* ONE PERSON, EVERY NAME YOU CALL THEM. Search and the mention
            matcher read these, so "call Mom" finds Linda Fisher without a
            second contact for her existing. The example said "Mom, Linda" under every contact, an invitation to a nonsense
            alias, so the placeholder says what the field takes (several are separated by commas as they are typed). */}
        <FieldRow tone="purple" glyph={<PeopleGlyph />} label="Also Called" value={aliasText} onChange={setAliasText}
          placeholder="Nicknames" ariaLabel="Other names for this person" />
      </Group>
      <ErrorLine text={touched && !valid ? "Add a name." : null} />
      <Group label="Who They Are to You">
        {/* ONE ROW, NOT A PILE OF CHIPS (Dave 2026-10-05, the review: seven chips wrapped into three ragged lines over a bare
            value row). The seven labels and the person's own words are one menu; the own-words field appears when it is
            chosen, labelled like every other row. */}
        <MenuRow tone="purple" glyph={<PeopleGlyph />} label="Relationship" value={ownWords ? "own" : relationship} ariaLabel="Who they are to you"
          off={!relationship && !ownWords} word={ownWords ? "Your Own Words" : undefined}
          options={[{ value: "", label: "Not Set" }, ...LABEL_CHIPS.map((l) => ({ value: l, label: l })), { value: "own", label: "Your Own Words" }]}
          onPick={(v) => {
            if (v === "own") { setOwnWords(true); if ((LABEL_CHIPS as readonly string[]).includes(relationship)) setRelationship(""); return; }
            setOwnWords(false); setRelationship(v);
          }} />
        {ownWords && (
          <FieldRow tone="purple" glyph={<PeopleGlyph />} label="In Your Words" value={relationship} onChange={setRelationship} placeholder="Attorney, Neighbour, Mentor" ariaLabel="Who they are to you, in your words" />
        )}
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
      <Group label="Notes">
        <TextRow value={notes} onChange={setNotes} placeholder="What JARVIS Should Remember" ariaLabel="Notes" />
      </Group>
      {/* THE FORM IS SHORTER THAN ITS SCROLL (Dave 2026-10-05, the review: four groups before the colour and Save two screens
          down). The colour and the birthday are the two things most people never change, so they sit behind one disclosure. */}
      <details className="exp-more xs-more" open={!!birthday || (color !== "red")}>
        <summary>More Details</summary>
        <Group label="Color">
          <Strip plain>
            {/* THE PICKED COLOUR IS RINGED IN INK, WITH A CHECK, on a 44px reach, in a grid of six by four (Dave 2026-10-05, the
                review: 34px swatches with no selected state and two stragglers on a fourth row). The first swatch is no colour
                at all: the warm neutral every new person starts as, which no swatch drew before, so nothing looked picked. */}
            <div className="swatch-grid">
              <button type="button" className={"swatch swatch-none" + (color === "red" ? " sel" : "")} aria-label="No Color" aria-pressed={color === "red"} onClick={() => setColor("red")}>
                {color === "red" && <Check className="ic" aria-hidden="true" />}
              </button>
              {AVATAR_COLORS.map((sl) => (
                <button key={sl} type="button" aria-label={sl} aria-pressed={color === sl} className={"swatch cat-bg-" + sl + (color === sl ? " sel" : "")} onClick={() => setColor(sl)}>
                  {color === sl && <Check className="ic" aria-hidden="true" />}
                </button>
              ))}
            </div>
          </Strip>
        </Group>
        <Group label="Birthday">
          <FieldRow tone="orange" glyph={<GiftGlyph />} label="Birthday" value={birthday} onChange={setBirthday} placeholder="e.g. March 4" ariaLabel="Birthday" />
        </Group>
      </details>
      {mode === "edit" && onDelete && (
        <Group className="xs-actions"><DeleteRow label="Delete Person" onClick={onDelete} /></Group>
      )}
    </FormSheet>
  );
}
