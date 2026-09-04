import { useEffect, useState } from "react";
import { useProfile, useCategories } from "../data/NotesProvider";
import type { TemplateKey } from "../categories/defaults";
import LargeTitleNav from "../shared/LargeTitleNav";
import { Head, Card, Menu } from "./kit";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";

const LABEL: Record<TemplateKey, string> = { personal: "Personal", business: "Business", student: "Student" };
const TEMPLATE_OPTIONS = [
  { value: "personal", label: "Personal" },
  { value: "business", label: "Business" },
  { value: "student", label: "Student" },
];

// The name is typed at the right of its label, the template is a fact, and
// Save is the row the card ends on, lit only when there is something to save.
export default function ProfilePage({ onBack }: { onBack: () => void }) {
  const profile = useProfile();
  const categories = useCategories();
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<TemplateKey>("personal");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let on = true;
    profile.get().then((p) => {
      if (!on || !p) return;
      setName(p.name);
      setTemplate(p.template);
    });
    return () => { on = false; };
  }, [profile]);
  const save = async () => {
    await profile.save({ name: name.trim() });
    setSaved(true);
  };
  // S3-Q20 (2026-09-04): Template was a dead read-only row, so the only way
  // to change Personal/Business/Student was Redo Setup -- the full ~15-tap
  // intake, just to flip one choice. This picker saves it the moment it's
  // picked (independent of the Name Save row below) and offers the new
  // template's starter areas the same way onboarding would have seeded
  // them: seedDefaults only ever adds when the account has no categories
  // yet, so an established user's own areas are never touched or
  // duplicated, and the toast says exactly what happened either way.
  const pickTemplate = async (t: TemplateKey) => {
    if (t === template) return;
    const prev = template;
    setTemplate(t);
    const ok = await attemptWrite(async () => {
      await profile.save({ template: t });
      const before = (await categories.list()).length;
      const after = (await categories.seedDefaults(t)).length;
      const added = after - before;
      showToast({
        message: added > 0
          ? `Switched to ${LABEL[t]} · Added ${added} starter ${added === 1 ? "area" : "areas"}`
          : `Switched to ${LABEL[t]}`,
      });
    });
    if (!ok) setTemplate(prev);
  };
  return (
    <div className="screen ruled">
      <LargeTitleNav title="Profile" back="Account" onBack={onBack} />
      <Head label="You" />
      <Card>
        <div className="row set-row">
          <div className="conn-name">Name</div>
          <input className="set-field" aria-label="Name" placeholder="Your Name" value={name}
            onChange={(e) => { setName(e.target.value); setSaved(false); }} />
        </div>
        <Menu label="Template" value={template} options={TEMPLATE_OPTIONS} onPick={(v) => void pickTemplate(v as TemplateKey)} />
        <button type="button" className="row row-act" onClick={() => void save()} disabled={!name.trim() || saved}>{saved ? "Saved" : "Save"}</button>
      </Card>
      <div className="screen-foot" />
    </div>
  );
}
