import { useCallback, useMemo, useRef, useState } from "react";
import { Store, InMemoryAdapter } from "@core";
import { TasksService } from "../tasks/TasksService";
import { ScheduleService } from "../schedule/ScheduleService";
import { NotesService } from "../notes/NotesService";
import { CategoriesService } from "../categories/CategoriesService";
import { PeopleService } from "../people/PeopleService";
import { BrainDocService } from "../brain/docs/BrainDocService";
import { webProviders, nativeProviders } from "../connections/providers";
import { assembleContext, contextToText } from "../ai/context";
import { localParse, parseCapture, applyCapture } from "../ai/capture";
import { parseSuggestions } from "../ai/suggestions";
import { CHECKS } from "./checks";
import TabOrderList from "../more/TabOrderList";
import SkeletonRows from "../shared/SkeletonRows";
import type { Category } from "../categories/types";

const today = new Date().toISOString().slice(0, 10);

function Act({ label, prim, onClick }: { label: string; prim?: boolean; onClick: () => void }) {
  return <button className={"bench-act" + (prim ? " prim" : "")} onClick={onClick}>{label}</button>;
}

export default function TestBench() {
  const svc = useMemo(() => {
    const store = new Store(new InMemoryAdapter());
    return {
      store,
      tasks: new TasksService(store, "u"),
      schedule: new ScheduleService(store, "u"),
      notes: new NotesService(store, "u"),
      cats: new CategoriesService(store, "u"),
      people: new PeopleService(store, "u"),
      brain: new BrainDocService(store, "u"),
    };
  }, []);

  const [log, setLog] = useState<string[]>(["Bench ready. Click anything."]);
  const [snap, setSnap] = useState({ tasks: 0, events: 0, notes: 0, people: 0, cats: 0 });
  const say = useCallback((s: string) => setLog((l) => [s, ...l].slice(0, 14)), []);

  const [testing, setTesting] = useState(false);
  const [tabOrder, setTabOrder] = useState<string[]>(["today", "tasks", "schedule", "brain"]);
  const [fxDone, setFxDone] = useState(false);
  const [fxBurst, setFxBurst] = useState(false);
  const fxToggle = () => { const next = !fxDone; setFxDone(next); if (next) { setFxBurst(true); setTimeout(() => setFxBurst(false), 650); } };
  const testAll = useCallback(async () => {
    setTesting(true);
    setLog(["Running all checks..."]);
    let passed = 0;
    const lines: string[] = [];
    for (const c of CHECKS) {
      try { await c.run(); passed++; lines.push("PASS  " + c.group + " - " + c.name); }
      catch (e) { lines.push("FAIL  " + c.group + " - " + c.name + ": " + (e instanceof Error ? e.message : String(e))); }
    }
    const summary = passed === CHECKS.length ? `ALL PASS - ${passed}/${CHECKS.length}` : `${CHECKS.length - passed} FAILED - ${passed}/${CHECKS.length} passed`;
    setLog([summary, ...lines]);
    setTesting(false);
  }, []);

  const refresh = useCallback(async () => {
    const [t, e, n, p, c] = await Promise.all([svc.tasks.listTasks(), svc.schedule.listEvents(), svc.notes.listNotes(), svc.people.list(), svc.cats.list()]);
    setSnap({ tasks: t.length, events: e.length, notes: n.length, people: p.length, cats: c.length });
  }, [svc]);

  // inputs
  const taskText = useRef<HTMLInputElement>(null);
  const evtText = useRef<HTMLInputElement>(null);
  const noteText = useRef<HTMLInputElement>(null);
  const catText = useRef<HTMLInputElement>(null);
  const personText = useRef<HTMLInputElement>(null);
  const valuesText = useRef<HTMLTextAreaElement>(null);
  const capText = useRef<HTMLInputElement>(null);
  const sugText = useRef<HTMLInputElement>(null);

  const v = (r: React.RefObject<HTMLInputElement | HTMLTextAreaElement>, d = "") => (r.current?.value.trim() || d);

  return (
    <div className="screen">
      <div className="nav-large">Test Bench</div>
      <div className="test-summary">Tap buttons. Real engine + services run in your browser.</div>

      <div className="test-runbar">
        <button className="btn btn-primary btn-block" onClick={testAll} disabled={testing}>{testing ? "Running..." : "Test All"}</button>
        <button className="btn btn-secondary btn-block" onClick={() => { setLog(["Reset."]); location.reload(); }}>Reset everything</button>
      </div>

      <div className="sec-head"><div className="sec-left"><div className="sec-title">Output</div></div></div>
      <div className="pad-x"><div className="card"><div className="bench-log">{log.map((l, i) => <div className={"bench-line" + (l.startsWith("FAIL") ? " test-bad" : l.startsWith("PASS") || l.startsWith("ALL PASS") ? " test-ok" : "")} key={i}>{l}</div>)}</div></div></div>

      <div className="sec-head"><div className="sec-left"><div className="sec-title">Live data</div></div></div>
      <div className="pad-x"><div className="card"><div className="row"><div className="row-grow"><div className="conn-name">tasks {snap.tasks} · events {snap.events} · notes {snap.notes} · people {snap.people} · categories {snap.cats}</div></div></div></div></div>

      <div className="sec-head"><div className="sec-left"><div className="sec-title">Visual FX (new)</div></div></div>
      <div className="test-summary">Tap the circle to see the completion punch + flash. Tap any row to feel press feedback. Shimmer below is the loading skeleton.</div>
      <div className="pad-x"><div className="card">
        <div className={"task-row" + (fxDone ? " completed" : "") + (fxBurst ? " just-done" : "")}>
          <div className={"task-check " + (fxDone ? "done" : "cat-bd-blue")} onClick={fxToggle} role="checkbox" aria-checked={fxDone} />
          <div className="row-stack"><div className="conn-name">Tap the circle to complete</div><div className="eyebrow">Demo</div></div>
        </div>
      </div></div>
      <SkeletonRows />

      <div className="sec-head"><div className="sec-left"><div className="sec-title">Tab Reorder (drag test)</div></div></div>
      <div className="test-summary">Drag the grip handle on the right to reorder. Real TabOrderList component, same as Edit Tabs.</div>
      <div className="pad-x"><TabOrderList keys={tabOrder} onReorder={(next) => { setTabOrder(next); say("Reordered -> " + next.join(", ")); }} /></div>
      <div className="pad-x"><div className="card"><div className="row"><div className="row-grow"><div className="conn-name">Order: {tabOrder.join(" · ")}</div></div></div></div></div>

      <div className="sec-head"><div className="sec-left"><div className="sec-title">Tasks</div></div></div>
      <div className="pad-x"><div className="field"><input className="input" ref={taskText} placeholder="task text" defaultValue="Email Sam the Q3 plan" /></div>
        <div className="bench-btns">
          <Act prim label="Add task" onClick={async () => { await svc.tasks.createTask(v(taskText, "Untitled"), {}); say("Added task: " + v(taskText, "Untitled")); await refresh(); }} />
          <Act label="Complete first" onClick={async () => { const t = await svc.tasks.listTasks(); if (!t[0]) return say("No tasks."); await svc.tasks.toggleDone(t[0].id); say("Toggled done: " + t[0].data.text); }} />
          <Act label="List tasks" onClick={async () => { const t = await svc.tasks.listTasks(); say("Tasks: " + (t.map((x) => x.data.text + (x.data.done ? " [done]" : "")).join(", ") || "none")); }} />
        </div>
      </div>

      <div className="sec-head"><div className="sec-left"><div className="sec-title">Schedule</div></div></div>
      <div className="pad-x"><div className="field"><input className="input" ref={evtText} placeholder="event title" defaultValue="Strategy sync" /></div>
        <div className="bench-btns">
          <Act prim label="Add event 10:00 today" onClick={async () => { await svc.schedule.createEvent(v(evtText, "Event"), { date: today, start: "10:00" }); say("Added event: " + v(evtText, "Event") + " @ 10:00"); await refresh(); }} />
          <Act label="List today" onClick={async () => { const e = await svc.schedule.eventsOn(today); say("Today: " + (e.map((x) => x.data.start + " " + x.data.title).join(", ") || "none")); }} />
        </div>
      </div>

      <div className="sec-head"><div className="sec-left"><div className="sec-title">Notes</div></div></div>
      <div className="pad-x"><div className="field"><input className="input" ref={noteText} placeholder="note title" defaultValue="Partnership terms" /></div>
        <div className="bench-btns">
          <Act prim label="Add note" onClick={async () => { await svc.notes.createNote(v(noteText, "Note"), ""); say("Added note: " + v(noteText, "Note")); await refresh(); }} />
          <Act label="List notes" onClick={async () => { const n = await svc.notes.listNotes(); say("Notes: " + (n.map((x) => (x.data as { title?: string }).title || "Untitled").join(", ") || "none")); }} />
        </div>
      </div>

      <div className="sec-head"><div className="sec-left"><div className="sec-title">Categories</div></div></div>
      <div className="pad-x"><div className="field"><input className="input" ref={catText} placeholder="category name" defaultValue="Work" /></div>
        <div className="bench-btns">
          <Act prim label="Add category (blue)" onClick={async () => { await svc.cats.create(v(catText, "Cat"), "blue"); say("Added category: " + v(catText, "Cat")); await refresh(); }} />
          <Act label="List categories" onClick={async () => { const c = await svc.cats.list(); say("Categories: " + (c.map((x) => x.data.name).join(", ") || "none")); }} />
        </div>
      </div>

      <div className="sec-head"><div className="sec-left"><div className="sec-title">People (Inner Circle)</div></div></div>
      <div className="pad-x"><div className="field"><input className="input" ref={personText} placeholder="person name" defaultValue="Sam Rivera" /></div>
        <div className="bench-btns">
          <Act prim label="Add person" onClick={async () => { await svc.people.create({ name: v(personText, "Person"), group: "inner_circle" }); say("Added person: " + v(personText, "Person")); await refresh(); }} />
          <Act label="List inner circle" onClick={async () => { const p = await svc.people.list("inner_circle"); say("Inner circle: " + (p.map((x) => x.data.name).join(", ") || "none")); }} />
        </div>
      </div>

      <div className="sec-head"><div className="sec-left"><div className="sec-title">Brain doc (Values)</div></div></div>
      <div className="pad-x"><div className="field"><textarea className="input input-multiline" ref={valuesText} placeholder="your values" defaultValue="Family first. Move fast." /></div>
        <div className="bench-btns">
          <Act prim label="Save values" onClick={async () => { await svc.brain.save("values", v(valuesText)); say("Saved values."); }} />
          <Act label="Load values" onClick={async () => { say("Values: " + ((await svc.brain.get("values")) || "(empty)")); }} />
        </div>
      </div>

      <div className="sec-head"><div className="sec-left"><div className="sec-title">Quick Capture (local parser)</div></div></div>
      <div className="pad-x"><div className="field"><input className="input" ref={capText} placeholder="type a quick note" defaultValue="Lunch with Sam Thursday 1pm" /></div>
        <div className="bench-btns">
          <Act prim label="Parse" onClick={() => { const r = localParse(v(capText, " "), today); say("Parsed: " + r.kind + " | " + r.title + (r.date ? " | " + r.date : "") + (r.start ? " @ " + r.start : "")); }} />
          <Act label="Parse + file it" onClick={async () => { const r = localParse(v(capText, " "), today); const c = await svc.cats.list() as Category[]; await applyCapture(r, svc, c, today); say("Filed as " + r.kind + ": " + r.title); await refresh(); }} />
          <Act label="Parse JSON sample" onClick={() => { const r = parseCapture('{"kind":"event","title":"Standup","start":"09:00"}'); say(r ? "JSON parsed: " + r.kind + " | " + r.title : "JSON rejected"); }} />
        </div>
      </div>

      <div className="sec-head"><div className="sec-left"><div className="sec-title">JARVIS Suggestions (parser)</div></div></div>
      <div className="pad-x"><div className="field"><input className="input" ref={sugText} placeholder="JSON array of strings" defaultValue='["Email Sam","Call Maya"]' /></div>
        <div className="bench-btns">
          <Act prim label="Parse suggestions" onClick={() => { const r = parseSuggestions(v(sugText, "[]")); say("Suggestions (" + r.length + "): " + (r.join(" / ") || "none")); }} />
        </div>
      </div>

      <div className="sec-head"><div className="sec-left"><div className="sec-title">AI context + connections</div></div></div>
      <div className="pad-x">
        <div className="bench-btns">
          <Act prim label="Assemble context from current data" onClick={async () => {
            const [t, p, c] = await Promise.all([svc.tasks.listTasks(), svc.people.list(), svc.cats.list()]);
            const ctx = assembleContext({
              name: "Dave",
              people: p.map((x) => x.data.name),
              categories: c.map((x) => ({ name: x.data.name })),
              tasks: t.map((x) => ({ text: x.data.text, done: x.data.done, category: x.data.category })),
              values: (await svc.brain.get("values")) || undefined,
            });
            say("Context: " + contextToText(ctx).replace(/\n/g, " | "));
          }} />
          <Act label="Web sources" onClick={() => say("Web: " + webProviders().map((x) => x.label).join(", "))} />
          <Act label="Native sources" onClick={() => say("Native: " + nativeProviders().map((x) => x.label).join(", "))} />
        </div>
      </div>

      <div className="screen-foot" />
    </div>
  );
}
