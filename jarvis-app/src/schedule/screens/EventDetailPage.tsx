import { useState, type KeyboardEvent as RKeyboardEvent } from "react";
import type { EventItem } from "../types";
import { fmtTime } from "../calendar";
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
}) {
  const e = event.data;
  const date = occurrence ?? e.date;
  const tone = "cat-fg-" + catColor(e.category ?? "");
  const area = catName(e.category ?? "");
  const [adding, setAdding] = useState(false);
  const stepTap = (id: string) => (onOpenStep ? onOpenStep(id) : onToggleStep?.(id));
  const open = steps.filter((s) => !s.done).length;
  // The day and the time as two facts, not one string with a dot baked into
  // it (§AM F3). Each is a neutral date or time, so each is small caps
  // (F5), which leaves the place as the card's one grey (§AK).
  const when = (() => {
    const d = new Date(date + "T00:00:00");
    const day = d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    const start = fmtTime(e.start);
    const end = e.end ? fmtTime(e.end) : null;
    return { day, range: `${start.time} ${start.ap}${end ? " to " + end.time + " " + end.ap : ""}` };
  })();
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
      <div className="pad-x"><div className="card pad">
        <div className="row-pair">
          <div className={"sec-ico " + tone.replace("cat-fg-", "cat-bg-")}><CalendarDays className="ic" /></div>
          <div className="row-grow">
            <div className="pagehead-title ev-title">{e.title}</div>
            {/* A line each, the way a calendar's own event page sets them:
                side by side on one .facts line, a long weekday and a
                12:00 PM to 12:30 PM range overrun the column at 390 and the
                time is the fact that ellipsizes. */}
            <div className="facts"><span className="fact date">{when.day}</span></div>
            <div className="facts"><span className="fact date">{when.range}</span></div>
            {e.location && <div className="conn-meta">{e.location}</div>}
          </div>
        </div>
        <Provenance source={prov} {...(prov && openSourceFor ? { onOpen: openSourceFor(prov) } : {})} />
      </div></div>

      {/* BEFORE THIS: the half that did not exist. A task can belong to an
          event now (notes/types.ts, TaskData.eventId), so the event can say
          what has to happen first, and adding one here is what files it. */}
      <div className="sh2 sh2-quiet">
        <span className="t">Before This</span>
        {open > 0 && <span className="n">{open}</span>}
      </div>
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
        {onAddStep && (adding ? (
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
                  if (text) onAddStep(text);
                }}
              />
            </div>
          </div>
        ) : (
          <button className="row-create" onClick={() => setAdding(true)}>Add Task</button>
        ))}
      </div></div>

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

      {/* The area it belongs to, stated rather than implied by a colour.
          Only when there is one (§AK): "No area" was a placeholder stating an
          absence, on a row that offers nothing to tap. Filing it is the
          edit sheet's job, one tap away on Edit. */}
      {area && (
        <div className="pad-x"><div className="card list-card-ruled">
          <div className="row">
            <div className={"row-ico " + tone.replace("cat-fg-", "cat-bg-")}><Tag className="ic" /></div>
            <div className="row-grow"><div className="conn-name">Area</div></div>
            <span className="row-status">{area}</span>
          </div>
        </div></div>
      )}

      <div className="screen-foot" />
    </div>
  );
}
