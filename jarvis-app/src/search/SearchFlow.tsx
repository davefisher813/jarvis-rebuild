import { useEffect, useMemo, useState } from "react";
import { useTasks, useSchedule, useNotes, usePeople, useProjects, useMoney, useGoals, useCategories } from "../data/NotesProvider";
import { runSearch, totalHits, buildSuggestionIndex, suggest, type SearchInput } from "./search";
import { personInitials, slotForName } from "../people/types";

const MAG = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
);

// onOpen (2026-08-09): a found thing must be one tap from being the OPEN
// thing. The overlay used to render every hit as an inert row, so the reward
// for a successful search was navigating there again by hand.
export default function SearchFlow({ onClose, onOpen }: { onClose: () => void; onOpen?: (kind: string, id: string) => void }) {
  const tasks = useTasks();
  const schedule = useSchedule();
  const notes = useNotes();
  const people = usePeople();
  const projects = useProjects();
  const money = useMoney();
  const goals = useGoals();
  const categories = useCategories();
  const [data, setData] = useState<SearchInput | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let on = true;
    (async () => {
      const [t, e, n, p, pr, ac, g, c] = await Promise.all([
        tasks.listTasks(), schedule.listEvents(), notes.listNotes(), people.list(),
        projects.list(), money.list(), goals.list(), categories.list(),
      ]);
      if (on) setData({ tasks: t, events: e, notes: n, people: p, projects: pr, accounts: ac, goals: g, categories: c });
    })();
    return () => { on = false; };
  }, [tasks, schedule, notes, people, projects, money, goals, categories]);

  const results = useMemo(() => (data ? runSearch(q, data) : null), [q, data]);
  const empty = q.trim() === "";
  const none = !!results && !empty && totalHits(results) === 0;

  // Word completions from the user's own content: typing "pho" offers
  // "photographer" if it exists anywhere searchable.
  const suggestionIndex = useMemo(() => (data ? buildSuggestionIndex(data) : []), [data]);
  const completions = useMemo(
    () => (empty ? [] : suggest(q, suggestionIndex)),
    [q, empty, suggestionIndex],
  );

  // Recent searches, device-local. A query is remembered when the overlay
  // closes after finding something; shown before you type.
  const RECENTS_KEY = "jarvis.recent-searches";
  const [recents, setRecents] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]") as string[]; } catch { return []; }
  });
  const close = () => {
    const query = q.trim();
    if (query && results && totalHits(results) > 0) {
      const next = [query, ...recents.filter((r) => r.toLowerCase() !== query.toLowerCase())].slice(0, 8);
      setRecents(next);
      try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    }
    onClose();
  };
  // Remember the query (it found something), close, go.
  const open = (kind: string, id: string) => { close(); onOpen?.(kind, id); };

  return (
    <div className="search-overlay">
      <div className="search-top">
        <div className="search-bar">{MAG}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search everything" autoFocus /></div>
        <button className="search-cancel" onClick={close}>Cancel</button>
      </div>

      {completions.length > 0 && (
        <div className="search-chips">
          {completions.map((c) => (
            <button className="search-chip" key={c} onClick={() => setQ(c)}>{c}</button>
          ))}
        </div>
      )}

      <div className="search-results">
        {empty && recents.length > 0 && (
          <>
            <div className="sec-head"><div className="sec-left"><div className="sec-title">Recent</div></div></div>
            <div className="pad-x"><div className="card">
              {recents.map((r) => (
                <div className="row" role="button" tabIndex={0} key={r} onClick={() => setQ(r)}>
                  <div className="conn-name">{r}</div>
                  <div className="chev"></div>
                </div>
              ))}
            </div></div>
          </>
        )}
        {empty && recents.length === 0 && <div className="empty-state"><div className="empty-icon">{MAG}</div><div className="empty-title">Search everything</div></div>}
        {none && <div className="empty-state"><div className="empty-icon">{MAG}</div><div className="empty-title">No matches for &ldquo;{q.trim()}&rdquo;</div></div>}

        {results && !empty && results.events.length > 0 && (
          <>
            <div className="sec-head"><div className="sec-left"><div className="sec-title">Schedule</div></div></div>
            <div className="pad-x"><div className="card">
              {results.events.map((e) => (
                <div className="sched-row" role="button" tabIndex={0} key={e.id} onClick={() => open("event", e.id)}><div className="sched-time">{e.start}</div><div className="sched-body"><div className="sched-title">{e.title}</div></div></div>
              ))}
            </div></div>
          </>
        )}

        {results && !empty && results.tasks.length > 0 && (
          <>
            <div className="sec-head"><div className="sec-left"><div className="sec-title">Tasks</div></div></div>
            <div className="pad-x"><div className="card">
              {results.tasks.map((t) => (
                <div className="row" role="button" tabIndex={0} key={t.id} onClick={() => open("task", t.id)}><div className="row-grow"><div className="conn-name">{t.text}</div></div><div className="chev"></div></div>
              ))}
            </div></div>
          </>
        )}

        {results && !empty && results.people.length > 0 && (
          <>
            <div className="sec-head"><div className="sec-left"><div className="sec-title">People</div></div></div>
            <div className="pad-x"><div className="card">
              {results.people.map((p) => (
                <div className="row" role="button" tabIndex={0} key={p.id} onClick={() => open("person", p.id)}><div className={"av av-40 cat-bg-" + slotForName(p.name)}>{personInitials(p.name)}</div><div className="row-grow"><div className="conn-name">{p.name}</div></div><div className="chev"></div></div>
              ))}
            </div></div>
          </>
        )}

        {results && !empty && results.notes.length > 0 && (
          <>
            <div className="sec-head"><div className="sec-left"><div className="sec-title">Notes</div></div></div>
            <div className="pad-x"><div className="card">
              {results.notes.map((n) => (
                <div className="row" role="button" tabIndex={0} key={n.id} onClick={() => open("note", n.id)}><div className="row-grow"><div className="conn-name">{n.title}</div></div><div className="chev"></div></div>
              ))}
            </div></div>
          </>
        )}
        {results && !empty && results.projects.length > 0 && (
          <>
            <div className="sec-head"><div className="sec-left"><div className="sec-title">Projects</div></div></div>
            <div className="pad-x"><div className="card">
              {results.projects.map((p) => (
                <div className="row" role="button" tabIndex={0} key={p.id} onClick={() => open("project", p.id)}><div className="row-grow"><div className="conn-name">{p.title}</div></div><div className="chev"></div></div>
              ))}
            </div></div>
          </>
        )}

        {results && !empty && results.goals.length > 0 && (
          <>
            <div className="sec-head"><div className="sec-left"><div className="sec-title">Goals</div></div></div>
            <div className="pad-x"><div className="card">
              {results.goals.map((g) => (
                <div className="row" role="button" tabIndex={0} key={g.id} onClick={() => open("goal", g.id)}><div className="row-grow"><div className="conn-name">{g.title}</div></div><div className="chev"></div></div>
              ))}
            </div></div>
          </>
        )}

        {results && !empty && results.accounts.length > 0 && (
          <>
            <div className="sec-head"><div className="sec-left"><div className="sec-title">Money</div></div></div>
            <div className="pad-x"><div className="card">
              {results.accounts.map((a) => (
                <div className="row" role="button" tabIndex={0} key={a.id} onClick={() => open("account", a.id)}><div className="row-grow"><div className="conn-name">{a.name}</div></div><div className="chev"></div></div>
              ))}
            </div></div>
          </>
        )}

        {results && !empty && results.categories.length > 0 && (
          <>
            <div className="sec-head"><div className="sec-left"><div className="sec-title">Categories</div></div></div>
            <div className="pad-x"><div className="card">
              {results.categories.map((c) => (
                <div className="row" role="button" tabIndex={0} key={c.id} onClick={() => open("category", c.id)}><div className="row-grow"><div className="conn-name">{c.name}</div></div><div className="chev"></div></div>
              ))}
            </div></div>
          </>
        )}
        <div className="screen-foot" />
      </div>
    </div>
  );
}
