import { Store, InMemoryAdapter } from "@core";
import { TasksService } from "../tasks/TasksService";
import { ScheduleService } from "../schedule/ScheduleService";
import { NotesService } from "../notes/NotesService";
import { CategoriesService } from "../categories/CategoriesService";
import { ProfileService } from "../profile/ProfileService";
import { PeopleService } from "../people/PeopleService";
import { BrainDocService } from "../brain/docs/BrainDocService";
import { AreaService } from "../life/AreaService";
import { GoalService } from "../life/GoalService";
import { ProjectsService } from "../projects/ProjectsService";
import { buildFeed } from "../notifications/feed";
import { MoneyService } from "../money/MoneyService";
import { BackupService } from "../backup/BackupService";
import { totalBalance } from "../money/types";
import { weekDates, openTasksByArea } from "../insights/insights";
import { personInitials, slotForName } from "../people/types";
import { PROVIDERS, webProviders, nativeProviders, isConnected } from "../connections/providers";
import { EMPTY_PROFILE } from "../profile/types";
import { assembleContext } from "../ai/context";
import { parseCapture, localParse, applyCapture } from "../ai/capture";
import { parseSuggestions } from "../ai/suggestions";
import type { Category } from "../categories/types";

function ok(c: boolean, m: string) { if (!c) throw new Error(m); }
function eq(a: unknown, b: unknown, m: string) { if (a !== b) throw new Error(`${m} (got ${JSON.stringify(a)})`); }
const store = () => new Store(new InMemoryAdapter());

export interface Check { group: string; name: string; run: () => Promise<void> | void; }

