import { useEffect, useMemo, useState } from "react";
import { useTasks, useSchedule, useNotes, usePeople } from "../data/NotesProvider";
import { runSearch, totalHits, type SearchInput } from "./search";
import { personInitials, slotForName } from "../people/types";

const MAG = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
);

export default function SearchFlow({ onClose }: { onClose: () => void }) {
  const tasks = useTasks();
  const schedule = useSchedule();
  const notes = useNotes();
  const people = usePeople();
  const [data, setData] = useState<SearchInput | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let on = true;
    (async () => {
      const [t, e, n, p] = await Promise.all([tasks.listTasks(), schedule.listEvents(), notes.listNotes(), people.list()]);
      if (on) setData({ tasks: t, events: e, notes: n, people: p });
    })();
    return () => { on = false; };
  }, [tasks, schedule, notes, people]);

  const results = useMemo(() => (data ? runSearch(q, data) : null), [q, data]);
  const empty = q.trim() === "";
  const none = !!results && !empty && totalHits(results) === 0;

  return (
    <div className="search-overlay">
      <div className="search-top">
        <div className="search-bar">{MAG}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search everything" autoFocus /></div>
        <button className="search-cancel" onClick={onClose}>Cancel</button>
      </div>

      <div className="search-results">
        {empty && <div className="empty-state"><div className="empty-icon">{MAG}</div><div className="empty-title">Search tasks, events, notes, and people</div></div>}
        {none && <div className="empty-state"><div className="empty-icon">{MAG}</div><div className="empty-title">No matches for &ldquo;{q.trim()}&rdquo;</div></div>}

        {results && !empty && results.events.length > 0 && (
          <>
            <div className="sec-head"><div className="sec-left"><div className="sec-title">Schedule</div></div></div>
            <div className="pad-x"><div className="card">
              {results.events.map((e) => (
                <div className="sched-row" key={e.id}><div className="sched-time">{e.start}</div><div className="sched-body"><div className="sched-title">{e.title}</div></div></div>
              ))}
            </div></div>
          </>
        )}

        {results && !empty && results.tasks.length > 0 && (
          <>
            <div className="sec-head"><div className="sec-left"><div className="sec-title">Tasks</div></div></div>
            <div className="pad-x"><div className="card">
              {results.tasks.map((t) => (
                <div className="row" key={t.id}><div className="row-grow"><div className="conn-name">{t.text}</div></div></div>
              ))}
            </div></div>
          </>
        )}

        {results && !empty && results.people.length > 0 && (
          <>
            <div className="sec-head"><div className="sec-left"><div className="sec-title">People</div></div></div>
            <div className="pad-x"><div className="card">
              {results.people.map((p) => (
                <div className="row" key={p.id}><div className={"av av-40 cat-bg-" + slotForName(p.name)}>{personInitials(p.name)}</div><div className="row-grow"><div className="conn-name">{p.name}</div></div></div>
              ))}
            </div></div>
          </>
        )}

        {results && !empty && results.notes.length > 0 && (
          <>
            <div className="sec-head"><div className="sec-left"><div className="sec-title">Notes</div></div></div>
            <div className="pad-x"><div className="card">
              {results.notes.map((n) => (
                <div className="row" key={n.id}><div className="row-grow"><div className="conn-name">{n.title}</div></div></div>
              ))}
            </div></div>
          </>
        )}
        <div className="screen-foot" />
      </div>
    </div>
  );
}
