import type { ReactNode } from "react";
import { CalendarDays, ListChecks, FolderKanban, User, Target } from "../../shared/icons";
import { Head, Card } from "../../settings/kit";
import type { QuickCreateKind } from "./QuickCreateSheet";

const NEW_ROW: Record<QuickCreateKind, { label: string; tone: string; glyph: ReactNode }> = {
  event: { label: "New Event", tone: "sky", glyph: <CalendarDays className="ic" /> },
  task: { label: "New Task", tone: "red", glyph: <ListChecks className="ic" /> },
  project: { label: "New Project", tone: "blue", glyph: <FolderKanban className="ic" /> },
  person: { label: "New Person", tone: "pink", glyph: <User className="ic" /> },
  goal: { label: "New Goal", tone: "green", glyph: <Target className="ic" /> },
};

// The row every section (and the empty state) ends on when create-and-link
// is wired up: same icon language as the section it sits in or joins, same
// row shape as everything else in this picker.
function NewRow({ kind, onCreateNew }: { kind: QuickCreateKind; onCreateNew: (kind: QuickCreateKind) => void }) {
  const r = NEW_ROW[kind];
  return (
    <div className="row" role="button" tabIndex={0} onClick={() => onCreateNew(kind)}>
      <div className={"proj-icon cat-bg-" + r.tone}>{r.glyph}</div>
      <div className="conn-name">{r.label}</div>
      <div className="chev"></div>
    </div>
  );
}

// Lists the user's real events, tasks, projects, people, and goals so a note
// can be linked to any of them. Tapping a row calls onPick with the entity's
// kind, label, and id (stored as a Connection with targetId for navigation).
// onCreateNew (optional so a caller that hasn't wired it up yet still gets
// the old, honest "nothing to link" state) makes a new one and links it in
// the same tap -- see QuickCreateSheet.
export default function LinkPicker({
  events = [],
  tasks = [],
  projects = [],
  people = [],
  goals = [],
  onPick,
  onCreateNew,
  onBack,
}: {
  events?: { id: string; title: string }[];
  tasks?: { id: string; text: string }[];
  projects?: { id: string; title: string }[];
  people?: { id: string; name: string }[];
  goals?: { id: string; title: string }[];
  onPick: (kind: string, label: string, targetId: string) => void;
  onCreateNew?: (kind: QuickCreateKind) => void;
  onBack?: () => void;
}) {
  const empty =
    events.length === 0 && tasks.length === 0 && projects.length === 0 &&
    people.length === 0 && goals.length === 0;

  return (
    <div className="screen ruled">
      <div className="nav-bar">
        <button className="nav-back" onClick={onBack}>Connections</button>
        <span className="nav-title"></span>
        <span></span>
      </div>
      <div className="nav-large">Add Link</div>

      {empty && onCreateNew && (
        // B14's real fix (LinkPicker catalog pick, 2026-09-0X): "Create
        // something first, link it here" was directions to a button on
        // another screen, which the app's own law calls illegal (see
        // MessagesFlow: "the empty state carries its action"). Now the
        // empty state IS the create button, for all five kinds at once.
        <>
          <Head label="Start Something New" />
          <Card>
            {(["event", "task", "project", "person", "goal"] as const).map((k) => (
              <NewRow key={k} kind={k} onCreateNew={onCreateNew} />
            ))}
          </Card>
        </>
      )}
      {empty && !onCreateNew && (
        <div className="pad-x"><div className="card list-card-ruled"><div className="empty-state">
          <div className="empty-title">Nothing to Link Yet</div>
          <div className="empty-sub">Tasks, events, projects, people and goals show up here</div>
          {onBack && <button className="btn btn-secondary" onClick={onBack}>Back to the Note</button>}
        </div></div></div>
      )}

      {events.length > 0 && (
        <>
          <Head label="Events" />
          <Card>
            {events.map((e) => (
              <div className="row" role="button" tabIndex={0} key={e.id} onClick={() => onPick("event", e.title, e.id)}>
                <div className="proj-icon cat-bg-sky"><CalendarDays className="ic" /></div>
                <div className="conn-name">{e.title}</div>
                <div className="chev"></div>
              </div>
            ))}
            {onCreateNew && <NewRow kind="event" onCreateNew={onCreateNew} />}
          </Card>
        </>
      )}

      {tasks.length > 0 && (
        <>
          <Head label="Tasks" />
          <Card>
            {tasks.map((t) => (
              <div className="row" role="button" tabIndex={0} key={t.id} onClick={() => onPick("task", t.text, t.id)}>
                <div className="proj-icon cat-bg-red"><ListChecks className="ic" /></div>
                <div className="conn-name">{t.text}</div>
                <div className="chev"></div>
              </div>
            ))}
            {onCreateNew && <NewRow kind="task" onCreateNew={onCreateNew} />}
          </Card>
        </>
      )}

      {projects.length > 0 && (
        <>
          <Head label="Projects" />
          <Card>
            {projects.map((p) => (
              <div className="row" role="button" tabIndex={0} key={p.id} onClick={() => onPick("project", p.title, p.id)}>
                <div className="proj-icon cat-bg-blue"><FolderKanban className="ic" /></div>
                <div className="conn-name">{p.title}</div>
                <div className="chev"></div>
              </div>
            ))}
            {onCreateNew && <NewRow kind="project" onCreateNew={onCreateNew} />}
          </Card>
        </>
      )}

      {people.length > 0 && (
        <>
          <Head label="People" />
          <Card>
            {people.map((p) => (
              <div className="row" role="button" tabIndex={0} key={p.id} onClick={() => onPick("person", p.name, p.id)}>
                <div className="proj-icon cat-bg-pink"><User className="ic" /></div>
                <div className="conn-name">{p.name}</div>
                <div className="chev"></div>
              </div>
            ))}
            {onCreateNew && <NewRow kind="person" onCreateNew={onCreateNew} />}
          </Card>
        </>
      )}

      {goals.length > 0 && (
        <>
          <Head label="Goals" />
          <Card>
            {goals.map((g) => (
              <div className="row" role="button" tabIndex={0} key={g.id} onClick={() => onPick("goal", g.title, g.id)}>
                <div className="proj-icon cat-bg-green"><Target className="ic" /></div>
                <div className="conn-name">{g.title}</div>
                <div className="chev"></div>
              </div>
            ))}
            {onCreateNew && <NewRow kind="goal" onCreateNew={onCreateNew} />}
          </Card>
        </>
      )}
    </div>
  );
}
