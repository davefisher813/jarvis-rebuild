import { useEffect, useRef, useState } from "react";
import { useBrainDocs } from "../../data/NotesProvider";
import { docMeta } from "./types";
import { useAI } from "../../ai/useAI";
import { buildVisionMessage } from "../../ai/AIService";
import { JARVIS_VOICE } from "../../ai/voice";
import { fileToAIImage } from "../../shared/imageInput";
import { showToast } from "../../shared/toast";

const PHOTO = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
);

// What JARVIS should pull from a photo, per doc. Falls back to a generic read.
const PHOTO_TASK: Record<string, string> = {
  writing: "The image is something the user wrote (texts, an email, a post). Study HOW they write: tone, sentence length, greetings or the lack of them, punctuation habits, words they favor. Reply with 3 to 6 short plain lines describing their style, each on its own line, no bullets or numbering, no preamble. These lines go straight into the user's own style notes.",
  values: "The image relates to what matters to this user. Reply with 2 to 4 short plain lines capturing the values it reveals, each on its own line, no preamble.",
  philosophy: "The image relates to how this user thinks about life or work. Reply with 2 to 4 short plain lines capturing the outlook it shows, each on its own line, no preamble.",
};

export default function BrainDocPage({ topic, onBack }: { topic: string; onBack: () => void }) {
  const docs = useBrainDocs();
  const ai = useAI();
  const meta = docMeta(topic);
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let on = true;
    docs.get(topic).then((t) => { if (on) { setText(t); setLoaded(true); } });
    return () => { on = false; };
  }, [docs, topic]);

  // Failed saves surface instead of dying silently (audit 2026-07-30).
  const save = async () => {
    try {
      await docs.save(topic, text.trim());
      setDirty(false);
      setSaved(true);
    } catch {
      showToast({ message: "Couldn't save. Check your connection and try again." });
    }
  };

  // Photo-to-doc (Dave 2026-07-30): pick a photo, JARVIS reads it and appends
  // what it learned as editable text. The user reviews, then taps Save; the AI
  // never writes to storage directly.
  const onPhoto = async (file: File) => {
    setReading(true);
    try {
      const img = await fileToAIImage(file);
      const task = PHOTO_TASK[topic] ?? `The image is something the user added to their "${meta?.title ?? topic}" notes. Reply with 2 to 4 short plain lines capturing what it should add to those notes, each on its own line, no preamble.`;
      const out = await ai.complete([buildVisionMessage(task, img.data, img.mediaType)], JARVIS_VOICE);
      const clean = out.trim();
      if (!clean) throw new Error("empty");
      setText((t) => (t.trim() ? t.replace(/\s+$/, "") + "\n" + clean : clean));
      setDirty(true);
      setSaved(false);
    } catch {
      showToast({ message: "Couldn't read that photo. Try a clearer one." });
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">{meta?.title ?? "Note"}</div>
        <button className="nav-action-text" onClick={save} disabled={!dirty}>{loaded && !dirty ? "Saved" : "Save"}</button>
      </div>
      <div className="pad-x sheet-form">
        <textarea
          className="input input-doc"
          placeholder={meta?.placeholder}
          value={text}
          onChange={(e) => { setText(e.target.value); setDirty(true); setSaved(false); }}
          disabled={!loaded}
        />
        {ai.available && (
          <>
            <input
              ref={fileRef}
              className="visually-hidden-input"
              type="file"
              accept="image/*"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPhoto(f); e.target.value = ""; }}
            />
            <div className="card">
              <div className="row" role="button" tabIndex={0} onClick={() => !reading && fileRef.current?.click()}>
                <div className="sec-ico ico-blue">{PHOTO}</div>
                <div className="row-grow">
                  <div className="conn-name">{reading ? "Reading your photo..." : "Add a Photo"}</div>
                  <div className="conn-meta">{reading ? "A few seconds." : "JARVIS reads it and adds what it learns here."}</div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
