import { CalendarDays, ListChecks } from "lucide-react";

// Lists the user's real events and open tasks so a note can be linked to one.
// Tapping a row calls onPick with the entity's kind, label, and id.
export default function LinkPicker({
  events = [],
  tasks = [],
  onPick,
  onBack,
}: {
  events?: { id: string; title: string }[];
  tasks?: { id: string; text: string }[];
  onPick: (kind: string, label: string, targetId: string) => void;
  onBack?: () => void;
}) {
  const empty = events.length === 0 && tasks.length === 0;
  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" onClick={onBack}>Connections</button>
        <span className="nav-title"></span>
        <span></span>
      </div>
      <div className="nav-large">Add Link</div>

      {empty && (
        <div className="pad-x"><div className="card"><div className="empty-state">
          <div className="empty-title">Nothing to link yet</div>
          <div className="empty-sub">Create an event or task first, then link it here.</div>
        </div></div></div>
      )}

      {events.length > 0 && (
        <>
          <div className="grp"><div className="eyebrow">Events</div></div>
          <div className="pad-x"><div className="card">
            {events.map((e) => (
              <div className="row" role="button" tabIndex={0} key={e.id} onClick={() => onPick("event", e.title, e.id)}>
                <div className="proj-icon cat-bg-sky"><CalendarDays className="ic" /></div>
                <div className="conn-name">{e.title}</div>
                <div className="chev"></div>
              </div>
            ))}
          </div></div>
        </>
      )}

      {tasks.length > 0 && (
        <>
          <div className="grp"><div className="eyebrow">Tasks</div></div>
          <div className="pad-x"><div className="card">
            {tasks.map((t) => (
              <div className="row" role="button" tabIndex={0} key={t.id} onClick={() => onPick("task", t.text, t.id)}>
                <div className="proj-icon cat-bg-red"><ListChecks className="ic" /></div>
                <div className="conn-name">{t.text}</div>
                <div className="chev"></div>
              </div>
            ))}
          </div></div>
        </>
      )}
    </div>
  );
}
