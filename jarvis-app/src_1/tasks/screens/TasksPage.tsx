import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import SkeletonRows from "../../shared/SkeletonRows";
import type { TaskItem } from "../TasksService";
import { urgencyFor, type UrgencyKind } from "../grouping";
import { FILTERS, FILTER_LABEL, type TaskFilter } from "../filters";
import { catColor, catName } from "../../shared/categories";

// Tasks page. Two-line rows with a large (44pt) completion target on the left
// and swipe-left-to-delete, so completing or removing a task is one easy action.

const URGENCY_CLASS: Record<UrgencyKind, string> = {
  overdue: "urgency-red",
  today: "urgency-warn",
  soon: "urgency-muted",
};

function Row({
  item,
  today,
  onToggle,
  onOpen,
  onDelete,
}: {
  item: TaskItem;
  today: string;
  onToggle?: (id: string) => void;
  onOpen?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const t = item.data;
  const u = urgencyFor(t, today);
  const prevDone = useRef(t.done);
  const [burst, setBurst] = useState(false);
  const [dx, setDx] = useState(0);
  const startX = useRef(0);
  const swiping = useRef(false);

  useEffect(() => {
    if (t.done && !prevDone.current) {
      setBurst(true);
      const id = setTimeout(() => setBurst(false), 650);
      prevDone.current = t.done;
      return () => clearTimeout(id);
    }
    prevDone.current = t.done;
  }, [t.done]);

  const onStart = (e: React.TouchEvent) => { startX.current = e.touches[0]!.clientX; swiping.current = true; };
  const onMove = (e: React.TouchEvent) => {
    if (!swiping.current) return;
    setDx(Math.max(-96, Math.min(0, e.touches[0]!.clientX - startX.current)));
  };
  const onEnd = () => { swiping.current = false; setDx((d) => (d < -48 ? -88 : 0)); };

  return (
    <div className="task-swipe">
      <button className="task-del" onClick={() => onDelete?.(item.id)} aria-label="Delete task">
        <Trash2 className="ic" />
      </button>
      <div
        className={"task-row" + (t.done ? " completed" : "") + (burst ? " just-done" : "")}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onTouchStart={onStart}
        onTouchMove={onMove}
        onTouchEnd={onEnd}
      >
        <div
          className="task-check-tap"
          onClick={(e) => { e.stopPropagation(); onToggle?.(item.id); }}
          role="checkbox"
          aria-checked={t.done}
          aria-label={t.done ? "Mark not done" : "Mark done"}
        >
          <div className={"task-check " + (t.done ? "done" : "cat-bd-" + catColor(t.category))} />
        </div>
        <div className="row-stack" role="button" tabIndex={0} onClick={() => onOpen?.(item.id)}>
          <div className="conn-name truncate">{t.text}</div>
          <div className="eyebrow">{catName(t.category)}{t.recurrence ? " \u00b7 " + t.recurrence : ""}</div>
        </div>
        {u && <span className={"urgency " + URGENCY_CLASS[u.kind]}>{u.label}</span>}
      </div>
    </div>
  );
}

export default function TasksPage({
  filter,
  counts,
  items,
  loading,
  today,
  onFilter,
  onToggle,
  onOpenTask,
  onDeleteTask,
  onNew,
}: {
  filter: TaskFilter;
  counts: Record<TaskFilter, number>;
  items: TaskItem[];
  loading?: boolean;
  today: string;
  onFilter?: (f: TaskFilter) => void;
  onToggle?: (id: string) => void;
  onOpenTask?: (id: string) => void;
  onDeleteTask?: (id: string) => void;
  onNew?: () => void;
}) {
  return (
    <div className="screen">
      <div className="nav-bar">
        <div className="nav-large">Tasks</div>
        <button className="nav-action" onClick={onNew} aria-label="New task">
          <Plus className="ic" />
        </button>
      </div>

      <div className="chip-row">
        {FILTERS.map((f) => (
          <button
            key={f}
            className={"chip" + (f === filter ? " active" : "")}
            onClick={() => onFilter?.(f)}
          >
            {FILTER_LABEL[f]} &middot; {counts[f]}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonRows />
      ) : items.length === 0 ? (
        <div className="empty-state">
          <div className="t-body">No {FILTER_LABEL[filter].toLowerCase()} tasks</div>
        </div>
      ) : (
        <div className="pad-x">
          <div className="card">
            {items.map((it) => (
              <Row key={it.id} item={it} today={today} onToggle={onToggle} onOpen={onOpenTask} onDelete={onDeleteTask} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
