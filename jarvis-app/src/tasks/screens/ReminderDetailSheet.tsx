import { createPortal } from "react-dom";
import type { TaskItem } from "../TasksService";
import type { LinkedItem } from "../../notes/types";
import { Group, Row, Note, Strip, DeleteRow } from "../../shared/FormSheet";
import { Clock, CalendarPlus } from "../../shared/icons";
import { RepeatGlyph, WarningGlyph, BellGlyph } from "../../shared/glyphs";
import { Forward, Hourglass, CircleSlash, PenLine } from "../../shared/icons";
import { catName, catColor } from "../../shared/categories";
import { describeRepeat, repeatRuleOf, scheduleKindOf, nextOccurrence, runsOn, isDone, whenWords, followUpWords } from "../reminders";
import { actionLabelFor, scheduleAdvice, adviceLine, recentEvents } from "../reminderHistory";

// REMINDER DETAILS (the reminders rebuild push E, 2026-09-15, Dave's
// interactive preview). What a tap on a row opens: the words, the area and
// the state as one facts line, then When, Repeat, Follow-up and Opens as
// rows, the one filled action (the linked verb, or Mark Done), the four
// quiet answers (Snooze, Edit, Pause, Skip), the advice when there is
// evidence, the last few events, and More Actions at the foot with Export
// and Delete. Opening the linked record never completes the reminder.

export default function ReminderDetailSheet({
  item, today, now, onClose, onOpenLinked, onComplete, onSnooze, onEdit, onPause, onSkip, onKeepSchedule, onExport, onDelete,
}: {
  item: TaskItem;
  today: string;
  now: string;
  onClose: () => void;
  onOpenLinked?: (link: LinkedItem) => void;
  onComplete: (id: string) => void;
  onSnooze: (id: string) => void;
  onEdit: (id: string) => void;
  onPause: (id: string, paused: boolean) => void;
  onSkip: (id: string, date: string) => void;
  onKeepSchedule: (id: string) => void;
  onExport?: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const r = item.data.reminder;
  if (!r) return null;
  const link = r.linkedItem;
  const done = isDone(r, today);
  const timed = scheduleKindOf(r) === "timed" && !r.paused;
  const occurrence = timed ? (runsOn(r, today) && !done ? { date: today, time: r.movedTimes?.[today] ?? r.time } : nextOccurrence(r, today, now)) : null;
  const state = r.paused ? "Paused" : done ? "Done Today" : "Open";
  const advice = scheduleAdvice(r);
  const history = recentEvents(r, today, 5);
  const area = item.data.category ? catName(item.data.category) : "";
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card xs form-sheet rem-detail" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-bar">
          <button type="button" className="sheet-bar-cancel" onClick={onClose}>Close</button>
          <div className="sheet-bar-title">Reminder</div>
          <span />
        </div>
        <div className="sheet-form">
          <div className="rem-detail-head">
            <div className="rem-detail-title">{item.data.text}</div>
            <div className="facts">
              {area && <span className="fact cat"><span className={"cd cat-bg-" + catColor(item.data.category)} />{area}</span>}
              {/* Done is the key's green; Open and Paused carry no key
                  meaning, so they are the line's one plain grey beside the
                  dotted area (§AM). The reminders-only "when" tone is
                  retired: it has no rule in any stylesheet. */}
              <span className={"fact" + (r.paused ? "" : done ? " good" : "")}>{state}</span>
            </div>
          </div>

          <Group>
            <Row tone="green" glyph={<Clock className="ic" />} label="When" meta={whenWords(r, occurrence?.date ?? null, occurrence?.time ?? null, today, area)} />
            <Row tone="sky" glyph={<RepeatGlyph />} label="Repeat" meta={timed ? describeRepeat(repeatRuleOf(r)) : "Never"} />
            <Row tone="sand" glyph={<WarningGlyph />} label="Follow-up" meta={followUpWords(r)} />
            <Row tone="blue" glyph={<Forward className="ic" />} label="Opens" meta={link?.label ?? (link ? actionLabelFor(link) : "This Reminder")} />
          </Group>

          {advice && !done && (
            <Group label="Advice">
              <Note>{adviceLine(advice)}</Note>
              <Strip>
                <button type="button" className="pill-act" onClick={() => onEdit(item.id)}>{advice.kind === "later" ? "Move It There" : "Change Time"}</button>
                <button type="button" className="pill-act" onClick={() => onPause(item.id, true)}>Pause</button>
                <button type="button" className="pill-act" onClick={() => onKeepSchedule(item.id)}>Keep Schedule</button>
              </Strip>
            </Group>
          )}

          {!done && !r.paused && (
            <div className="rem-detail-acts">
              {link && onOpenLinked
                ? <button type="button" className="btn btn-primary" onClick={() => onOpenLinked(link)}>{actionLabelFor(link)}</button>
                : <button type="button" className="btn btn-primary" onClick={() => onComplete(item.id)}>Mark Done</button>}
              <div className="rem-detail-grid">
                {timed && <button type="button" className="btn btn-secondary" onClick={() => onSnooze(item.id)}>Snooze</button>}
                <button type="button" className="btn btn-secondary" onClick={() => onEdit(item.id)}>Edit</button>
                <button type="button" className="btn btn-secondary" onClick={() => onPause(item.id, true)}>Pause</button>
                {occurrence && <button type="button" className="btn btn-secondary" onClick={() => onSkip(item.id, occurrence.date)}>{"Skip " + (occurrence.date === today ? "Today" : "Next")}</button>}
              </div>
              {link && onOpenLinked && <Note>Opening it keeps the reminder active · The ring marks it done</Note>}
            </div>
          )}
          {r.paused && (
            <div className="rem-detail-acts">
              <button type="button" className="btn btn-secondary" onClick={() => onPause(item.id, false)}>Resume Reminder</button>
              <div className="rem-detail-grid">
                <button type="button" className="btn btn-secondary" onClick={() => onEdit(item.id)}>Edit</button>
              </div>
            </div>
          )}
          {done && (
            <div className="rem-detail-acts">
              <button type="button" className="btn btn-secondary" onClick={() => onComplete(item.id)}>Reopen Occurrence</button>
              <div className="rem-detail-grid">
                <button type="button" className="btn btn-secondary" onClick={() => onEdit(item.id)}>Edit</button>
              </div>
            </div>
          )}

          {history.length > 0 && (
            <Group label="History">
              {history.map((h, i) => <Row key={i} tone="grey" glyph={<BellGlyph />} label={h.word} meta={h.when} />)}
            </Group>
          )}

          <details className="exp-more rem-more">
            <summary>More Actions</summary>
            <Group className="xs-actions">
              {onExport && timed && <Row tone="red" glyph={<CalendarPlus className="ic" />} label="Export to Calendar" onClick={() => onExport(item.id)} chev />}
              <Row tone="grey" glyph={<PenLine className="ic" />} label="Edit Reminder" onClick={() => onEdit(item.id)} chev />
              {r.paused
                ? <Row tone="grey" glyph={<Hourglass className="ic" />} label="Resume" onClick={() => onPause(item.id, false)} chev />
                : <Row tone="grey" glyph={<CircleSlash className="ic" />} label="Pause" onClick={() => onPause(item.id, true)} chev />}
              <DeleteRow label="Delete Reminder" onClick={() => onDelete(item.id)} />
            </Group>
            <Note>Deleting the reminder never touches what it links to.</Note>
          </details>
          <div className="xs-foot" />
        </div>
      </div>
    </div>,
    document.body,
  );
}
