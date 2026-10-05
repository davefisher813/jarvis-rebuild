import { useState, type KeyboardEvent as RKeyboardEvent } from "react";
import { titleCase } from "../../shared/casing";
import type { EventItem } from "../types";
import { fmtTime, minutesBetween } from "../calendar";
import { spanLabel } from "../../shared/duration";
import { catColor, catName } from "../../shared/categories";
import { pressable, onPressKey } from "../../shared/pressable";
import { CalendarDays, ListChecks, StickyNote, User, Tag } from "../../shared/icons";
import Provenance from "../../shared/ProvenanceLine";
import { rowSource, type Source } from "../../shared/provenance";
import InlineEdit from "../../shared/InlineEdit";

// EVENTS ARE FIRST-CLASS (Dave, on the list since 2026-09-07: "events aren't
// first-class entities"; built 2026-09-09, all three gaps at once).
//
// This is the second of the three. A project opens a page. A goal opens a
// page. A person opens a page. A note opens its editor. An event opened the
// EDIT SHEET, from every door in the app including search and a note's own
// connection row, so the only thing you could ever do with an event was
// change its fields. There was nowhere to see what an event actually is:
// what has to happen before it, what has been written about it, who is
// coming.
//
// Presentational on purpose, like ProjectDetailPage beside it: the flow reads
// the services and hands the page its contents, so the page cannot disagree
// with the list that pushed it.
//
// The page does NOT repeat the sheet. Editing a field is still the sheet's
// job, one tap away on Edit; this page is what the event IS and what hangs
// off it. Two places to change the same field is the repetition this codebase
// keeps having to remove.

export interface EventStep {
  id: string;
  text: string;
  done: boolean;
}

