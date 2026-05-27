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
import { createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import VoiceBar from "../shell/VoiceBar";
import MessagesFlow from "../messages/MessagesFlow";
import Connections from "../notes/screens/Connections";
import LinkPicker from "../notes/screens/LinkPicker";
import { mapGoogleEvent, mapGmailMessage } from "../connections/google/map";
import { importCalendar } from "../connections/google/sync";
import { mapInboxMessage, mapGmailFull, buildReply, encodeEmail } from "../connections/google/map";
import { makeSampleAdminSource, createAdminApi } from "../admin/AdminService";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { googleConfigured } from "../connections/google/config";

function ok(c: boolean, m: string) { if (!c) throw new Error(m); }
function eq(a: unknown, b: unknown, m: string) { if (a !== b) throw new Error(`${m} (got ${JSON.stringify(a)})`); }
const store = () => new Store(new InMemoryAdapter());

// Mounts a component into a real (detached) DOM node and renders synchronously,
// so UI checks can assert on what the user actually sees. Browser/jsdom only.
function mount(el: ReactElement) {
  const div = document.createElement("div");
  document.body.appendChild(div);
  const root = createRoot(div);
  flushSync(() => root.render(el));
  return {
    div,
    text: () => div.textContent || "",
    unmount: () => { flushSync(() => root.unmount()); div.remove(); },
  };
}

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
  { group: "UI", name: "Voice bar opens capture, no fake voice", run: () => {
      let tapped = 0;
      const m = mount(createElement(VoiceBar, { onTap: () => { tapped++; } }));
      const btn = m.div.querySelector("button")!;
      ok(!!btn, "button rendered");
      eq(btn.getAttribute("aria-label"), "Quick capture", "honest aria");
      ok(!/talk|voice|speak|microphone/i.test(btn.textContent || ""), "no voice wording");
      btn.click();
      eq(tapped, 1, "tap opens capture");
      m.unmount(); } },
  { group: "UI", name: "Messages shows coming-soon, no demo rows", run: () => {
      const m = mount(createElement(MessagesFlow));
      ok(m.text().includes("Coming soon"), "coming-soon shown");
      eq(m.div.querySelectorAll(".msg-row").length, 0, "no fabricated rows");
      m.unmount(); } },
  { group: "UI", name: "Note Connections renders real link + add/remove", run: () => {
      const m = mount(createElement(Connections, { category: "health", categoryLabel: "Health", connections: [{ id: "c1", kind: "event", label: "Kickoff" }] }));
      ok(m.text().includes("Health"), "real category shown");
      ok(m.text().includes("Kickoff"), "real link shown");
      ok(m.text().includes("Add link"), "add-link affordance");
      ok(!!m.div.querySelector('[aria-label="Remove link"]'), "remove affordance");
      ok(!m.text().includes("Long Run Sunday"), "no fabricated event");
      m.unmount(); } },
  { group: "Note linking", name: "add link (targetId) persists, then remove", run: async () => {
      const svc = new NotesService(store(), "u");
      const noteId = (await svc.createNote("Plan", "c1"))!;
      const connId = (await svc.addConnection(noteId, "event", "Kickoff", null, "evt_1"))!;
      let n = (await svc.note(noteId))!;
      eq(n.connections.length, 1, "added"); eq(n.connections[0]!.targetId, "evt_1", "targetId");
      await svc.removeConnection(noteId, connId);
      n = (await svc.note(noteId))!; eq(n.connections.length, 0, "removed"); } },
  { group: "UI", name: "Link picker lists events/tasks and picks one", run: () => {
      let picked: string[] = [];
      const m = mount(createElement(LinkPicker, { events: [{ id: "e1", title: "Kickoff" }], tasks: [{ id: "t1", text: "Email Sam" }], onPick: (k: string, l: string, id: string) => { picked = [k, l, id]; } }));
      ok(m.text().includes("Kickoff"), "event listed"); ok(m.text().includes("Email Sam"), "task listed");
      const rows = Array.from(m.div.querySelectorAll(".row")) as HTMLElement[];
      const evRow = rows.find((r) => (r.textContent || "").includes("Kickoff"))!;
      evRow.click();
      eq(picked[0], "event", "picked kind"); eq(picked[2], "e1", "picked id");
      m.unmount(); } },
  { group: "Storage stress", name: "deleted item never resurrects (queued edit no-ops)", run: async () => {
      const a = new InMemoryAdapter(); const s = new Store(a);
      const id = await s.create("u", "task", { text: "x" } as never);
      s.goOffline(); await s.update("u", id, { done: true } as never); await s.delete("u", id);
      await s.reconnect();
      eq(await s.read("u", id), null, "stays deleted"); eq(a.snapshotCount(), 0, "nothing left"); } },
  { group: "Storage stress", name: "scalar last-write-wins; stale rejected", run: async () => {
      const s = store(); const id = await s.create("u", "settings", { theme: "dark" } as never);
      const cur = (await s.read("u", id))!.serverTime;
      eq(await s.update("u", id, { theme: "light" } as never, cur + 5), true, "newer wins");
      eq(await s.update("u", id, { theme: "dark" } as never, cur + 1), false, "stale rejected");
      eq((await s.read("u", id))!.data.theme as string, "light", "value kept"); } },
  { group: "Storage stress", name: "offline queue flushes in order, no loss", run: async () => {
      const s = store(); const id = await s.create("u", "c", { n: 0, a: false } as never);
      s.goOffline(); await s.update("u", id, { a: true } as never); await s.update("u", id, { n: 9 } as never);
      eq(s.queueLen(), 2, "queued"); await s.reconnect(); eq(s.queueLen(), 0, "drained");
      const d = (await s.read("u", id))!.data; eq(d.a as boolean, true, "a kept"); eq(d.n as number, 9, "n kept"); } },
  { group: "Storage stress", name: "no loss under churn (200 ops)", run: async () => {
      const a = new InMemoryAdapter(); const s = new Store(a); const ids: string[] = [];
      for (let i = 0; i < 200; i++) ids.push(await s.create("u", "task", { i, done: false } as never));
      for (let i = 0; i < ids.length; i += 2) await s.delete("u", ids[i]!);
      for (let i = 1; i < ids.length; i += 2) await s.update("u", ids[i]!, { done: true } as never);
      eq((await s.listForUser("u")).length, 100, "survivors"); eq(a.snapshotCount(), 100, "row count"); } },
  { group: "Storage stress", name: "owner isolation (no cross-user read/write/delete)", run: async () => {
      const s = store(); const id = await s.create("A", "secret", { v: 1 } as never);
      eq(await s.read("B", id), null, "B cannot read");
      eq(await s.update("B", id, { v: 2 } as never), false, "B cannot write");
      await s.delete("B", id); eq((await s.read("A", id))!.data.v as number, 1, "A untouched"); } },
  { group: "Google", name: "config gating (off without a client id)", run: () => {
      eq(googleConfigured(""), false, "off"); eq(googleConfigured("x.apps.googleusercontent.com"), true, "on"); } },
  { group: "Google", name: "calendar event maps to local date/time", run: () => {
      const m = mapGoogleEvent({ id: "g1", summary: "Standup", start: { dateTime: "2026-06-01T09:30:00-07:00" } })!;
      eq(m.date, "2026-06-01", "date"); eq(m.start, "09:30", "time"); eq(m.gcalId, "g1", "id"); } },
  { group: "Google", name: "gmail message maps + cleans sender", run: () => {
      const r = mapGmailMessage({ id: "m1", snippet: "hi", payload: { headers: [{ name: "From", value: "Sam Lee <s@x.com>" }, { name: "Subject", value: "Lunch?" }] } });
      eq(r.from, "Sam Lee", "from"); eq(r.subject, "Lunch?", "subject"); } },
  { group: "Google", name: "calendar import is idempotent (dedupe by id)", run: async () => {
      const sched = new ScheduleService(store(), "u");
      const api = makeFakeGoogleApi({ listUpcomingEvents: async () => [{ id: "g1", summary: "X", start: { dateTime: "2026-06-01T09:00:00Z" } }] });
      eq(await importCalendar(api, sched), 1, "first import"); eq(await importCalendar(api, sched), 0, "re-import dedupes"); } },
  { group: "Email", name: "inbox row flags unread + parses time", run: () => { const r = mapInboxMessage({ id: "m1", snippet: "hi", labelIds: ["INBOX", "UNREAD"], internalDate: "1700", payload: { headers: [{ name: "From", value: "Sam <s@x.com>" }, { name: "Subject", value: "Hi" }] } }); ok(r.unread, "unread"); eq(r.from, "Sam", "from"); eq(r.dateMs, 1700, "time"); } },
  { group: "Email", name: "reply threads + encodes RFC822", run: () => { const full = mapGmailFull({ id: "m1", threadId: "t9", payload: { mimeType: "text/plain", body: { data: btoa("hi") }, headers: [{ name: "From", value: "A <a@x.com>" }, { name: "Subject", value: "Plan" }, { name: "Message-ID", value: "<abc>" }] } }); const rep = buildReply(full, "ok"); eq(rep.threadId, "t9", "thread"); const raw = encodeEmail({ to: rep.to, subject: rep.subject, body: "ok", inReplyTo: rep.inReplyTo }); const d = atob(raw.replace(/-/g, "+").replace(/_/g, "/")); ok(d.includes("Subject: Re: Plan"), "subject"); ok(d.includes("In-Reply-To: <abc>"), "inReplyTo"); } },
  { group: "Admin", name: "sample source returns users + billing", run: async () => { const a = makeSampleAdminSource(); eq((await a.listUsers()).length, 3, "users"); eq((await a.billing()).mrr, 36, "mrr"); } },
  { group: "Admin", name: "real api stays unavailable until server wired", run: () => { ok(createAdminApi("t").available === false, "not configured by default"); } },
];
