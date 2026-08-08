import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AIService } from "../../ai/AIService";
import { buildVisionMessage } from "../../ai/AIService";
import { JARVIS_VOICE } from "../../ai/voice";
import { encodeImageForVision } from "../../shared/imageEncode";
import { SCHEDULE_EXTRACT_PROMPT, parseScheduleExtract, buildScheduleRows, type ExtractedEvent, type ScheduleRow } from "../scheduleExtract";
import { fmtRange } from "../calendar";
import { showToast } from "../../shared/toast";
import EventSheet, { type SheetCategory, type EventDraft } from "./EventSheet";
import type { EventItem, EventData, EventRecurrence } from "../types";
import type { ScheduleService } from "../ScheduleService";

const CHEV = (
  <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
);
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${WD[d.getDay()]}, ${MO[d.getMonth()]} ${d.getDate()}`;
}

// A row the user reviews before anything saves: the resolved ScheduleRow plus
// the UI-only bits (category/recurrence come from the edit sheet defaults;
// skip is local to this screen and never persisted).
interface Row extends ScheduleRow {
  category: string;
  recurrence: EventRecurrence;
  skip: boolean;
}

function toRows(extracted: ExtractedEvent[], fallbackYear: number, existing: EventItem[], defaultCategory: string): Row[] {
  return buildScheduleRows(extracted, fallbackYear, existing.map((e) => ({ id: e.id, title: e.data.title, date: e.data.date })))
    .map((r) => ({ ...r, category: defaultCategory, recurrence: "none" as EventRecurrence, skip: false }));
}

// Upload a schedule (photo or pasted text). The model extracts what it can
// read; nothing reaches the calendar until the user reviews every row here.
// The raw photo is never retained: it is downscaled, sent once, and dropped
// once the calendar has the review data.
export default function ScheduleUploadFlow({
  ai, svc, categories, existingEvents, onDone, onCancel,
}: {
  ai: AIService;
  svc: ScheduleService;
  categories: SheetCategory[];
  existingEvents: EventItem[];
  onDone: (r: { createdCount: number; updatedCount: number; undo: () => Promise<void> }) => void;
  onCancel: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [thumb, setThumb] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedEvent[] | null>(null);
  const [needsYear, setNeedsYear] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fixIdx, setFixIdx] = useState<number | null>(null);

  const defaultCategory = categories[0]?.id ?? "";

  const afterExtract = (found: ExtractedEvent[], resolveYear: number) => {
    setExtracted(found);
    if (found.some((e) => e.year === null)) {
      setNeedsYear(true);
    } else {
      setRows(toRows(found, resolveYear, existingEvents, defaultCategory));
    }
  };

  const runExtract = async (message: Parameters<AIService["complete"]>[0][number]) => {
    setBusy(true);
    try {
      // Same fix as the gym uploader (audit 2026-08-07): this call had no
      // system prompt at all, the one thing voice.ts says no AI surface may
      // skip. Titles stay the source's own words; the voice rules govern the
      // model's side of the exchange.
      const out = await ai.complete([message], JARVIS_VOICE);
      const found = parseScheduleExtract(out);
      if (!found) {
        showToast({ message: "Couldn't read a schedule out of that. Try a clearer photo or paste the text." });
        return;
      }
      afterExtract(found, year);
    } catch {
      showToast({ message: "Couldn't reach JARVIS. Try again in a bit." });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File) => {
    try {
      const img = await encodeImageForVision(file);
      setThumb(`data:${img.mediaType};base64,${img.data}`);
      await runExtract(buildVisionMessage(SCHEDULE_EXTRACT_PROMPT, img.data, img.mediaType));
    } catch {
      showToast({ message: "Couldn't read that image." });
    }
  };

  const confirmYear = () => {
    if (!extracted) return;
    setNeedsYear(false);
    setRows(toRows(extracted, year, existingEvents, defaultCategory));
  };

  const toggleSkip = (i: number) => setRows((cur) => cur && cur.map((r, ri) => (ri === i ? { ...r, skip: !r.skip } : r)));

  const applyFix = (i: number, draft: EventDraft) => {
    setRows((cur) => cur && cur.map((r, ri) => (ri === i
      ? { ...r, title: draft.title, date: draft.date, start: draft.start, end: draft.end, location: draft.location, category: draft.category, recurrence: draft.recurrence, noTime: false }
      : r)));
    setFixIdx(null);
  };

  const [saving, setSaving] = useState(false);
  const doImport = async () => {
    if (!rows || saving) return;
    const active = rows.filter((r) => !r.skip);
    if (!active.length) return;
    setSaving(true);
    const created: string[] = [];
    const updated: { id: string; prev: EventData }[] = [];
    for (const r of active) {
      if (r.matchId) {
        const prev = existingEvents.find((e) => e.id === r.matchId)?.data;
        if (!prev) continue;
        // Every field the fix sheet can change is written here, not just the
        // ones a bare schedule usually carries: a "fix" the user made (a
        // corrected title, a set recurrence) must not be silently dropped
        // just because this row happens to be an update instead of a create.
        updated.push({ id: r.matchId, prev });
        await svc.editTitle(r.matchId, r.title);
        await svc.editTime(r.matchId, r.start);
        await svc.editEnd(r.matchId, r.end);
        await svc.editRecurrence(r.matchId, r.recurrence);
        await svc.editLocation(r.matchId, r.location);
        await svc.editCategory(r.matchId, r.category);
      } else {
        const id = await svc.createEvent(r.title, {
          date: r.date, start: r.start, end: r.end || undefined,
          category: r.category || undefined, location: r.location || undefined, recurrence: r.recurrence,
        });
        if (id) created.push(id);
      }
    }
    setSaving(false);
    const undo = async () => {
      for (const id of created) await svc.deleteEvent(id);
      for (const u of updated) {
        await svc.editTitle(u.id, u.prev.title);
        await svc.editTime(u.id, u.prev.start);
        await svc.editEnd(u.id, u.prev.end ?? "");
        await svc.editRecurrence(u.id, u.prev.recurrence ?? "none");
        await svc.editLocation(u.id, u.prev.location ?? "");
        await svc.editCategory(u.id, u.prev.category ?? "");
      }
    };
    onDone({ createdCount: created.length, updatedCount: updated.length, undo });
  };

  // ---- year: the ONE question, asked once, applied to every date that had none ----
  if (needsYear) {
    return createPortal(
      <div className="sheet-scrim" onClick={onCancel}>
        <div className="card" onClick={(e) => e.stopPropagation()}>
          <div className="sheet-handle" />
          <div className="grp"><div className="eyebrow">What Year Is This?</div></div>
          <div className="pad-x sheet-form">
            <div className="field">
              <div className="t-body">The schedule didn&rsquo;t say. This applies to every date that didn&rsquo;t have one.</div>
            </div>
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
    return (
      <>
        <div className="screen">
          <div className="nav-bar">
            <button className="nav-back" aria-label="Back" onClick={onCancel}></button>
            <div className="nav-title truncate">Review the Schedule</div>
          </div>
          {thumb && (
            <div className="pad-x"><div className="card pad row">
              <img className="upload-thumb" src={thumb} alt="Uploaded schedule" />
              <div className="row-grow">
                <div className="conn-name">{rows.length} {rows.length === 1 ? "event" : "events"} found</div>
                <div className="eyebrow">Tap any row to fix it before adding</div>
              </div>
            </div></div>
          )}
          <div className="pad-x"><div className="card">
            {rows.map((r, i) => (
              <div className="row" key={r.key}>
                <div className="row-grow" role="button" tabIndex={0} onClick={() => setFixIdx(i)}>
                  <div className={"conn-name truncate" + (r.skip ? " upload-row-skipped" : "")}>{r.title}</div>
                  <div className="eyebrow">
                    {fmtDate(r.date)} · {r.noTime ? "No time found" : fmtRange(r.start, r.end)}
                    {r.matchId ? " · Updates existing" : ""}
                  </div>
                </div>
                {CHEV}
                <button type="button" className="note-fix" onClick={() => toggleSkip(i)}>{r.skip ? "Skipped" : "Skip"}</button>
              </div>
            ))}
          </div></div>
          <div className="pad-x sheet-actions">
            <button className="btn btn-primary btn-block" disabled={active === 0 || saving} onClick={() => void doImport()}>
              {saving ? "Adding..." : `Add ${active} to Calendar`}
            </button>
            <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
          </div>
          <div className="screen-foot" />
        </div>
        {fixIdx !== null && rows[fixIdx] && (
          <EventSheet
            mode="edit"
            initial={{
              title: rows[fixIdx]!.title, date: rows[fixIdx]!.date, start: rows[fixIdx]!.start, end: rows[fixIdx]!.end,
              category: rows[fixIdx]!.category, location: rows[fixIdx]!.location, recurrence: rows[fixIdx]!.recurrence,
            }}
            categories={categories}
            onSave={(draft) => applyFix(fixIdx, draft)}
            onCancel={() => setFixIdx(null)}
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
        <div className="grp"><div className="eyebrow">Upload a Schedule</div></div>
        <div className="pad-x sheet-form">
          <input ref={fileRef} className="visually-hidden-input" type="file" accept="image/*"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
          <button className="btn btn-primary btn-block" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "Reading..." : "Photo or Screenshot"}
          </button>
          <div className="field">
            <div className="input-label">Or paste it</div>
            <textarea className="input input-multiline" rows={5} placeholder="Paste the schedule text from a message or email" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <button className="btn btn-secondary btn-block" disabled={busy || !text.trim()}
            onClick={() => void runExtract({ role: "user", content: SCHEDULE_EXTRACT_PROMPT + "\n\nCONTENT:\n" + text.trim().slice(0, 12000) })}>
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
