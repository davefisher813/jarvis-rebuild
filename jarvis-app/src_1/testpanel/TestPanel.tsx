import { useEffect, useState, useCallback } from "react";
import { Store, InMemoryAdapter } from "@core";
import { TasksService } from "../tasks/TasksService";
import { ScheduleService } from "../schedule/ScheduleService";
import { NotesService } from "../notes/NotesService";
import { CategoriesService } from "../categories/CategoriesService";
import { ProfileService } from "../profile/ProfileService";
import { PeopleService } from "../people/PeopleService";
import { BrainDocService } from "../brain/docs/BrainDocService";
import { personInitials, slotForName } from "../people/types";
import { PROVIDERS, webProviders, nativeProviders, isConnected } from "../connections/providers";
import { EMPTY_PROFILE } from "../profile/types";
import { assembleContext } from "../ai/context";
import { parseCapture, localParse, applyCapture } from "../ai/capture";
import { parseSuggestions } from "../ai/suggestions";
import type { Category } from "../categories/types";

function ok(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function eq(a: unknown, b: unknown, msg: string) { if (a !== b) throw new Error(`${msg} (got ${JSON.stringify(a)})`); }
const store = () => new Store(new InMemoryAdapter());

interface T { group: string; name: string; run: () => Promise<void> | void; }

const TESTS: T[] = [
  { group: "Engine", name: "create then read returns the data", run: async () => {
    const s = store(); const id = await s.create("u", "task", { text: "x" } as never);
    const it = await s.read("u", id); ok(!!it, "no item"); eq((it!.data as { text: string }).text, "x", "data");
  } },
  { group: "Engine", name: "update merges a partial patch", run: async () => {
    const s = store(); const id = await s.create("u", "task", { text: "x", done: false } as never);
    await s.update("u", id, { done: true } as never); const it = await s.read("u", id);
    eq((it!.data as { text: string }).text, "x", "kept text"); eq((it!.data as { done: boolean }).done, true, "merged done");
  } },
  { group: "Engine", name: "delete removes the item", run: async () => {
    const s = store(); const id = await s.create("u", "task", { text: "x" } as never);
    await s.delete("u", id); eq(await s.read("u", id), null, "still present");
  } },

  { group: "Tasks", name: "create, list, and tag a task", run: async () => {
    const t = new TasksService(store(), "u"); await t.createTask("Email Sam", { category: "c1" });
    const list = await t.listTasks(); eq(list.length, 1, "count"); eq(list[0]!.data.category, "c1", "category");
  } },
  { group: "Tasks", name: "toggle done flips state", run: async () => {
    const t = new TasksService(store(), "u"); const id = (await t.listTasks(), await t.createTask("x", {}));
    await t.toggleDone(id!); eq((await t.listTasks())[0]!.data.done, true, "done");
  } },

  { group: "Schedule", name: "create and list an event", run: async () => {
    const sc = new ScheduleService(store(), "u"); await sc.createEvent("Sync", { date: "2026-05-24", start: "10:00" });
    eq((await sc.listEvents()).length, 1, "count");
  } },
  { group: "Schedule", name: "eventsOn filters by date", run: async () => {
    const sc = new ScheduleService(store(), "u");
    await sc.createEvent("A", { date: "2026-05-24", start: "10:00" });
    await sc.createEvent("B", { date: "2026-05-25", start: "10:00" });
    eq((await sc.eventsOn("2026-05-24")).length, 1, "filtered");
  } },

  { group: "Notes", name: "create and list a note", run: async () => {
    const n = new NotesService(store(), "u"); await n.createNote("Idea", "");
    eq((await n.listNotes()).length, 1, "count");
  } },

  { group: "Categories", name: "create and list", run: async () => {
    const c = new CategoriesService(store(), "u"); await c.create("Work", "blue");
    eq((await c.list()).length, 1, "count");
  } },
  { group: "Categories", name: "update merges fields", run: async () => {
    const c = new CategoriesService(store(), "u"); const id = await c.create("Work", "blue");
    await c.update(id!, { name: "Job" }); const list = await c.list();
    eq(list[0]!.data.name, "Job", "name"); eq(list[0]!.data.color, "blue", "color kept");
  } },

  { group: "Profile", name: "onboarded flips after save", run: async () => {
    const p = new ProfileService(store(), "u"); eq(await p.isOnboarded(), false, "starts false");
    await p.save({ name: "Dave", onboarded: true }); eq(await p.isOnboarded(), true, "now true");
    eq((await p.get())!.name, "Dave", "name saved");
  } },

  { group: "People", name: "create, list by group, update, remove", run: async () => {
    const pe = new PeopleService(store(), "u");
    const id = await pe.create({ name: "Sam Rivera", group: "inner_circle" });
    await pe.create({ name: "Dev", group: "contacts" });
    eq((await pe.list("inner_circle")).length, 1, "group filter");
    await pe.update(id!, { notes: "texts" }); eq((await pe.get(id!))!.data.notes, "texts", "update");
    await pe.remove(id!); eq((await pe.list("inner_circle")).length, 0, "removed");
  } },
  { group: "People", name: "initials and stable color", run: () => {
    eq(personInitials("Sam Rivera"), "SR", "initials"); eq(slotForName("Sam Rivera"), slotForName("Sam Rivera"), "stable");
  } },

  { group: "Brain docs", name: "one record per topic, read back", run: async () => {
    const b = new BrainDocService(store(), "u"); await b.save("values", "Family."); await b.save("values", "Family first.");
    eq(await b.get("values"), "Family first.", "latest");
  } },

  { group: "Connections", name: "web vs native split", run: () => {
    ok(webProviders().some((p) => p.key === "gmail"), "gmail web");
    ok(nativeProviders().some((p) => p.key === "appleHealth"), "health native");
    ok(PROVIDERS.length >= 5, "registry populated");
  } },
  { group: "Connections", name: "status reads map + legacy flag", run: () => {
    eq(isConnected({ ...EMPTY_PROFILE, gmail: true }, "gmail"), true, "legacy");
    eq(isConnected({ ...EMPTY_PROFILE, connections: { appleMusic: true } }, "appleMusic"), true, "map");
  } },

  { group: "AI context", name: "assembler excludes done tasks, keeps voice", run: () => {
    const ctx = assembleContext({ tasks: [{ text: "a", done: false }, { text: "b", done: true }], voice: "Short and direct" });
    eq(ctx.openTasks.length, 1, "open only"); eq(ctx.openTasks[0], "a", "right task"); eq(ctx.voice, "Short and direct", "voice");
  } },

  { group: "Quick Capture", name: "parse plain, fenced, and reject junk", run: () => {
    eq(parseCapture('{"kind":"event","title":"x"}')!.kind, "event", "plain");
    eq(parseCapture('```json\n{"kind":"task","title":"y"}\n```')!.title, "y", "fenced");
    eq(parseCapture("hello"), null, "junk null");
  } },
  { group: "Quick Capture", name: "local heuristic routes time vs plain", run: () => {
    eq(localParse("Lunch Thursday 1pm", "2026-05-24").kind, "event", "event");
    eq(localParse("Lunch Thursday 1pm", "2026-05-24").start, "13:00", "time");
    eq(localParse("Renew domain", "2026-05-24").kind, "task", "task");
  } },
  { group: "Quick Capture", name: "apply files the right entity + category", run: async () => {
    const s = store();
    const tasks = new TasksService(s, "u"), schedule = new ScheduleService(s, "u"), notes = new NotesService(s, "u");
    const cats: Category[] = [{ id: "c1", data: { name: "Work", color: "blue", order: 0 } }];
    await applyCapture({ kind: "task", title: "Email", category: "Work" }, { tasks, schedule, notes }, cats, "2026-05-24");
    await applyCapture({ kind: "event", title: "Sync", start: "09:00" }, { tasks, schedule, notes }, cats, "2026-05-24");
    await applyCapture({ kind: "note", title: "Idea" }, { tasks, schedule, notes }, cats, "2026-05-24");
    eq((await tasks.listTasks())[0]!.data.category, "c1", "task category");
    eq((await schedule.listEvents()).length, 1, "event"); eq((await notes.listNotes()).length, 1, "note");
  } },

  { group: "JARVIS Suggestions", name: "parse array, fenced, cap 2, reject junk", run: () => {
    eq(JSON.stringify(parseSuggestions('["a","b"]')), '["a","b"]', "array");
    eq(parseSuggestions('```json\n["a","b","c"]\n```').length, 2, "cap 2");
    eq(parseSuggestions("nope").length, 0, "junk empty");
  } },
];

const CHECK = <svg className="test-ico test-ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>;
const CROSS = <svg className="test-ico test-bad" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;

interface Result { group: string; name: string; pass: boolean; error?: string; }

export default function TestPanel() {
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState(false);

  const runAll = useCallback(async () => {
    setRunning(true);
    setResults([]);
    const out: Result[] = [];
    for (const t of TESTS) {
      try { await t.run(); out.push({ group: t.group, name: t.name, pass: true }); }
      catch (e) { out.push({ group: t.group, name: t.name, pass: false, error: e instanceof Error ? e.message : String(e) }); }
      setResults([...out]);
    }
    setRunning(false);
  }, []);

  useEffect(() => { void runAll(); }, [runAll]);

  const passed = results.filter((r) => r.pass).length;
  const total = TESTS.length;
  const done = results.length === total && !running;
  const allPass = done && passed === total;
  const groups = [...new Set(TESTS.map((t) => t.group))];

  return (
    <div className="screen">
      <div className="nav-large">Functionality Test</div>
      <div className={"test-summary " + (running ? "" : allPass ? "test-ok" : passed < total ? "test-bad" : "")}>
        {running ? `Running... ${results.length} / ${total}` : `${passed} / ${total} passed`}
      </div>
      <div className="test-runbar">
        <button className="btn btn-primary btn-block" onClick={runAll} disabled={running}>{running ? "Running..." : "Run Again"}</button>
      </div>
      {groups.map((g) => {
        const rows = results.filter((r) => r.group === g);
        if (rows.length === 0) return null;
        return (
          <div key={g}>
            <div className="sec-head"><div className="sec-left"><div className="sec-title">{g}</div></div></div>
            <div className="pad-x"><div className="card">
              {rows.map((r, i) => (
                <div className="row" key={i}>
                  {r.pass ? CHECK : CROSS}
                  <div className="row-grow"><div className="conn-name">{r.name}</div>{!r.pass && r.error && <div className="test-err">{r.error}</div>}</div>
                </div>
              ))}
            </div></div>
          </div>
        );
      })}
      <div className="screen-foot" />
    </div>
  );
}
