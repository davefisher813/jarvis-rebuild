import { useState } from "react";
import { Tag, CalendarDays, ListChecks, ListTodo, Plus, X, FolderKanban, User, Target, Link2 as LinkIcon } from "../../shared/icons";
import { catColor } from "../../shared/categories";
import { Head, Card } from "../../settings/kit";

export type Conn = { id: string; kind: string; label: string; targetId?: string | null };

// Shared with NoteEditor's inline connection chips (Dave 2026-08-28, "very
// very easy to connect things"): one icon/color per kind, defined once so
// the chip strip under the title and the full Connections screen always
// agree on what a task/event/project/person/goal link looks like.
export function connIcon(kind: string) {
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
  onChangeCategory,
  categories = [],
}: {
  category?: string;
  categoryLabel?: string;
  connections?: Conn[];
  onBack?: () => void;
  onAddLink?: () => void;
  onRemove?: (connId: string) => void;
  onCreateTasks?: () => void;
  onOpen?: (kind: string, targetId: string) => void;
  onChangeCategory?: (categoryId: string) => void;
  categories?: { id: string; name: string }[];
}) {
  // The category row looked exactly like every other tappable row in the app
  // and did nothing at all. It is the note's most-used connection, so it opens
  // in place rather than pushing a screen for a one-tap choice.
  const [picking, setPicking] = useState(false);
  return (
    <div className="screen ruled">
      <div className="nav-bar">
        <button className="nav-back" onClick={onBack}>Note</button>
        <span className="nav-title"></span>
        <span></span>
      </div>
      <div className="nav-large">Connections</div>

      <Head label="Linked To" />
      <Card>
        <div
          className="row"
          role={onChangeCategory ? "button" : undefined}
          tabIndex={onChangeCategory ? 0 : undefined}
          onClick={onChangeCategory ? () => setPicking(!picking) : undefined}
        >
          <div className={"proj-icon cat-bg-" + catColor(category)}><Tag className="ic" /></div>
          <div className="conn-name">Area</div>
          <span className="conn-meta">{categoryLabel}</span>
          {onChangeCategory && <div className="chev"></div>}
        </div>
        {picking && categories.map((c) => (
          <div
            className="row conn-sub"
            role="button"
            tabIndex={0}
            key={c.id}
            onClick={() => { onChangeCategory?.(c.id); setPicking(false); }}
          >
            <div className={"proj-icon cat-bg-" + catColor(c.id)}><Tag className="ic" /></div>
            <div className="conn-name">{c.name}</div>
            {c.id === category && <span className="conn-meta">Current</span>}
          </div>
        ))}
        {connections.map((c) => {
          const ic = connIcon(c.kind);
          const canOpen = !!(onOpen && c.targetId && (c.kind === "task" || c.kind === "project" || c.kind === "event" || c.kind === "goal" || c.kind === "person"));
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
          <div className="conn-name">Add Link</div>
          <div className="chev"></div>
        </div>
      </Card>

      <Head label="Actions" />
      <Card>
        <div className="row" role="button" tabIndex={0} onClick={onCreateTasks}>
          <div className="proj-icon cat-bg-yellow"><ListTodo className="ic" /></div>
          <div className="conn-name">Create Tasks from Checklist</div>
          <div className="chev"></div>
        </div>
      </Card>
    </div>
  );
}
