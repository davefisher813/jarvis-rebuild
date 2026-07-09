import { Tag, CalendarDays, ListChecks, ListTodo, Plus, X, FolderKanban, User, Target, Link2 as LinkIcon } from "lucide-react";
import { catColor } from "../../shared/categories";

type Conn = { id: string; kind: string; label: string; targetId?: string | null };

function connIcon(kind: string) {
  if (kind === "event") return { cls: "cat-bg-sky", node: <CalendarDays className="ic" /> };
  if (kind === "task") return { cls: "cat-bg-red", node: <ListChecks className="ic" /> };
  if (kind === "project") return { cls: "cat-bg-blue", node: <FolderKanban className="ic" /> };
  if (kind === "person") return { cls: "cat-bg-pink", node: <User className="ic" /> };
  if (kind === "goal") return { cls: "cat-bg-green", node: <Target className="ic" /> };
  return { cls: "cat-bg-graphite", node: <LinkIcon className="ic" /> };
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
  onOpen,
}: {
  category?: string;
  categoryLabel?: string;
  connections?: Conn[];
  onBack?: () => void;
  onAddLink?: () => void;
  onRemove?: (connId: string) => void;
  onCreateTasks?: () => void;
  onOpen?: (kind: string, targetId: string) => void;
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
            const canOpen = !!(onOpen && c.targetId && (c.kind === "task" || c.kind === "project" || c.kind === "event"));
            return (
              <div
                className="row"
                key={c.id}
                role={canOpen ? "button" : undefined}
                tabIndex={canOpen ? 0 : undefined}
                onClick={canOpen ? () => onOpen!(c.kind, c.targetId!) : undefined}
              >
                <div className={"proj-icon " + ic.cls}>{ic.node}</div>
                <div className="conn-name">{c.label}</div>
                {canOpen && <div className="chev"></div>}
                <button className="conn-remove" aria-label="Remove link" onClick={(e) => { e.stopPropagation(); onRemove?.(c.id); }}>
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
