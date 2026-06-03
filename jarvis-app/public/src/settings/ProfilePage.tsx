import { useEffect, useState } from "react";
import { useProfile } from "../data/NotesProvider";
import type { TemplateKey } from "../categories/defaults";
import LargeTitleNav from "../shared/LargeTitleNav";

const BACK = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
);
const LABEL: Record<TemplateKey, string> = { personal: "Personal", business: "Business", student: "Student" };

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
    <div className="screen">
      <LargeTitleNav title="Profile" back="Account" onBack={onBack} />
      <div className="pad-x sheet-form">
        <div className="field">
          <div className="input-label">Name</div>
          <input className="input" value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} placeholder="Your name" />
        </div>
        <div className="field">
          <div className="input-label">Template</div>
          <div className="input input-static">{LABEL[template]}</div>
        </div>
        <button className="btn btn-primary btn-block" onClick={save} disabled={!name.trim()}>{saved ? "Saved" : "Save"}</button>
      </div>
    </div>
  );
}
