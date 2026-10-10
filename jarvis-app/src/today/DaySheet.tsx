import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { TaskItem } from "../tasks/TasksService";
import { countsForToday, countsDoneToday } from "./todayData";
import { titleCase } from "../shared/casing";
import { rowDoor, own } from "../shared/rowDoor";
import { catColor, catName } from "../shared/categories";
import RowCtxAction from "../shared/RowCtxAction";

// THE DAY RING OPENS ONTO THE DAY (Dave 2026-10-06: "tapping it opens a bottom
// sheet with today's tasks: Still Open on top with quick actions on each, Done
// below"). The ring says 8/19; this is the 19. It draws exactly the tasks the
// ring counts (todayData's countsForToday and countsDoneToday, the one rule), so
// the sheet and the number cannot disagree, and it is read off the live list on
// every render, so ticking or moving a row changes the ring behind it and the
// row under your thumb in the same beat.
//
// Each open row carries its two quick actions: the check (Done) and Tomorrow, the
// row's one quiet text verb (no capsule on a row, the catalog's rule).
// The row itself is the door to the task. Nothing here writes on its own; the
// flow owns every write, its Undo and its reload.
//
// THE SHEET'S OWN CARD (pass-off item 22, 2026-10-10). The card wears `xs`, the
// class the app's other sheets wear, so the foot under the last row clears the
// home indicator instead of sitting under it. A section with nothing in it is
// not drawn: no heading, no empty state. The category dot under each title is
// sized by `.day-sheet .conn-meta .cat-dot`; as a bare inline span it measured
// zero wide and never showed.
//
// NOTHING LEFT, NO SHEET (review, 2026-10-10). Moving the last task due today to
// Tomorrow, with none done yet, empties both sections and takes the ring away
// behind the sheet; the sheet then stood open as a bare title bar over nothing.
// It closes itself instead, and the Undo the flow raised still brings the task,
// and the ring, back.
export default function DaySheet({ tasks, today, onToggle, onTomorrow, onOpen, onClose }: {
  tasks: TaskItem[];
  today: string;
  onToggle: (id: string) => void;
  onTomorrow: (t: TaskItem) => void;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const mine = tasks.filter((t) => countsForToday(t, today));
  const open = mine.filter((t) => !countsDoneToday(t, today));
  const done = mine.filter((t) => countsDoneToday(t, today));
  const empty = mine.length === 0;
  useEffect(() => { if (empty) onClose(); }, [empty, onClose]);
  const where = (t: TaskItem) => catName(t.data.category) ? (
    <div className="conn-meta"><span className="fact"><span className={"cat-dot cat-bg-" + catColor(t.data.category)} />{catName(t.data.category)}</span></div>
  ) : null;
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card xs day-sheet" role="dialog" aria-label="Today’s Tasks" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="opt-bar">
          <div className="opt-title">Today’s Tasks</div>
          <button type="button" className="opt-done" onClick={onClose}>Done</button>
        </div>
        <div className="sheet-list">
          {open.length > 0 && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Still Open</span><span className="n">{open.length}</span></div>
              <div className="pad-x"><div className="card list-card-ruled">
                {open.map((t) => (
                  <div className="row" key={t.id} {...rowDoor(() => onOpen(t.id))}>
                    <div className="task-check-tap" role="checkbox" aria-checked={false} aria-label="Mark done" onClick={own(() => onToggle(t.id))}>
                      <div className="task-check" />
                    </div>
                    <div className="row-grow">
                      <div className="conn-name">{titleCase(t.data.text)}</div>
                      {where(t)}
                    </div>
                    <RowCtxAction when label="Tomorrow" onAct={() => onTomorrow(t)} />
                  </div>
                ))}
              </div></div>
            </>
          )}
          {done.length > 0 && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Done</span><span className="n">{done.length}</span></div>
              <div className="pad-x"><div className="card list-card-ruled">
                {done.map((t) => (
                  <div className="row" key={t.id} {...rowDoor(() => onOpen(t.id))}>
                    <div className="task-check-tap" role="checkbox" aria-checked={true} aria-label="Mark not done" onClick={own(() => onToggle(t.id))}>
                      <div className="task-check done" />
                    </div>
                    <div className="row-grow">
                      <div className="conn-name pick-done">{titleCase(t.data.text)}</div>
                      {where(t)}
                    </div>
                  </div>
                ))}
              </div></div>
            </>
          )}
        </div>
        <div className="xs-foot" />
      </div>
    </div>,
    document.body,
  );
}
