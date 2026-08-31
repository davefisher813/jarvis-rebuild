import { useState, type PointerEvent as RPointerEvent } from "react";
import type { TaskItem } from "../../tasks/TasksService";
import { catColor } from "../../shared/categories";

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
}: {
  items: TaskItem[];
  onToggle?: (id: string) => void;
  onSchedule?: (id: string) => void;
  onDragStart?: (id: string, label: string, e: RPointerEvent) => void;
  cap?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;

  const overflow = items.length - cap;
  const shown = expanded ? items : items.slice(0, cap);

  return (
    <>
      <div className="grp">
        <div className="plan-head">
          <div className="eyebrow">Anytime</div>
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
            <div className="eyebrow anytime-open">{items.length} Open</div>
          )}
        </div>
      </div>
      <div className="pad-x">
        <div className="card anytime-card">
          {shown.map((it) => {
            const color = catColor(it.data.category);
            return (
              <div
                className="anytime-row"
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
                <span className={"cat-dot cat-bg-" + color} />
                <button
                  className="anytime-name truncate"
                  onClick={() => onSchedule?.(it.id)}
                  aria-label={"Give " + it.data.text + " a time"}
                >
                  {it.data.text}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
