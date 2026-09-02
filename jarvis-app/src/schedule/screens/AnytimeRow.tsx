import { useState, type PointerEvent as RPointerEvent } from "react";
import type { TaskItem } from "../../tasks/TasksService";
import { ParentLineGlyph } from "../../shared/glyphs";
import type { ParentLine } from "../../life/parent";

// Roadmap v2, the Anytime strip on the Schedule day view. Tasks with no time,
// checkable, above the timed grid. Collapses to a cap so a long list never
// pushes the day off screen; tap the name to give the task a time, tap the
// circle to complete it. One row component (same check + category color as the
// Tasks page), laid out for the all-day band.
//
// ONE DOOR (Dave 2026-08-31, Schedule screenshot: "'9 open' should be in a
// white/black button like the home page"). The count IS the expand toggle
// now, wearing the same ghost pill every home-page head action wears
// (.see-all.pill-action), and the old "N more" footer door is gone -- two
// controls that opened the same list was the duplicate-door pattern. When
// the list fits under the cap there is nothing to expand, so the count
// stays a quiet label: a button that does nothing is not a button.
const DEFAULT_CAP = 5;

export default function AnytimeRow({
  items,
  onToggle,
  onSchedule,
  onDragStart,
  cap = DEFAULT_CAP,
  parentOf,
}: {
  items: TaskItem[];
  onToggle?: (id: string) => void;
  onSchedule?: (id: string) => void;
  onDragStart?: (id: string, label: string, e: RPointerEvent) => void;
  cap?: number;
  // THE RULED ROW (2026-09-01): the second line names the goal the task
  // moves, by its short name, or the category when it moves none.
  parentOf?: (t: TaskItem) => ParentLine | null;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;

  const overflow = items.length - cap;
  const shown = expanded ? items : items.slice(0, cap);

  return (
    <>
      {/* The ruled section head: caps, leader, the count or the door. */}
      <div className="sh2 sh2-quiet anytime-head">
          <span className="t">Anytime</span>
          {overflow > 0 ? (
            <button
              className="see-all pill-action"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-label={expanded ? "Show fewer anytime tasks" : `Show all ${items.length} anytime tasks`}
            >
              {expanded ? "Show Less" : `${items.length} Open`}
            </button>
          ) : (
            <span className="n">{items.length}</span>
          )}
      </div>
      <div className="pad-x">
        <div className="card anytime-card">
          {/* THE RULED ROW (2026-09-01), the same anatomy as Today and Tasks:
              neutral ring, name, then where it lives (the parent's own glyph
              in its category colour, then its name; 2026-09-02). The trailing slot is Drop, the contract's verb
              for "give this a time in the day" (§4.4: Start on Tasks, Drop
              on Anytime). Tapping the row opens the same placement. */}
          {shown.map((it) => {
            const parent = parentOf?.(it) ?? null;
            return (
              <div
                className="task-row anytime-row"
                key={it.id}
                onPointerDown={(e) => onDragStart?.(it.id, it.data.text, e)}
              >
                <div
                  className="task-check-tap"
                  onClick={(e) => { e.stopPropagation(); onToggle?.(it.id); }}
                  role="checkbox"
                  aria-checked={false}
                  aria-label={"Complete " + it.data.text}
                >
                  <div className="task-check" />
                </div>
                <div className="task-title" role="button" tabIndex={0} onClick={() => onSchedule?.(it.id)} aria-label={"Give " + it.data.text + " a time"}>
                  <span className="task-name">{it.data.text}</span>
                  <div className="r-k">
                    {parent
                      ? <ParentLineGlyph p={parent} />
                      : <span className="r-goal r-cat">No category</span>}
                  </div>
                </div>
                <button className="pill-act" onClick={(e) => { e.stopPropagation(); onSchedule?.(it.id); }}>Drop</button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
