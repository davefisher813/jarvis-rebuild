import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AIService } from "../ai/AIService";
import { buildVisionMessage } from "../ai/AIService";
import { JARVIS_VOICE } from "../ai/voice";
import { encodeImageForVision } from "../shared/imageEncode";
import { showToast } from "../shared/toast";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";
import { capAfterNumber } from "../shared/casing";
import { weekdayShortDate } from "../shared/dateFormat";
import { madeBy } from "../shared/provenance";
import type { TasksService } from "../tasks/TasksService";
import type { ScheduleService } from "../schedule/ScheduleService";
import {
  SYLLABUS_EXTRACT_PROMPT, parseSyllabusExtract, buildSyllabusRows, rowLine,
  type ExtractedSyllabusItem, type SyllabusRow,
} from "./syllabusExtract";

// UPLOAD A SYLLABUS (UP-CORE-12, 2026-09-05).
//
// Photograph a syllabus and the semester's work exists: assignments as tasks
// with due dates, exams and quizzes as events, every row reviewed before
// anything is written. The shape is the schedule upload's, deliberately:
// extract, review, commit, raw file never retained. What is different is that
// this one produces TASKS, which no extractor in the app did.
//
// Nothing is guessed. A row the syllabus gave no date for is flagged and
// imported UNDATED rather than dated plausibly, because an invented deadline
// is worse than none: it is wrong in a way that looks right.
export default function SyllabusUploadFlow({
  ai, tasks, schedule, categoryId, onDone, onCancel,
}: {
  ai: AIService;
  tasks: TasksService;
  schedule: ScheduleService;
  // The area the class lives in, when the caller has one. Empty is legal and
  // lands the work unfiled, which is what every other capture door does.
  categoryId?: string;
  onDone: (r: { taskCount: number; eventCount: number; undo: () => Promise<void> }) => void;
  onCancel: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [thumb, setThumb] = useState<string | null>(null);
  const [needsYear, setNeedsYear] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  const [extracted, setExtracted] = useState<ExtractedSyllabusItem[] | null>(null);
  const [rows, setRows] = useState<SyllabusRow[] | null>(null);
  const [saving, setSaving] = useState(false);

  const afterExtract = (found: ExtractedSyllabusItem[], resolveYear: number) => {
    setExtracted(found);
    // The one question, asked once, for every dated row the source left
    // yearless. A syllabus almost never prints the year.
    if (found.some((e) => e.month !== null && e.year === null)) setNeedsYear(true);
    else setRows(buildSyllabusRows(found, resolveYear));
  };

  const runExtract = async (message: Parameters<AIService["complete"]>[0][number]) => {
    setBusy(true);
    try {
      // Every AI surface carries the voice rules (voice.ts): the titles stay
      // the syllabus's own words, and the model's side of the exchange is
      // governed like everywhere else.
      const out = await ai.complete([message], JARVIS_VOICE);
      const found = parseSyllabusExtract(out);
      if (!found) { showToast({ message: "Couldn't read that · Try a clearer photo" }); return; }
      afterExtract(found, year);
    } catch {
      showToast({ message: "Couldn't reach JARVIS · Try again" });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File) => {
    try {
      const img = await encodeImageForVision(file);
      setThumb(`data:${img.mediaType};base64,${img.data}`);
      await runExtract(buildVisionMessage(SYLLABUS_EXTRACT_PROMPT, img.data, img.mediaType));
    } catch {
      showToast({ message: "Couldn't read that image." });
    }
  };

  const confirmYear = () => {
    if (!extracted) return;
    setNeedsYear(false);
    setRows(buildSyllabusRows(extracted, year));
  };

  const toggleSkip = (i: number) => setRows((cur) => cur && cur.map((r, ri) => (ri === i ? { ...r, skip: !r.skip } : r)));
  // Task or event, per row. The model's read is a default, never a verdict.
  const toggleKind = (i: number) => setRows((cur) => cur && cur.map((r, ri) => (
    ri === i ? { ...r, kind: r.kind === "task" ? ("event" as const) : ("task" as const) } : r)));

  const doImport = async () => {
    if (!rows || saving) return;
    const active = rows.filter((r) => !r.skip);
    if (!active.length) return;
    setSaving(true);
    const madeTasks: string[] = [];
    const madeEvents: string[] = [];
    const landed = new Set<string>();
    let failed = false;
    // Every row carries the same provenance: it came from a file. The file
    // itself is not kept (see syllabusExtract's header), so the line is a
    // fact with nothing to open, which is the honest version of it.
    const source = madeBy("file");
    try {
      for (const r of active) {
        if (r.kind === "event") {
          // An exam with no date cannot be an event: an event IS a date. It
          // lands as a task, which is the shape that can hold "no date yet",
          // and the review already said the date was missing.
          if (r.noDate) {
            const id = await tasks.createTask(r.title, { category: categoryId || undefined, due: null, source });
            if (id) madeTasks.push(id);
          } else {
            const id = await schedule.createEvent(r.title, {
              date: r.date,
              start: r.start || "09:00",
              category: categoryId || undefined,
              source,
            });
            if (id) madeEvents.push(id);
          }
        } else {
          const id = await tasks.createTask(r.title, { category: categoryId || undefined, due: r.date || null, source });
          if (id) madeTasks.push(id);
        }
        landed.add(r.key);
      }
    } catch {
      failed = true;
    } finally {
      setSaving(false);
    }
    const undo = async () => {
      for (const id of madeTasks) await tasks.deleteTask(id);
      for (const id of madeEvents) await schedule.deleteEvent(id);
    };
    if (failed) {
      const done = madeTasks.length + madeEvents.length;
      // What landed is marked done, so the review stays open on what is left
      // and a retry cannot write any row twice.
      if (done > 0) setRows((cur) => cur && cur.map((r) => (landed.has(r.key) ? { ...r, skip: true } : r)));
      showToast(done > 0
        ? { message: capAfterNumber(`Couldn't add them all · ${done} added before it stopped`), actionLabel: "Undo", onAction: () => { void undo(); } }
        : { message: WRITE_FAILED_MESSAGE });
      return;
    }
    onDone({ taskCount: madeTasks.length, eventCount: madeEvents.length, undo });
  };

  // ---- the year: one question, asked once ----
  if (needsYear) {
    return createPortal(
      <div className="sheet-scrim" onClick={onCancel}>
        <div className="card" onClick={(e) => e.stopPropagation()}>
          <div className="sheet-handle" />
          <div className="grp"><div className="eyebrow">What Year Is This?</div></div>
          <div className="pad-x sheet-form">
            <div className="field"><div className="t-body">Syllabus didn&rsquo;t say · Applies to dated rows</div></div>
            <div className="field">
              <label className="input-label">Year</label>
              <input type="number" className="input" value={year} onChange={(e) => setYear(Number(e.target.value) || year)} />
            </div>
          </div>
          <div className="pad-x sheet-actions">
            <button className="btn btn-primary btn-block" onClick={confirmYear}>Use This Year</button>
            <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // ---- review: nothing has saved yet ----
  if (rows) {
    const active = rows.filter((r) => !r.skip).length;
    const undated = rows.filter((r) => !r.skip && r.noDate).length;
    return (
      <div className="screen ruled">
        <div className="nav-bar">
          <button className="nav-back" aria-label="Back" onClick={onCancel}></button>
          <div className="nav-title truncate">Review the Syllabus</div>
        </div>
        {thumb && (
          <div className="pad-x"><div className="card list-card-ruled pad row">
            <img className="upload-thumb" src={thumb} alt="Uploaded syllabus" />
            <div className="row-grow">
              <div className="conn-name">{rows.length} {rows.length === 1 ? "item" : "items"} found</div>
              <div className="conn-meta">Tap Task or Event to change one</div>
            </div>
          </div></div>
        )}
        <div className="pad-x"><div className="card list-card-ruled">
          {rows.map((r, i) => (
            <div className="row" key={r.key}>
              <div className="row-grow">
                <div className={"conn-name truncate" + (r.skip ? " upload-row-skipped" : "")}>{r.title}</div>
                <div className="conn-meta">{rowLine(r, weekdayShortDate)}</div>
              </div>
              <button type="button" className="note-fix" onClick={() => toggleKind(i)}>{r.kind === "event" ? "Event" : "Task"}</button>
              <button type="button" className="note-fix" onClick={() => toggleSkip(i)}>{r.skip ? "Skipped" : "Skip"}</button>
            </div>
          ))}
        </div></div>
        {undated > 0 && (
          <div className="pad-x"><div className="xs-note">
            {/* A fact, not a blocker: an undated assignment is a real thing on
                a syllabus, and it comes in with no date rather than a made-up
                one. Saying so here is what keeps it from being a surprise. */}
            <span>{capAfterNumber(`${undated} ${undated === 1 ? "item has" : "items have"} no date · They come in undated`)}</span>
          </div></div>
        )}
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" disabled={active === 0 || saving} onClick={() => void doImport()}>
            {saving ? "Adding..." : `Add ${active}`}
          </button>
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
        <div className="screen-foot" />
      </div>
    );
  }

  // ---- source pick ----
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Upload a Syllabus</div></div>
        <div className="pad-x sheet-form">
          <input ref={fileRef} className="visually-hidden-input" type="file" accept="image/*"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
          <button className="btn btn-primary btn-block" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "Reading..." : "Photo or Screenshot"}
          </button>
          <div className="field">
            <div className="input-label">Or Paste It</div>
            <textarea className="input input-multiline" rows={5} placeholder="Paste the Syllabus · a page or an email works" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <button className="btn btn-secondary btn-block" disabled={busy || !text.trim()}
            onClick={() => void runExtract({ role: "user", content: SYLLABUS_EXTRACT_PROMPT + "\n\nCONTENT:\n" + text.trim().slice(0, 12000) })}>
            {busy ? "Reading..." : "Read the Pasted Text"}
          </button>
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
