// @vitest-environment jsdom
// PHASE 0.5, THE FIRST MAGIC LOOP (PHASE05-DESIGN.md). The package's exit
// test, run for real: capture a thought, JARVIS recognizes the person, it is
// saved, and three days later a search finds it. AI is OFF throughout: the
// AI never gates capture or search. Real services over one in memory Store;
// the only doubles are the AI (off) and the flag seam.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { smartPasteSave, type PasteDeps } from "./smartPaste";
import { capturePeople } from "./captureContext";
import { TasksService } from "../tasks/TasksService";
import { ScheduleService } from "../schedule/ScheduleService";
import { NotesService } from "../notes/NotesService";
import { PeopleService } from "../people/PeopleService";
import { runSearch, type SearchInput } from "../search/search";
import { openWith } from "../people/mentions";
import type { AIService } from "../ai/AIService";
import type { AIContext } from "../ai/context";

const flags = vi.hoisted(() => ({ memoryOn: true }));
vi.mock("../substrate/flags", async (orig) => {
  const real = await orig<typeof import("../substrate/flags")>();
  return { ...real, flagOn: (f: Parameters<typeof real.flagOn>[0]) => (f === "memory_v1" ? flags.memoryOn : real.flagOn(f)) };
});

const U = "dave";
const TODAY = "2026-10-11";
const SENTENCE = "Need to follow up with Mike about summer roster";
let asked = 0;
const aiOff = { available: false, complete: async () => { asked++; throw new Error("AI is off"); } } as unknown as AIService;

// Search over one Store, the way SearchFlow loads its lists and passes the
// flag (links: flagOn("memory_v1")).
function searchOver(store: Store) {
  const tasks = new TasksService(store, U);
  const notes = new NotesService(store, U);
  const schedule = new ScheduleService(store, U);
  const people = new PeopleService(store, U);
  return async (q: string) => {
    const input: SearchInput = {
      tasks: await tasks.listTasks(), events: await schedule.listEvents(), notes: await notes.listNotes(), people: await people.list(),
      projects: [], accounts: [], goals: [], categories: [],
    };
    return runSearch(q, input, { links: flags.memoryOn });
  };
}

async function world(person: { name: string; aliases?: string[] }) {
  const adapter = new InMemoryAdapter();
  const store = new Store(adapter);
  const tasks = new TasksService(store, U);
  const notes = new NotesService(store, U);
  const schedule = new ScheduleService(store, U);
  const people = new PeopleService(store, U);
  const mikeId = (await people.create({ name: person.name, group: "inner_circle", ...(person.aliases ? { aliases: person.aliases } : {}) } as never))!;
  const deps = {
    ai: aiOff, gather: async () => ({ categories: [] }) as unknown as AIContext,
    tasks, schedule, notes, categories: [], today: TODAY,
    people: capturePeople(await people.list()), peopleSvc: people,
  } as unknown as PasteDeps;
  // "Later" is a new session: a fresh Store over the same backend, nothing
  // carried in memory from the capture.
  const later = () => searchOver(new Store(adapter));
  return { deps, store, tasks, notes, people, mikeId, search: searchOver(store), later };
}

beforeEach(() => { localStorage.clear(); asked = 0; flags.memoryOn = true; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-11T09:00:00")); });
afterEach(() => { vi.useRealTimers(); });

describe("Phase 0.5 exit test: a captured thought is found again through search, AI off", () => {
  it("capture, recognize, save, and three days later find it by the person and by the words", async () => {
    const w = await world({ name: "Mike Rossi" });
    const saved = await smartPasteSave(SENTENCE, w.deps);
    expect(asked).toBe(0);
    expect(saved).toHaveLength(1);
    const s = saved[0]!;
    // Saved: the thought (a task, the possible follow up), and NO person: a
    // first name in the words never attaches anyone (Dave, 2026-10-27).
    expect(s).toMatchObject({ kind: "task", title: "Need to Follow Up with Mike About Summer Roster" });
    expect(s.personId).toBeUndefined();
    let t = await w.tasks.task(s.id);
    expect(t).toMatchObject({ text: "Need to Follow Up with Mike About Summer Roster", done: false });
    expect(t?.personId).toBeUndefined();
    expect(t?.due ?? null).toBeNull();
    // Dave taps Mike on the receipt: that is the one way a person gets attached.
    await w.tasks.setPerson(s.id, w.mikeId);
    t = await w.tasks.task(s.id);
    expect(t?.personId).toBe(w.mikeId);

    vi.setSystemTime(new Date("2026-10-14T09:00:00"));
    const search = w.later();
    const byName = await search("Mike");
    expect(byName.people.map((p) => p.id)).toEqual([w.mikeId]);
    expect(byName.tasks.map((x) => x.id)).toEqual([s.id]);
    const byWords = await search("summer roster");
    expect(byWords.tasks.map((x) => x.id)).toEqual([s.id]);
    // One tap on Mike: his card lists it as Still Open.
    const card = openWith({ id: w.mikeId, name: "Mike Rossi" }, (await w.tasks.listTasks()).map((x) => ({ id: x.id, text: x.data.text, done: x.data.done, due: x.data.due ?? null, personId: x.data.personId })), [], "2026-10-14");
    expect(card.map((m) => m.id)).toContain(s.id);
  });

  it("found through the relationship, not the spelling: Michael, also called Mike", async () => {
    const w = await world({ name: "Michael Rossi", aliases: ["Mike"] });
    const [s] = await smartPasteSave(SENTENCE, w.deps);
    expect(s!.personId).toBeUndefined();
    await w.tasks.setPerson(s!.id, w.mikeId);
    const byAlias = await w.search("Mike");
    expect(byAlias.people).toEqual([{ id: w.mikeId, name: "Michael Rossi", why: "Also Called: Mike" }]);
    expect(byAlias.tasks.map((x) => x.id)).toEqual([s!.id]);
    // "Michael" is nowhere in the task's text: only the link finds it.
    const byName = await w.search("Michael");
    expect(byName.tasks).toEqual([{ id: s!.id, text: "Need to Follow Up with Mike About Summer Roster", why: "About: Michael Rossi" }]);
  });

  it("flag off: the sentence is still found by its words, with no link walk", async () => {
    flags.memoryOn = false;
    const w = await world({ name: "Michael Rossi", aliases: ["Mike"] });
    const [s] = await smartPasteSave(SENTENCE, w.deps);
    expect((await w.search("summer roster")).tasks.map((x) => x.id)).toEqual([s!.id]);
    // No link walk: "Michael" is not in the task, so flag off it is not found.
    expect((await w.search("Michael")).tasks).toEqual([]);
  });

  it("offline: captured with no network, found at once, and found in a new session after reconnect", async () => {
    const w = await world({ name: "Mike Rossi" });
    w.store.goOffline();
    const [s] = await smartPasteSave(SENTENCE, w.deps);
    expect(asked).toBe(0);
    expect(s).toMatchObject({ kind: "task" });
    expect(s!.personId).toBeUndefined();
    expect((await w.search("Mike")).tasks.map((x) => x.id)).toEqual([s!.id]);
    await w.store.reconnect();
    vi.setSystemTime(new Date("2026-10-14T09:00:00"));
    const found = await w.later()("summer roster");
    expect(found.tasks.map((x) => x.text)).toEqual(["Need to Follow Up with Mike About Summer Roster"]);
  });
});
