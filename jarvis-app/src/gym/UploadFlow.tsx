import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AIService } from "../ai/AIService";
import { buildVisionMessage } from "../ai/AIService";
import { EXTRACT_PROMPT, parseProgramExtract } from "./extract";
import { targetLine } from "./measures";
import { MEASURE_LABEL, type ProgramData, type Exercise } from "./types";
import ExerciseSheet from "./ExerciseSheet";
import { showToast } from "../shared/toast";

const CHEV = (
  <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
);

// Downscale a photo before it travels: a 12MP screenshot of a coach's
// spreadsheet does not need 12MP to be read, and the proxy bounds image size.
async function toJpegBase64(file: File, maxDim = 1568): Promise<{ data: string; mediaType: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("unreadable image"));
      i.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return { data: dataUrl.split(",")[1]!, mediaType: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Upload a program (gym session 2). Photo/screenshot or pasted text -> the
// model extracts -> the user REVIEWS every piece before anything commits.
// The raw file is never retained: it is read, sent once, and dropped.
export default function UploadFlow({ ai, onSave, onCancel }: {
  ai: AIService;
  onSave: (p: ProgramData) => void;
  onCancel: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<ProgramData | null>(null);
  const [fix, setFix] = useState<{ dayIdx: number; exIdx: number } | null>(null);

  const extract = async (message: Parameters<AIService["complete"]>[0][number]) => {
    setBusy(true);
    try {
      const out = await ai.complete([message]);
      const parsed = parseProgramExtract(out);
      if (!parsed) {
        showToast({ message: "Couldn't read a program out of that. Try a clearer photo or paste the text." });
        return;
      }
      setDraft(parsed);
    } catch {
      showToast({ message: "Couldn't reach JARVIS. Try again in a bit." });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File) => {
    try {
      const img = await toJpegBase64(file);
      await extract(buildVisionMessage(EXTRACT_PROMPT, img.data, img.mediaType));
    } catch {
      showToast({ message: "Couldn't read that image." });
    }
  };

  // ---- review ----
  if (draft) {
    const fixing: Exercise | null = fix ? draft.days[fix.dayIdx]?.exercises[fix.exIdx] ?? null : null;
    return (
      <>
        <div className="screen">
          <div className="nav-bar">
            <button className="nav-back" aria-label="Back" onClick={() => setDraft(null)}></button>
            <div className="nav-title truncate">{draft.name}</div>
          </div>
          {/* Derived and conditional: this line changes what the user does
              (check before saving), so it earns its place. */}
          <div className="pad-x"><div className="card pad">
            <div className="conn-name">Here&rsquo;s what I read. Tap anything to fix it.</div>
          </div></div>
          {draft.days.map((day, di) => (
            <div key={day.id}>
              <div className="sec-head"><div className="sec-left"><div className="sec-title">{day.name}</div></div></div>
              <div className="pad-x"><div className="card">
                {day.exercises.map((e, ei) => (
                  <div className="row" role="button" tabIndex={0} key={e.id} onClick={() => setFix({ dayIdx: di, exIdx: ei })}>
                    <div className="row-grow">
                      <div className="conn-name truncate">{e.name}</div>
                      <div className="eyebrow">{targetLine(e)} · {MEASURE_LABEL[e.kind]}</div>
                    </div>
                    {CHEV}
                  </div>
                ))}
              </div></div>
            </div>
          ))}
          <div className="pad-x sheet-actions">
            <button className="btn btn-primary btn-block" onClick={() => onSave(draft)}>Looks Right, Save It</button>
            <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
          </div>
          <div className="screen-foot" />
        </div>
        {fixing && fix && (
          <ExerciseSheet
            mode="edit"
            initial={fixing}
            onSave={(d) => {
              setDraft({
                ...draft,
                days: draft.days.map((day, di) => (di === fix.dayIdx
                  ? { ...day, exercises: day.exercises.map((e, ei) => (ei === fix.exIdx ? { ...d, id: e.id } : e)) }
                  : day)),
              });
              setFix(null);
            }}
            onDelete={() => {
              setDraft({
                ...draft,
                days: draft.days
                  .map((day, di) => (di === fix.dayIdx ? { ...day, exercises: day.exercises.filter((_, ei) => ei !== fix.exIdx) } : day))
                  .filter((day) => day.exercises.length > 0),
              });
              setFix(null);
            }}
            onCancel={() => setFix(null)}
          />
        )}
      </>
    );
  }

  // ---- source pick ----
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Upload a Program</div></div>
        <div className="pad-x sheet-form">
          <input ref={fileRef} className="visually-hidden-input" type="file" accept="image/*"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
          <button className="btn btn-primary btn-block" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "Reading..." : "Photo or Screenshot"}
          </button>
          <div className="field">
            <div className="input-label">Or paste it</div>
            <textarea className="input input-multiline" rows={5} placeholder="Paste the program text from a message or spreadsheet" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <button className="btn btn-secondary btn-block" disabled={busy || !text.trim()}
            onClick={() => void extract({ role: "user", content: EXTRACT_PROMPT + "\n\nCONTENT:\n" + text.trim().slice(0, 12000) })}>
            {busy ? "Reading..." : "Read the Pasted Text"}
          </button>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-tertiary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
