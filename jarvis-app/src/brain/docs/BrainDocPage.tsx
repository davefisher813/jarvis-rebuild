import { useEffect, useRef, useState } from "react";
import { useBrainDocs } from "../../data/NotesProvider";
import { docMeta } from "./types";
import { useAI } from "../../ai/useAI";
import { buildVisionMessage } from "../../ai/AIService";
import { JARVIS_VOICE } from "../../ai/voice";
import { encodeImageForVision } from "../../shared/imageEncode";
import { showToast } from "../../shared/toast";
import PageHeader from "../../shared/PageHeader";
import { pressable, onPressKey } from "../../shared/pressable";
import { cleanHardLines, HARD_LINE_LABEL, HARD_LINE_PROMISE, MAX_HARD_LINES, type HardLine, type HardLineKind } from "../hardLines";

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
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // BRAIN-F-12 (2026-09-05): with no catch, one failed read left `loaded`
  // false forever: the writing surface stayed greyed out with nothing said
  // and no way to ask again short of leaving the tab. It says so now, and
  // Try Again re-runs this effect.
  // UP-MIND-20 (2026-09-05): the Values doc's hard lines, edited as chips
  // beside the prose. Values only: the other two docs shape how JARVIS
  // writes, and neither of them stops the app doing anything.
  const isValues = topic === "values";
  const [lines, setLines] = useState<HardLine[]>([]);
  const [lineKind, setLineKind] = useState<HardLineKind>("never_file");
  const [lineText, setLineText] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let on = true;
    setLoadFailed(false);
    docs.get(topic)
      .then(async (t) => {
        const hl = isValues ? await docs.hardLines(topic).catch(() => []) : [];
        if (on) { setText(t); setLines(hl); setLoaded(true); }
      })
      .catch(() => { if (!on) return; setLoadFailed(true); showToast({ message: "Couldn't load · Check your connection" }); });
    return () => { on = false; };
  }, [docs, topic, attempt]);

  // Failed saves surface instead of dying silently (audit 2026-07-30).
  const save = async () => {
    try {
      await docs.save(topic, text.trim(), isValues ? lines : undefined);
      setDirty(false);
    } catch {
      showToast({ message: "Couldn't save · Check your connection" });
    }
  };

  // Photo-to-doc (Dave 2026-07-30): pick a photo, JARVIS reads it and appends
  // what it learned as editable text. The user reviews, then taps Save; the AI
  // never writes to storage directly.
  const onPhoto = async (file: File) => {
    setReading(true);
    try {
      // SHARED-F-23 (2026-09-05): this used to call fileToAIImage, the older
      // single-guess encoder, whose header claimed the proxy allows ~340KB
      // when api/ai.ts:62 caps a vision request at 600,000 bytes. One guess
      // at 896px/q0.72 is not checked against any cap, which is the silent
      // 413 imageEncode.ts was written to end. One encoder now, and it
      // verifies its own output before handing it over.
      const img = await encodeImageForVision(file);
      const task = PHOTO_TASK[topic] ?? `The image is something the user added to their "${meta?.title ?? topic}" notes. Reply with 2 to 4 short plain lines capturing what it should add to those notes, each on its own line, no preamble.`;
      const out = await ai.complete([buildVisionMessage(task, img.data, img.mediaType)], JARVIS_VOICE);
      const clean = out.trim();
      if (!clean) throw new Error("empty");
      setText((t) => (t.trim() ? t.replace(/\s+$/, "") + "\n" + clean : clean));
      setDirty(true);
    } catch {
      showToast({ message: "Couldn't read that photo · Try clearer" });
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="screen ruled">
      <PageHeader
        title={meta?.title ?? "Note"}
        back="Brain"
        onBack={onBack}
        actions={<button className="nav-action-text" onClick={save} disabled={!dirty}>{loaded && !dirty ? "Saved" : "Save"}</button>}
      />
      {/* Deep writing pass (2026-08-19): brain docs write on the notes
          canvas, not in a boxed form field. Same typography, same caret. */}
      <div className="pad-x sheet-form">
        {loadFailed && !loaded && (
          <div className="card list-card-ruled">
            <button className="row row-act" onClick={() => setAttempt((n) => n + 1)}>Try Again</button>
          </div>
        )}
        <textarea
          className="doc-textarea"
          placeholder={meta?.placeholder}
          value={text}
          onChange={(e) => { setText(e.target.value); setDirty(true); }}
          disabled={!loaded}
        />
        {/* UP-MIND-20: the hard lines. Typed by the user, on their own
            page, and nowhere else: the app never writes a Value. Each chip
            says exactly what it will stop, because a rule that stops an
            automatic action has to be readable at a glance. */}
        {isValues && loaded && (
          <div className="card list-card-ruled">
            <div className="sh2 sh2-quiet"><span className="t">Hard Lines</span>{lines.length > 0 && <span className="n">{lines.length}</span>}</div>
            {lines.length === 0 && (
              <div className="pad-x"><div className="conn-meta">Nothing is off limits to the automation yet.</div></div>
            )}
            {lines.map((l, i) => (
              <div className="row" key={l.kind + l.match}>
                <div className="row-grow">
                  <div className="conn-name">{HARD_LINE_LABEL[l.kind]} · {l.match}</div>
                  <div className="conn-meta">{HARD_LINE_PROMISE[l.kind]}</div>
                </div>
                <button className="quiet-action" onClick={() => { setLines(lines.filter((_, j) => j !== i)); setDirty(true); }}>Remove</button>
              </div>
            ))}
            {lines.length < MAX_HARD_LINES && (
              <div className="pad-x sheet-form">
                <div className="chip-row">
                  {(Object.keys(HARD_LINE_LABEL) as HardLineKind[]).map((k) => (
                    <div key={k} className={"chip" + (lineKind === k ? " active" : "")} role="radio" aria-checked={lineKind === k} tabIndex={0} onClick={() => setLineKind(k)} onKeyDown={onPressKey(() => setLineKind(k))}>{HARD_LINE_LABEL[k]}</div>
                  ))}
                </div>
                <input
                  className="input"
                  placeholder="Who or what · school.org, Family, Gym"
                  value={lineText}
                  onChange={(e) => setLineText(e.target.value)}
                  aria-label="What this line is about"
                />
                <button
                  className="btn btn-secondary btn-block"
                  disabled={!lineText.trim()}
                  onClick={() => {
                    setLines(cleanHardLines([...lines, { kind: lineKind, match: lineText.trim() }]));
                    setLineText("");
                    setDirty(true);
                  }}
                >Add a Line</button>
              </div>
            )}
          </div>
        )}
        {ai.available && (
          <>
            <input
              ref={fileRef}
              className="visually-hidden-input"
              type="file"
              accept="image/*"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPhoto(f); e.target.value = ""; }}
            />
            <div className="card list-card-ruled">
              <div {...pressable(() => !reading && fileRef.current?.click())} className="row">
                <div className="sec-ico ico-blue">{PHOTO}</div>
                <div className="row-grow">
                  <div className="conn-name">{reading ? "Reading your photo..." : "Add a Photo"}</div>
                  {/* ONE FACT, NOT TWO (Dave 2026-09-03, pic 2). "JARVIS
                      reads it · Learns from it" was a two-token
                      concatenation under a title, which the subtext law
                      forbids outright, and the capital L mid-line was the
                      casing it made him look at. One sentence says both. */}
                  <div className="conn-meta">{reading ? "A few seconds." : "JARVIS reads it and learns from it"}</div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
