import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { BackupService, type BackupBundle } from "./BackupService";

describe("BackupService", () => {
  it("exports all owned items and imports them into another store", async () => {
    const a = new Store(new InMemoryAdapter());
    await a.create("u1", "task", { title: "A", done: false } as never);
    await a.create("u1", "task", { title: "B", done: true } as never);
    await a.create("u1", "event", { title: "Standup", date: "2026-05-24", start: "09:00" } as never);

    const bundle = await new BackupService(a, "u1").exportBundle();
    expect(bundle.app).toBe("jarvis");
    expect(bundle.items.length).toBe(3);
    expect(bundle.items.every((i) => "entityType" in i && "data" in i)).toBe(true);

    const b = new Store(new InMemoryAdapter());
    const result = await new BackupService(b, "u2").importBundle(bundle);
    expect(result.imported).toBe(3);
    expect(result.unsupportedTypes).toEqual([]);
    expect((await b.listForUser("u2")).length).toBe(3);
  });

  it("rejects a non-JARVIS file", async () => {
    const s = new BackupService(new Store(new InMemoryAdapter()), "u1");
    await expect(s.importBundle({ foo: 1 } as never)).rejects.toThrow();
  });
});

describe("import hardening", () => {
  it("skips unknown entity types and reports each one by name, once", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new BackupService(store, "u");
    const result = await svc.importBundle({
      app: "jarvis", version: 1, exportedAt: "x",
      items: [
        { entityType: "task", data: { text: "ok" } },
        { entityType: "malware_payload", data: { boom: 1 } },
        { entityType: "malware_payload", data: { boom: 2 } },
      ],
    } as never);
    expect(result.imported).toBe(1);
    expect(result.unsupportedTypes).toEqual(["malware_payload"]);
    const rows = await store.listForUser("u");
    expect(rows.every((r) => r.entityType === "task")).toBe(true);
  });

  // S3-Q15 (2026-09-04): the whole point of the fix -- a type this build
  // shipped support for after the backup's own build was written must now
  // restore instead of silently vanishing.
  it("restores an entity type that used to be missing from KNOWN_TYPES", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new BackupService(store, "u");
    const result = await svc.importBundle({
      app: "jarvis", version: 1, exportedAt: "x",
      items: [
        { entityType: "brain_doc", data: { topic: "values", text: "Be direct." } },
        { entityType: "health_took_it", data: { medId: "m1", at: "2026-09-04T08:00:00Z" } },
      ],
    } as never);
    expect(result.imported).toBe(2);
    expect(result.unsupportedTypes).toEqual([]);
    const rows = await store.listForUser("u");
    expect(rows.map((r) => r.entityType).sort()).toEqual(["brain_doc", "health_took_it"]);
  });

  it("rolls back everything when a write fails mid-loop", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new BackupService(store, "u");
    let calls = 0;
    const realCreate = store.create.bind(store);
    store.create = async (o, t, d) => {
      calls++;
      if (calls === 3) throw new Error("db down");
      return realCreate(o, t, d);
    };
    await expect(svc.importBundle({
      app: "jarvis", version: 1, exportedAt: "x",
      items: [
        { entityType: "task", data: { text: "a" } },
        { entityType: "task", data: { text: "b" } },
        { entityType: "task", data: { text: "c" } },
      ],
    } as never)).rejects.toThrow(/Rolled back/);
    expect((await store.listForUser("u")).length).toBe(0);
  });
});

// Import dedupe (2026-08-09): the same file twice must not double a life.
describe("importBundle dedupe", () => {
  it("skips items identical to ones already present and reports only real writes", async () => {
    const svc = new BackupService(new Store(new InMemoryAdapter()), "u-dedupe");
    const bundle: BackupBundle = {
      app: "jarvis", version: 1, exportedAt: "2026-08-01T00:00:00Z",
      items: [
        { entityType: "task", data: { text: "Pay rent", done: false } },
        { entityType: "note", data: { title: "Ideas", category: "", blocks: [], connections: [] } },
      ] as BackupBundle["items"],
    };
    expect((await svc.importBundle(bundle)).imported).toBe(2);
    expect((await svc.importBundle(bundle)).imported).toBe(0); // second run: everything exists
    const again = await svc.exportBundle();
    expect(again.items.filter((i) => i.entityType === "task")).toHaveLength(1);
  });
});

