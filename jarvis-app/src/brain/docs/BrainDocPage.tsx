import { useEffect, useState } from "react";
import { useBrainDocs } from "../../data/NotesProvider";
import { docMeta } from "./types";

const BACK = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
);

export default function BrainDocPage({ topic, onBack }: { topic: string; onBack: () => void }) {
  const docs = useBrainDocs();
  const meta = docMeta(topic);
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let on = true;
    docs.get(topic).then((t) => { if (on) { setText(t); setLoaded(true); } });
    return () => { on = false; };
  }, [docs, topic]);

  const save = async () => {
    await docs.save(topic, text.trim());
    setDirty(false);
    setSaved(true);
  };

  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">{meta?.title ?? "Note"}</div>
        <button className="nav-action-text" onClick={save} disabled={!dirty}>{saved && !dirty ? "Saved" : "Save"}</button>
      </div>
      <div className="pad-x sheet-form">
        <textarea
          className="input input-doc"
          placeholder={meta?.placeholder}
          value={text}
          onChange={(e) => { setText(e.target.value); setDirty(true); setSaved(false); }}
          disabled={!loaded}
        />
      </div>
    </div>
  );
}