export const CHECKS: Check[] = [
  { group: "Engine", name: "create then read", run: async () => { const s = store(); const id = await s.create("u", "task", { text: "x" } as never); eq(((await s.read("u", id))!.data as { text: string }).text, "x", "data"); } },
  { group: "Engine", name: "update merges patch", run: async () => { const s = store(); const id = await s.create("u", "task", { text: "x", done: false } as never); await s.update("u", id, { done: true } as never); const it = await s.read("u", id); eq((it!.data as { text: string }).text, "x", "kept"); eq((it!.data as { done: boolean }).done, true, "merged"); } },
  { group: "Engine", name: "delete removes", run: async () => { const s = store(); const id = await s.create("u", "task", { text: "x" } as never); await s.delete("u", id); eq(await s.read("u", id), null, "gone"); } },
  { group: "Tasks", name: "create, list, tag", run: async () => { const t = new TasksService(store(), "u"); await t.createTask("Email Sam", { category: "c1" }); const l = await t.listTasks(); eq(l.length, 1, "count"); eq(l[0]!.data.category, "c1", "cat"); } },
  { group: "Tasks", name: "toggle done", run: async () => { const t = new TasksService(store(), "u"); const id = await t.createTask("x", {}); await t.toggleDone(id!); eq((await t.listTasks())[0]!.data.done, true, "done"); } },
  { group: "Schedule", name: "create + list", run: async () => { const s = new ScheduleService(store(), "u"); await s.createEvent("Sync", { date: "2026-05-24", start: "10:00" }); eq((await s.listEvents()).length, 1, "count"); } },
  { group: "Schedule", name: "eventsOn filters", run: async () => { const s = new ScheduleService(store(), "u"); await s.createEvent("A", { date: "2026-05-24", start: "10:00" }); await s.createEvent("B", { date: "2026-05-25", start: "10:00" }); eq((await s.eventsOn("2026-05-24")).length, 1, "filtered"); } },
  { group: "Notes", name: "create + list", run: async () => { const n = new NotesService(store(), "u"); await n.createNote("Idea", ""); eq((await n.listNotes()).length, 1, "count"); } },
  { group: "Categories", name: "create + list", run: async () => { const c = new CategoriesService(store(), "u"); await c.create("Work", "blue"); eq((await c.list()).length, 1, "count"); } },
  { group: "Categories", name: "update merges", run: async () => { const c = new CategoriesService(store(), "u"); const id = await c.create("Work", "blue"); await c.update(id!, { name: "Job" }); const l = await c.list(); eq(l[0]!.data.name, "Job", "name"); eq(l[0]!.data.color, "blue", "color kept"); } },
  { group: "Profile", name: "onboarded flips", run: async () => { const p = new ProfileService(store(), "u"); eq(await p.isOnboarded(), false, "false"); await p.save({ name: "Dave", onboarded: true }); eq(await p.isOnboarded(), true, "true"); eq((await p.get())!.name, "Dave", "name"); } },
  { group: "People", name: "CRUD by group", run: async () => { const pe = new PeopleService(store(), "u"); const id = await pe.create({ name: "Sam Rivera", group: "inner_circle" }); await pe.create({ name: "Dev", group: "contacts" }); eq((await pe.list("inner_circle")).length, 1, "filter"); await pe.update(id!, { notes: "t" }); eq((await pe.get(id!))!.data.notes, "t", "update"); await pe.remove(id!); eq((await pe.list("inner_circle")).length, 0, "removed"); } },
  { group: "People", name: "initials + stable color", run: () => { eq(personInitials("Sam Rivera"), "SR", "initials"); eq(slotForName("Sam Rivera"), slotForName("Sam Rivera"), "stable"); } },
  { group: "Brain docs", name: "one per topic", run: async () => { const b = new BrainDocService(store(), "u"); await b.save("values", "A"); await b.save("values", "B"); eq(await b.get("values"), "B", "latest"); } },
  { group: "Connections", name: "web vs native", run: () => { ok(webProviders().some((p) => p.key === "gmail"), "gmail"); ok(nativeProviders().some((p) => p.key === "appleHealth"), "health"); ok(PROVIDERS.length >= 5, "registry"); } },
  { group: "Connections", name: "status map + legacy", run: () => { eq(isConnected({ ...EMPTY_PROFILE, gmail: true }, "gmail"), true, "legacy"); eq(isConnected({ ...EMPTY_PROFILE, connections: { appleMusic: true } }, "appleMusic"), true, "map"); } },
  { group: "AI context", name: "open tasks + voice", run: () => { const c = assembleContext({ tasks: [{ text: "a", done: false }, { text: "b", done: true }], voice: "Short" }); eq(c.openTasks.length, 1, "open"); eq(c.openTasks[0], "a", "task"); eq(c.voice, "Short", "voice"); } },
  { group: "Quick Capture", name: "parse json/fenced/junk", run: () => { eq(parseCapture('{"kind":"event","title":"x"}')!.kind, "event", "json"); eq(parseCapture('```json\n{"kind":"task","title":"y"}\n```')!.title, "y", "fenced"); eq(parseCapture("nope"), null, "junk"); } },
  { group: "Quick Capture", name: "local routes time/plain", run: () => { eq(localParse("Lunch Thursday 1pm", "2026-05-24").kind, "event", "event"); eq(localParse("Lunch Thursday 1pm", "2026-05-24").start, "13:00", "time"); eq(localParse("Renew domain", "2026-05-24").kind, "task", "task"); } },
  { group: "Quick Capture", name: "apply files entity + category", run: async () => { const s = store(); const tasks = new TasksService(s, "u"), schedule = new ScheduleService(s, "u"), notes = new NotesService(s, "u"); const cats: Category[] = [{ id: "c1", data: { name: "Work", color: "blue", order: 0 } }]; await applyCapture({ kind: "task", title: "Email", category: "Work" }, { tasks, schedule, notes }, cats, "2026-05-24"); await applyCapture({ kind: "event", title: "Sync", start: "09:00" }, { tasks, schedule, notes }, cats, "2026-05-24"); await applyCapture({ kind: "note", title: "Idea" }, { tasks, schedule, notes }, cats, "2026-05-24"); eq((await tasks.listTasks())[0]!.data.category, "c1", "cat"); eq((await schedule.listEvents()).length, 1, "event"); eq((await notes.listNotes()).length, 1, "note"); } },
  { group: "Life Map", name: "areas + goals CRUD", run: async () => { const s = store(); const a = new AreaService(s, "u"), g = new GoalService(s, "u"); const id = await a.create({ name: "Health", state: "strong" }); await g.create({ title: "Run", state: "on_track", areaId: id! }); eq((await a.list()).length, 1, "area"); eq((await g.list())[0]!.data.state, "on_track", "goal"); await a.update(id!, { state: "drifting" }); eq((await a.get(id!))!.data.state, "drifting", "area update"); } },
  { group: "Projects", name: "create, active sorts first, update", run: async () => { const p = new ProjectsService(store(), "u"); await p.create({ title: "Old", status: "done" }); const id = await p.create({ title: "Q3", status: "active" }); eq((await p.list())[0]!.data.title, "Q3", "active first"); await p.update(id!, { status: "on_hold" }); eq((await p.get(id!))!.data.status, "on_hold", "update"); } },
  { group: "Insights", name: "week Monday-anchored; tasks-by-area counts", run: () => {
      const w = weekDates("2026-05-24"); eq(w[0], "2026-05-18", "monday"); eq(w.length, 7, "7 days");
      const bars = openTasksByArea([{ id: "1", data: { text: "a", category: "c1", done: false, due: null } }], [{ id: "c1", name: "Work", slot: "blue" }]);
      eq(bars[0]!.value, 1, "one open task"); } },
  { group: "Money", name: "totals balances incl. negative", run: async () => { const m = new MoneyService(store(), "u"); await m.create({ name: "A", balance: 1000, kind: "cash" }); await m.create({ name: "B", balance: -250, kind: "credit" }); eq(totalBalance(await m.list()), 750, "total"); } },
  { group: "Notifications", name: "overdue before due-today; done excluded", run: () => {
      const feed = buildFeed({ tasks: [ { id: "1", data: { text: "A", category: "", done: false, due: "2026-01-01" } }, { id: "2", data: { text: "B", category: "", done: false, due: "2026-05-24" } } ], events: [], goals: [], areas: [] }, "2026-05-24");
      eq(feed[0]!.kind, "overdue", "overdue first"); eq(feed[1]!.kind, "due_today", "due today second"); } },
  { group: "JARVIS Suggestions", name: "parse array/cap2/junk", run: () => { eq(JSON.stringify(parseSuggestions('["a","b"]')), '["a","b"]', "array"); eq(parseSuggestions('```json\n["a","b","c"]\n```').length, 2, "cap2"); eq(parseSuggestions("no").length, 0, "junk"); } },
  { group: "Backup", name: "export then import round-trips", run: async () => { const a = store(); await a.create("u", "task", { text: "x" } as never); const b = await new BackupService(a, "u").exportBundle(); eq(b.items.length, 1, "export"); const s2 = store(); const n = await new BackupService(s2, "u2").importBundle(b); eq(n, 1, "import count"); eq((await s2.listForUser("u2")).length, 1, "restored"); } },
];
