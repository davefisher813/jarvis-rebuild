import { Tag, CalendarDays, ListChecks, ListTodo, Plus, X, Link2 } from "lucide-react";
import { catColor } from "../../shared/categories";

type Conn = { id: string; kind: string; label: string };

function connIcon(kind: string) {
  if (kind === "event") return { cls: "cat-bg-sky", node: <CalendarDays className="ic" /> };
  if (kind === "task") return { cls: "cat-bg-red", node: <ListChecks className="ic" /> };
  return { cls: "cat-bg-violet", node: <Link2 className="ic" /> };
}

// The note's real connections. The category is the note's own category (always
// shown); the rest are live links the user added, each removable. "Add link"
// opens a picker of the user's existing events and tasks.
export default function Connections({
  category = "health",
  categoryLabel = "Health",
  connections = [],
  onBack,
  onAddLink,
  onRemove,
  onCreateTasks,
}: {
  category?: string;
  categoryLabel?: string;
  connections?: Conn[];
  onBack?: () => void;
  onAddLink?: () => void;
  onRemove?: (connId: string) => void;
  onCreateTasks?: () => void;
}) {
  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" onClick={onBack}>Note</button>
        <span className="nav-title"></span>
        <span></span>
      </div>
      <div className="nav-large">Connections</div>

      <div className="grp">
        <div className="eyebrow">Linked To</div>
      </div>
      <div className="pad-x">
        <div className="card">
          <div className="row">
            <div className={"proj-icon cat-bg-" + catColor(category)}><Tag className="ic" /></div>
            <div className="conn-name">Category</div>
            <span className="conn-meta">{categoryLabel}</span>
          </div>
          {connections.map((c) => {
            const ic = connIcon(c.kind);
            return (
              <div className="row" key={c.id}>
                <div className={"proj-icon " + ic.cls}>{ic.node}</div>
                <div className="conn-name">{c.label}</div>
                <button className="conn-remove" aria-label="Remove link" onClick={() => onRemove?.(c.id)}>
                  <X className="ic" />
                </button>
              </div>
            );
          })}
          <div className="row" role="button" tabIndex={0} onClick={onAddLink}>
            <div className="proj-icon cat-bg-green"><Plus className="ic" /></div>
            <div className="conn-name">Add link</div>
            <div className="chev"></div>
          </div>
        </div>
      </div>

      <div className="grp">
        <div className="eyebrow">Actions</div>
      </div>
      <div className="pad-x">
        <div className="card">
          <div className="row" role="button" tabIndex={0} onClick={onCreateTasks}>
            <div className="proj-icon cat-bg-yellow"><ListTodo className="ic" /></div>
            <div className="conn-name">Create Tasks from Checklist</div>
            <div className="chev"></div>
          </div>
        </div>
      </div>
    </div>
  );
}