export default function EventDetailPage({
  event, occurrence, onBack, onEdit,
  steps = [], onToggleStep, onAddStep, onOpenStep,
  linkedNotes = [], onOpenNote, openSourceFor,
  onDuplicate, onDelete,
}: {
  event: EventItem;
  /** The occurrence being looked at, for a repeating event. Defaults to the
   *  series' own date, which is what a non-repeating event has. */
  occurrence?: string;
  onBack: () => void;
  onEdit: () => void;
  /** The tasks filed to this event (TaskData.eventId), flattened by the flow. */
  steps?: EventStep[];
  onToggleStep?: (id: string) => void;
  onAddStep?: (text: string) => void;
  onOpenStep?: (id: string) => void;
  linkedNotes?: { id: string; title: string }[];
  onOpenNote?: (id: string) => void;
  /** PROVENANCE OPENS ITS SOURCE, HERE TOO (button audit 2026-09-16; Dave:
   *  "wire it"). This took a bare `onOpenSource` that no caller ever passed,
   *  so the line saying where the event came from was a fact and never a
   *  door. It takes the same opener the task sheet, the task row and the note
   *  editor take (shared/openSource.ts), which is the whole reason that
   *  helper exists: one map from a source stamp to a route, so four surfaces
   *  cannot disagree about where "From an email" goes. It still returns
   *  undefined for a source type nothing can show, and Provenance draws a
   *  plain fact for those. */
  openSourceFor?: (source: Source) => (() => void) | undefined;
  /** The page's own verbs, offered only where the flow can do them (2026-10-05
   *  review: the page was a title and an Area row over 300px of nothing). */
  onDuplicate?: () => void;
  onDelete?: () => void;
}) {
  const e = event.data;
  const date = occurrence ?? e.date;
  const tone = "cat-fg-" + catColor(e.category ?? "");
  const area = catName(e.category ?? "");
  const [adding, setAdding] = useState(false);
  const stepTap = (id: string) => (onOpenStep ? onOpenStep(id) : onToggleStep?.(id));
  const open = steps.filter((s) => !s.done).length;
  // The day, the start and the length as separate facts, each its own span
  // with the dot drawn by CSS (§AM F3). The day and the time are neutral, so
  // small caps (F5); the length is an estimate, so sky (R3). One line, one
  // left edge with the title (2026-10-05 review: they were two lines at a
  // different x, with the end time spelled out in a third).
  const startT = fmtTime(e.start);
  const when = (() => {
    const d = new Date(date + "T00:00:00");
    const day = d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    const mins = e.end ? minutesBetween(e.start, e.end) : 0;
    return { day, length: mins > 0 ? spanLabel(mins) : null };
  })();
  const joinUrl = e.url && /^https?:\/\//i.test(e.url.trim()) ? e.url.trim() : null;
  const skipOnly = (e.recurrence ?? "none") !== "none";
  const prov = rowSource(e.source, e.moved);

  return (
    <div className="screen ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Event</div>
        <button className="nav-action-text" onClick={onEdit}>Edit</button>
      </div>

      {/* The event itself: its own glyph in its own category colour, the
          title, and the two facts every event has. Location only when it has
          one; a blank Where row is furniture. */}
      <div className="pad-x ev-top"><div className="card pad">
        <div className="ev-head">
          {/* The TYPE's tile (Event, sky), the same one the sheet draws, not the area's fill: an area fill carries its own ink
                (dark on sky in light), where a type tile is white on its hue in both themes. */}
          <div className="row-ico nav-tile-sky"><CalendarDays className="ic" /></div>
          <div className="ev-text">
            <div className="ev-title">{titleCase(e.title)}</div>
            <div className="facts">
              <span className="fact date">{when.day}</span>
              <span className="fact date">{startT.time} {startT.ap}</span>
              {when.length && <span className="fact est">{when.length}</span>}
            </div>
            {e.location && <div className="conn-meta">{e.location}</div>}
          </div>
        </div>
        <Provenance source={prov} {...(prov && openSourceFor ? { onOpen: openSourceFor(prov) } : {})} />
      </div></div>

      {/* THE AREA SITS WITH THE EVENT'S OWN FACTS, above Before This (2026-10-05: under that head, with no task, it read as
          the first thing that has to happen before the event). The area it belongs to, stated rather than implied by a colour.
          Only when there is one (§AK): "No area" was a placeholder stating an
          absence, on a row that offers nothing to tap. Filing it is the
          edit sheet's job, one tap away on Edit. */}
      {area && (
        <div className="pad-x"><div className="card list-card-ruled">
          <div className="row">
            <div className="row-ico nav-tile-blue"><Tag className="ic" /></div>
            <div className="row-grow"><div className="conn-name">Area</div></div>
            <span className="row-status ev-area"><span className={"cat-dot " + tone.replace("cat-fg-", "cat-bg-")} />{area}</span>
          </div>
        </div></div>
      )}

      {/* The one thing a meeting page is for, when there is a link to go to. */}
      {joinUrl && (
        <div className="pad-x"><a className="btn btn-primary btn-block ev-join" href={joinUrl} target="_blank" rel="noopener noreferrer">Join Meeting</a></div>
      )}

      {/* BEFORE THIS: the half that did not exist. A task can belong to an
          event now (notes/types.ts, TaskData.eventId), so the event can say
          what has to happen first, and adding one here is what files it. */}
      {/* ONE CAPSULE IN THE HEAD, NOTHING UNDER IT UNTIL THERE IS A TASK (Dave 2026-10-05, locked: a section action lives in its
          head; a card that holds only a button is not drawn). The square-cornered "Add Task" box this was is gone. */}
      <div className="sh2 sh2-quiet">
        <span className="t">Before This</span>
        {open > 0 && <span className="n">{open}</span>}
        {onAddStep && !adding && <button type="button" className="see-all pill-action" onClick={() => setAdding(true)}>Add Task</button>}
      </div>
      {(steps.length > 0 || adding) && (
        <div className="pad-x"><div className="card list-card-ruled">
          {steps.map((s) => (
            // THE WHOLE ROW IS THE DOOR (Dave 2026-09-15: "I want all rows
            // clickable"). The row opens the task where there is a route to it,
            // and otherwise ticks it, the one reversible verb a checklist row has.
            <div className="row" key={s.id} role="button" tabIndex={0}
              aria-label={(onOpenStep ? "Open " : s.done ? "Mark not done: " : "Mark done: ") + s.text}
              onClick={() => stepTap(s.id)}
              onKeyDown={(e: RKeyboardEvent) => { if (e.target === e.currentTarget) onPressKey(() => stepTap(s.id))(e); }}>
              <div
                className="task-check-tap"
                role="checkbox"
                aria-checked={s.done}
                aria-label={s.done ? "Mark not done" : "Mark done"}
                onClick={(e) => { e.stopPropagation(); onToggleStep?.(s.id); }}
              >
                <div className={"task-check" + (s.done ? " done" : "")} />
              </div>
              <div className="row-grow">
                <div className={"conn-name" + (s.done ? " pick-done" : "")}>{s.text}</div>
              </div>
            </div>
          ))}
          {adding && (
            <div className="row">
              <div className="row-ico nav-tile-red"><ListChecks className="ic" /></div>
              <div className="row-grow">
                <InlineEdit
                  className="conn-name"
                  value=""
                  focused
                  placeholder="What Has to Happen First"
                  onSave={(v) => {
                    setAdding(false);
                    const text = v.trim();
                    if (text) onAddStep?.(text);
                  }}
                />
              </div>
            </div>
          )}
        </div></div>
      )}

      {linkedNotes.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Notes</span><span className="n">{linkedNotes.length}</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {linkedNotes.map((n) => (
              <div className="row" key={n.id} {...(onOpenNote ? pressable(() => onOpenNote(n.id)) : {})}>
                <div className="row-ico nav-tile-yellow"><StickyNote className="ic" /></div>
                <div className="row-grow"><div className="conn-name">{n.title || "Untitled"}</div></div>
                <div className="chev" />
              </div>
            ))}
          </div></div>
        </>
      )}

      {/* Google's own guest list, when the event came from a calendar that
          carries one. Read only, the same as it is on the sheet: nothing here
          writes an attendee, so nothing here offers to. */}
      {e.attendees && e.attendees.length > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Who</span><span className="n">{e.attendees.length}</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {e.attendees.map((a) => (
              <div className="row" key={a.email}>
                <div className="row-ico nav-tile-pink"><User className="ic" /></div>
                <div className="row-grow"><div className="conn-name">{a.name || a.email}</div>
                  {a.name && <div className="conn-meta">{a.email}</div>}
                </div>
              </div>
            ))}
          </div></div>
        </>
      )}

      {(e.notes || e.url) && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Details</span></div>
          <div className="pad-x"><div className="card pad">
            {e.url && <div className="conn-meta ev-url">{e.url}</div>}
            {e.notes && <div className="t-body">{e.notes}</div>}
          </div></div>
        </>
      )}

      {(onDuplicate || onDelete) && (
        <div className="pad-x ev-verbs">
          {onDuplicate && <button type="button" className="btn btn-secondary btn-block" onClick={onDuplicate}>Duplicate</button>}
          {onDelete && <button type="button" className="btn btn-tertiary btn-block btn-danger-text" onClick={onDelete}>{skipOnly ? "Skip This Day" : "Delete Event"}</button>}
        </div>
      )}

      <div className="screen-foot" />
    </div>
  );
}
