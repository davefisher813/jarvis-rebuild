import { useEffect, useState } from "react";
import { useProfile } from "../data/NotesProvider";
import type { TemplateKey } from "../categories/defaults";
import LargeTitleNav from "../shared/LargeTitleNav";
import { Head, Card, Row } from "./kit";

const LABEL: Record<TemplateKey, string> = { personal: "Personal", business: "Business", student: "Student" };

// The name is typed at the right of its label, the template is a fact, and
// Save is the row the card ends on, lit only when there is something to save.
export default function ProfilePage({ onBack }: { onBack: () => void }) {
  const profile = useProfile();
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
        <Row label="Template" value={LABEL[template]} />
        <button type="button" className="row row-act" onClick={() => void save()} disabled={!name.trim() || saved}>{saved ? "Saved" : "Save"}</button>
      </Card>
      <div className="screen-foot" />
    </div>
  );
}
