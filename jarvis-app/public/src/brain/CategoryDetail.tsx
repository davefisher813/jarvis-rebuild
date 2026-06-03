import { useEffect, useState } from "react";
import { useTasks, useSchedule, useNotes } from "../data/NotesProvider";
import type { ColorSlot } from "../categories/types";
import type { NoteData } from "../notes/types";

const BACK = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
);

interface Lists {
  tasks: string[];
  events: { start: string; title: string }[];
  notes: string[];
}

// Read-only overview: everything tagged with one category, in one place.
export default function CategoryDetail({
  categoryId,
  name,
  color,
  onBack,
}: {
  categoryId: string;
  name: string;
  color: ColorSlot;
  onBack: () => void;
}) {
  const tasks = useTasks();
  const schedule = useSchedule();
  const notes = useNotes();
  const [data, setData] = useState<Lists | null>(null);

  useEffect(() => {
    let on = true;
    (async () => {
      const [tk, ev, nt] = await Promise.all([tasks.listTasks(), schedule.listEvents(), notes.listNotes()]);
      if (!on) return;
      setData({
        tasks: tk.filter((t) => t.data.category === categoryId && !t.data.done).map((t) => t.data.text),
        events: ev
          .filter((e) => e.data.category === categoryId)
          .map((e) => ({ start: e.data.start, title: e.data.title }))
          .sort((a, b) => a.start.localeCompare(b.start)),
        notes: nt
          .filter((n) => (n.data as unknown as NoteData).category === categoryId)
          .map((n) => (n.data as unknown as NoteData).title || "Untitled"),
      });
    })();
    return () => { on = false; };
  }, [tasks, schedule, notes, categoryId]);

  const empty = data && data.tasks.length === 0 && data.events.length === 0 && data.notes.length === 0;

  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title"><span className={"cat-dot cat-bg-" + color} /> {name}</div>
      </div>

      {empty && <div className="empty-state"><div className="empty-title">Nothing tagged {name} yet</div></div>}

      {data && data.tasks.length > 0 && (
        <>
          <div className="grp"><div className="eyebrow">Tasks</div></div>
          <div className="pad-x"><div className="card">
            {data.tasks.map((t, i) => (
              <div className="row" key={"t" + i}><span className={"cat-dot cat-bg-" + color} /><div className="row-grow"><div className="conn-name">{t}</div></div></div>
            ))}
          </div></div>
        </>
      )}

      {data && data.events.length > 0 && (
        <>
          <div className="grp"><div className="eyebrow">Schedule</div></div>
          <div className="pad-x"><div className="card">
            {data.events.map((e, i) => (
              <div className="row" key={"e" + i}><span className="kv-val cat-time">{e.start}</span><div className="row-grow"><div className="conn-name">{e.title}</div></div></div>
            ))}
          </div></div>
        </>
      )}

      {data && data.notes.length > 0 && (
        <>
          <div className="grp"><div className="eyebrow">Notes</div></div>
          <div className="pad-x"><div className="card">
            {data.notes.map((n, i) => (
              <div className="row" key={"n" + i}><div className="row-grow"><div className="conn-name">{n}</div></div></div>
            ))}
          </div></div>
        </>
      )}
    </div>
  );
}