// PLUMB-F-12 (2026-09-05): "restore a backup into a fresh account and every
// record comes back uncategorized." The bug was that ids never travelled, so
// there was nothing for a link to be rewritten to.
describe("importBundle cross-references", () => {
  async function seed(store: Store, owner: string) {
    const areaId = await store.create(owner, "life_area", { name: "Family", state: "steady" } as never);
    const catId = await store.create(owner, "category", { name: "Elite Squad", color: "blue", order: 0 } as never);
    const goalId = await store.create(owner, "goal", { title: "Get to state", state: "on_track", areaId, tags: [catId] } as never);
    const projectId = await store.create(owner, "project", { title: "Spring season", status: "active", category: catId, goalId } as never);
    const noteId = await store.create(owner, "note", { title: "Practice plan", category: catId, blocks: [], connections: [] } as never);
    const taskId = await store.create(owner, "task", { text: "Book the field", category: catId, done: false, projectId, fromNote: noteId } as never);
    // The cycle no create order can satisfy: the note names the task its
    // checklist line became, and the task already names the note.
    await store.update(owner, noteId, {
      blocks: [{ id: "b1", type: "checklist", items: [{ text: "Book the field", done: false, taskId }] }],
      connections: [{ id: "c1", kind: "task", label: "Book the field", targetId: taskId }],
    } as never);
    await store.create(owner, "event", { title: "Practice", date: "2026-09-08", start: "16:00", category: catId, taskIds: [taskId] } as never);
    return { areaId, catId, goalId, projectId, noteId, taskId };
  }

  it("rebuilds every link when restoring into a fresh account", async () => {
    const from = new Store(new InMemoryAdapter());
    await seed(from, "u1");
    const bundle = await new BackupService(from, "u1").exportBundle();
    expect(bundle.items.every((i) => typeof i.id === "string")).toBe(true);

    const to = new Store(new InMemoryAdapter());
    const result = await new BackupService(to, "u2").importBundle(bundle);
    expect(result.imported).toBe(7);

    const rows = await to.listForUser("u2");
    const one = (type: string) => rows.find((r) => r.entityType === type)!;
    const cat = one("category"), area = one("life_area"), goal = one("goal");
    const project = one("project"), note = one("note"), task = one("task"), event = one("event");

    // Nothing points at an id from the old account any more, and nothing
    // points at nothing.
    expect(task.data.category).toBe(cat.id);
    expect(task.data.projectId).toBe(project.id);
    expect(task.data.fromNote).toBe(note.id);
    expect(project.data.category).toBe(cat.id);
    expect(project.data.goalId).toBe(goal.id);
    expect(goal.data.areaId).toBe(area.id);
    expect(goal.data.tags).toEqual([cat.id]);
    expect(note.data.category).toBe(cat.id);
    expect(event.data.category).toBe(cat.id);
    expect(event.data.taskIds).toEqual([task.id]);
    // Two arrays deep, and the back half of the cycle.
    const blocks = note.data.blocks as { items: { taskId: string }[] }[];
    expect(blocks[0]!.items[0]!.taskId).toBe(task.id);
    const connections = note.data.connections as { targetId: string }[];
    expect(connections[0]!.targetId).toBe(task.id);
    // The restored ids are genuinely new, not the old account's.
    const old = bundle.items.map((i) => i.id);
    expect(rows.every((r) => !old.includes(r.id))).toBe(true);
  });

  it("re-importing into the account it came from changes nothing", async () => {
    const store = new Store(new InMemoryAdapter());
    const ids = await seed(store, "u1");
    const svc = new BackupService(store, "u1");
    const bundle = await svc.exportBundle();
    expect((await svc.importBundle(bundle)).imported).toBe(0);
    const rows = await store.listForUser("u1");
    expect(rows.length).toBe(7);
    expect(rows.find((r) => r.id === ids.taskId)!.data.category).toBe(ids.catId);
  });

  // 2026-09-12: pass one minted a fresh id for a record pass two then skipped
  // as a content duplicate, so the id it handed out was never created and
  // everything pointing at it pointed at nothing. Restoring one file into an
  // account twice left five dangling references (the area on the goal, and the
  // category on the task, the note, the event and the project), and each record
  // carrying one differed in content from the row already there, so it came
  // back as an uncategorized second copy.
  //
  // A record the account already holds is recognised by its content now, and
  // recognising one repeats into the references that point at it. What this
  // cannot resolve is a REFERENCE CYCLE: the note names the task and the task
  // names the note, so neither is recognisable until the other already is, and
  // that cluster is still written a second time. It is written whole and
  // internally consistent, which is the part that matters: a duplicate a person
  // can delete, never a record pointing at something that does not exist.
  it("never leaves a reference pointing at a row that was never created", async () => {
    const store = new Store(new InMemoryAdapter());
    await seed(store, "u1");
    const bundle = await new BackupService(store, "u1").exportBundle();

    // The same content under another account's ids: what a restore onto a fresh
    // phone looks like, and what a second restore of the same file meets.
    const other = new Store(new InMemoryAdapter());
    const otherSvc = new BackupService(other, "u2");
    expect((await otherSvc.importBundle(bundle)).imported).toBe(7);
    const again = await otherSvc.importBundle(bundle);

    const rows = await other.listForUser("u2");
    const ids = new Set(rows.map((r) => r.id));
    const dangling: string[] = [];
    for (const r of rows) {
      for (const key of ["category", "projectId", "fromNote", "goalId", "areaId"]) {
        const v = (r.data as Record<string, unknown>)[key];
        if (typeof v === "string" && v && !ids.has(v)) dangling.push(r.entityType + "." + key);
      }
    }
    expect(dangling).toEqual([]);
    // The single-reference records are all recognised, so nothing is doubled
    // except the note/task cycle and the event that names the task.
    expect(again.imported).toBe(3);
    expect(rows.filter((r) => r.entityType === "category")).toHaveLength(1);
    expect(rows.filter((r) => r.entityType === "life_area")).toHaveLength(1);
    expect(rows.filter((r) => r.entityType === "goal")).toHaveLength(1);
    expect(rows.filter((r) => r.entityType === "project")).toHaveLength(1);
  });

  it("leaves an id alone when the record it points at is not in the bundle", async () => {
    const store = new Store(new InMemoryAdapter());
    await new BackupService(store, "u").importBundle({
      app: "jarvis", version: 2, exportedAt: "x",
      items: [{ entityType: "task", id: "old-task", data: { text: "Orphan", category: "cat-that-left", done: false } }],
    } as never);
    const rows = await store.listForUser("u");
    expect(rows[0]!.data.category).toBe("cat-that-left");
  });

  it("imports a v1 bundle with no ids exactly as it always did", async () => {
    const store = new Store(new InMemoryAdapter());
    const result = await new BackupService(store, "u").importBundle({
      app: "jarvis", version: 1, exportedAt: "x",
      items: [
        { entityType: "category", data: { name: "Work", color: "blue", order: 0 } },
        { entityType: "task", data: { text: "Ship it", category: "legacy-cat", done: false } },
      ],
    } as never);
    expect(result.imported).toBe(2);
    const task = (await store.listForUser("u")).find((r) => r.entityType === "task")!;
    expect(task.data.category).toBe("legacy-cat");
  });
});
