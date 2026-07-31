import { useState, type PointerEvent as RPointerEvent } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { TaskItem } from "../../tasks/TasksService";
import { catColor } from "../../shared/categories";

// Roadmap v2, the Anytime strip on the Schedule day view. Tasks with no time,
// checkable, above the timed grid. Collapses to a cap so a long list never
// pushes the day off screen; tap the name to give the task a time, tap the
// circle to complete it. One row component (same check + category color as the
// Tasks page), laid out for the all-day band.
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
          <div className="eyebrow anytime-open">{items.length} Open</div>
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
          {overflow > 0 && (
            <button
              className="anytime-more"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              {expanded ? (
                <>Show less <ChevronUp className="ic" /></>
              ) : (
                <>{overflow} more <ChevronDown className="ic" /></>
              )}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
