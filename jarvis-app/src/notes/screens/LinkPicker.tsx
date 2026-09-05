import { useState, type ReactNode } from "react";
import { CalendarDays, ListChecks, FolderKanban, User, Target, Search } from "../../shared/icons";
import { Head, Card } from "../../settings/kit";
import type { QuickCreateKind } from "./QuickCreateSheet";
import { pressable } from "../../shared/pressable";
import ListFloor from "../../shared/ListFloor";

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
    <div className="row" {...pressable(() => onCreateNew(kind))}>
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
  eventsFloor,
}: {
  events?: { id: string; title: string }[];
  tasks?: { id: string; text: string }[];
  projects?: { id: string; title: string }[];
  people?: { id: string; name: string }[];
  goals?: { id: string; title: string }[];
  onPick: (kind: string, label: string, targetId: string) => void;
  onCreateNew?: (kind: QuickCreateKind) => void;
  onBack?: () => void;
  /** HMN-F-26: what the Events section is a window on, when it is one. */
  eventsFloor?: string;
}) {
  // HMN-F-26 (2026-09-05): this picker was built for a demo dataset and
  // listed every event ever, with no way to narrow it, so after a few months
  // the Events section was hundreds of rows to scroll past. The list's own
  // search bar, the same control on the same chassis, over all five kinds.
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const hit = (s: string) => !query || s.toLowerCase().includes(query);
  const empty =
    events.length === 0 && tasks.length === 0 && projects.length === 0 &&
    people.length === 0 && goals.length === 0;
  const ev = events.filter((e) => hit(e.title));
  const ts = tasks.filter((t) => hit(t.text));
  const pr = projects.filter((p) => hit(p.title));
  const pe = people.filter((p) => hit(p.name));
  const gl = goals.filter((g) => hit(g.title));
  const noMatch = !empty && ev.length + ts.length + pr.length + pe.length + gl.length === 0;

  return (
    <div className="screen ruled">
      <div className="nav-bar">
        <button className="nav-back" onClick={onBack}>Connections</button>
        <span className="nav-title"></span>
        <span></span>
      </div>
      <div className="nav-large">Add Link</div>

      {!empty && (
        <div className="sub-bar">
          <div className="search-bar">
            <Search className="ic" />
            <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      )}
      {noMatch && (
        <div className="pad-x"><div className="input-help">Nothing here matches that.</div></div>
      )}

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

      {ev.length > 0 && (
        <>
          <Head label="Events" />
          <Card>
            {ev.map((e) => (
              <div className="row" {...pressable(() => onPick("event", e.title, e.id))} key={e.id}>
                <div className="proj-icon cat-bg-sky"><CalendarDays className="ic" /></div>
                <div className="conn-name">{e.title}</div>
                <div className="chev"></div>
              </div>
            ))}
            {onCreateNew && <NewRow kind="event" onCreateNew={onCreateNew} />}
          </Card>
          {/* L2, every list has a floor: this section is a window on the
              calendar, not the whole archive, and it says which window. */}
          {eventsFloor && <ListFloor>{eventsFloor}</ListFloor>}
        </>
      )}

      {ts.length > 0 && (
        <>
          <Head label="Tasks" />
          <Card>
            {ts.map((t) => (
              <div className="row" {...pressable(() => onPick("task", t.text, t.id))} key={t.id}>
                <div className="proj-icon cat-bg-red"><ListChecks className="ic" /></div>
                <div className="conn-name">{t.text}</div>
                <div className="chev"></div>
              </div>
            ))}
            {onCreateNew && <NewRow kind="task" onCreateNew={onCreateNew} />}
          </Card>
        </>
      )}

      {pr.length > 0 && (
        <>
          <Head label="Projects" />
          <Card>
            {pr.map((p) => (
              <div className="row" {...pressable(() => onPick("project", p.title, p.id))} key={p.id}>
                <div className="proj-icon cat-bg-blue"><FolderKanban className="ic" /></div>
                <div className="conn-name">{p.title}</div>
                <div className="chev"></div>
              </div>
            ))}
            {onCreateNew && <NewRow kind="project" onCreateNew={onCreateNew} />}
          </Card>
        </>
      )}

      {pe.length > 0 && (
        <>
          <Head label="People" />
          <Card>
            {pe.map((p) => (
              <div className="row" {...pressable(() => onPick("person", p.name, p.id))} key={p.id}>
                <div className="proj-icon cat-bg-pink"><User className="ic" /></div>
                <div className="conn-name">{p.name}</div>
                <div className="chev"></div>
              </div>
            ))}
            {onCreateNew && <NewRow kind="person" onCreateNew={onCreateNew} />}
          </Card>
        </>
      )}

      {gl.length > 0 && (
        <>
          <Head label="Goals" />
          <Card>
            {gl.map((g) => (
              <div className="row" {...pressable(() => onPick("goal", g.title, g.id))} key={g.id}>
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
