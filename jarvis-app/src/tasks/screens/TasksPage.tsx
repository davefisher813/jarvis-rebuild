import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import SkeletonRows from "../../shared/SkeletonRows";
import type { TaskItem } from "../TasksService";
import { urgencyFor, type UrgencyKind } from "../grouping";
import { FILTERS, FILTER_LABEL, type TaskFilter } from "../filters";
import { catColor, catName } from "../../shared/categories";

// Tasks page, approved design (catalog 20 in the canonical system): nav-large +
// add, filter chips with counts, two-line rows (category check + title +
// CATEGORY meta) with the due tag on the right as colored urgency text.

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
}: {
  item: TaskItem;
  today: string;
  onToggle?: (id: string) => void;
  onOpen?: (id: string) => void;
}) {
  const t = item.data;
  const u = urgencyFor(t, today);
  const prevDone = useRef(t.done);
  const [burst, setBurst] = useState(false);
  useEffect(() => {
    if (t.done && !prevDone.current) {
      setBurst(true);
      const id = setTimeout(() => setBurst(false), 650);
      prevDone.current = t.done;
      return () => clearTimeout(id);
    }
    prevDone.current = t.done;
  }, [t.done]);
  return (
    <div className={"task-row" + (t.done ? " completed" : "") + (burst ? " just-done" : "")}>
      <div
        className={"task-check " + (t.done ? "done" : "cat-bd-" + catColor(t.category))}
        onClick={(e) => { e.stopPropagation(); onToggle?.(item.id); }}
        role="checkbox"
        aria-checked={t.done}
      />
      <div className="row-stack" role="button" tabIndex={0} onClick={() => onOpen?.(item.id)}>
        <div className="conn-name truncate">{t.text}</div>
        <div className="eyebrow">{catName(t.category)}</div>
      </div>
      {u && <span className={"urgency " + URGENCY_CLASS[u.kind]}>{u.label}</span>}
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
              <Row key={it.id} item={it} today={today} onToggle={onToggle} onOpen={onOpenTask} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
