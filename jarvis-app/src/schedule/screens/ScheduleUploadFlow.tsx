import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AIService } from "../../ai/AIService";
import { buildVisionMessage } from "../../ai/AIService";
import { JARVIS_VOICE } from "../../ai/voice";
import { encodeImageForVision } from "../../shared/imageEncode";
import { SCHEDULE_EXTRACT_PROMPT, parseScheduleExtract, buildScheduleRows, type ExtractedEvent, type ScheduleRow } from "../scheduleExtract";
import { fmtRange } from "../calendar";
import { showToast } from "../../shared/toast";
import { WRITE_FAILED_MESSAGE } from "../../shared/guard";
import { capAfterNumber } from "../../shared/casing";
import EventSheet, { type SheetCategory, type EventDraft } from "./EventSheet";
import type { EventItem, EventData, EventRecurrence } from "../types";
import type { ScheduleService } from "../ScheduleService";
import { weekdayShortDate } from "../../shared/dateFormat";

const CHEV = (
  <div className="chev" />
);

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
    // UP-CORE-11 (2026-09-05): a row the source showed as a weekly grid
    // arrives with its repeat already on, so a printed timetable imports as
    // repeating classes rather than one week of dated events. It is a chip,
    // so the read is visible and one tap from wrong to right.
    .map((r) => ({ ...r, category: defaultCategory, recurrence: (r.repeats ? "weekly" : "none") as EventRecurrence, skip: false }));
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
        showToast({ message: "Couldn't read that · Try a clearer photo" });
        return;
      }
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
  // UP-CORE-11: weekly or once, per row.
  const toggleRepeat = (i: number) => setRows((cur) => cur && cur.map((r, ri) => (
    ri === i ? { ...r, recurrence: (r.recurrence === "weekly" ? "none" : "weekly") as EventRecurrence, repeats: r.recurrence !== "weekly" } : r)));

  const applyFix = (i: number, draft: EventDraft) => {
    setRows((cur) => cur && cur.map((r, ri) => (ri === i
      ? { ...r, title: draft.title, date: draft.date, start: draft.start, end: draft.end, location: draft.location, category: draft.category, recurrence: draft.recurrence, days: draft.days ?? r.days, repeats: draft.recurrence === "weekly", noTime: false }
      : r)));
    setFixIdx(null);
  };

  const [saving, setSaving] = useState(false);
  const doImport = async () => {
    if (!rows || saving) return;
    const active = rows.filter((r) => !r.skip);
    // SCHED-F-08 (2026-09-05): a row the source gave no time for is not
    // importable. The 09:00 in the row is a SEED for the fix sheet, and it
    // used to be written to the calendar as if the schedule had said so.
    if (!active.length || active.some((r) => r.noTime)) return;
    setSaving(true);
    const created: string[] = [];
    const updated: { id: string; prev: EventData }[] = [];
    // Which rows actually reached the calendar, so a retry after a failure
    // partway through cannot write any of them a second time.
    const landed = new Set<string>();
    let failed = false;
    try {
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
          if (r.recurrence === "weekly") await svc.editWeekdays(r.matchId, r.days);
          await svc.editLocation(r.matchId, r.location);
          await svc.editCategory(r.matchId, r.category);
        } else {
          const id = await svc.createEvent(r.title, {
            date: r.date, start: r.start, end: r.end || undefined,
            category: r.category || undefined, location: r.location || undefined, recurrence: r.recurrence,
            // UP-CORE-11: the weekdays the grid showed, on a weekly row.
            days: r.recurrence === "weekly" ? r.days : undefined,
          });
          if (id) created.push(id);
        }
        landed.add(r.key);
      }
    } catch {
      // SCHED-F-08: the loop had no catch, so a write that threw skipped
      // setSaving(false) and the button said "Adding..." for good, with rows
      // already on the calendar and nothing said about them.
      failed = true;
    } finally {
      setSaving(false);
    }
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
    if (failed) {
      const done = created.length + updated.length;
      // The rows that landed are marked done here, so the review stays open
      // on exactly what is left and Add cannot double-write them.
      if (done > 0) setRows((cur) => cur && cur.map((r) => (landed.has(r.key) ? { ...r, skip: true } : r)));
      showToast(done > 0
        ? { message: capAfterNumber(`Couldn't add them all · ${done} added before it stopped`), actionLabel: "Undo", onAction: () => { void undo(); } }
        : { message: WRITE_FAILED_MESSAGE });
      return;
    }
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
              <div className="t-body">Schedule didn&rsquo;t say · Applies to undated rows</div>
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
    // SCHED-F-08 (2026-09-05): the rows that still have no time. Add waits
    // for them, because "No time found" on the review and a 9:00 AM event on
    // the calendar were the same row telling two different stories.
    const needTime = rows.filter((r) => !r.skip && r.noTime).length;
    return (
      <>
        <div className="screen ruled">
          <div className="nav-bar">
            <button className="nav-back" aria-label="Back" onClick={onCancel}></button>
            <div className="nav-title truncate">Review the Schedule</div>
          </div>
          {thumb && (
            <div className="pad-x"><div className="card list-card-ruled pad row">
              <img className="upload-thumb" src={thumb} alt="Uploaded schedule" />
              <div className="row-grow">
                <div className="conn-name">{rows.length} {rows.length === 1 ? "event" : "events"} found</div>
                <div className="conn-meta">Tap a row to fix it</div>
              </div>
            </div></div>
          )}
          <div className="pad-x"><div className="card list-card-ruled">
            {rows.map((r, i) => (
              <div className="row" key={r.key}>
                <div className="row-grow" role="button" tabIndex={0} onClick={() => setFixIdx(i)}>
                  <div className={"conn-name truncate" + (r.skip ? " upload-row-skipped" : "")}>{r.title}</div>
                  <div className="conn-meta">
                    {weekdayShortDate(r.date)} · {r.noTime ? "No time found" : fmtRange(r.start, r.end)}
                    {r.matchId ? " · Updates existing" : ""}
                  </div>
                </div>
                {/* UP-CORE-11: the repeat, said out loud and flippable here.
                    "Repeats weekly" beside a row is the difference between a
                    semester of classes and one week of them. */}
                <button
                  type="button"
                  className={"note-fix" + (r.recurrence === "weekly" ? " on" : "")}
                  aria-pressed={r.recurrence === "weekly"}
                  onClick={() => toggleRepeat(i)}
                >{r.recurrence === "weekly" ? "Repeats" : "Once"}</button>
                {CHEV}
                <button type="button" className="note-fix" onClick={() => toggleSkip(i)}>{r.skip ? "Skipped" : "Skip"}</button>
              </div>
            ))}
          </div></div>
          {needTime > 0 && (
            <div className="pad-x"><div className="xs-note">
              <span>{capAfterNumber(`${needTime} ${needTime === 1 ? "row has" : "rows have"} no time yet · Tap one to set it, or skip it`)}</span>
            </div></div>
          )}
          <div className="pad-x sheet-actions">
            <button className="btn btn-primary btn-block" disabled={active === 0 || saving || needTime > 0} onClick={() => void doImport()}>
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
              days: rows[fixIdx]!.days,
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
            <div className="input-label">Or Paste It</div>
            <textarea className="input input-multiline" rows={5} placeholder="Paste the Schedule · a message or email works" value={text} onChange={(e) => setText(e.target.value)} />
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
