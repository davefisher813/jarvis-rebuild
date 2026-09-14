// VERSION HISTORY AND RECENTLY DELETED (the writing system, wave 3b): a
// version is kept when a save lands more than ten minutes after the last
// one, restoring keeps the current document first, and a deleted note keeps
// its record until it is restored, deleted for good, or thirty days old.
import { describe, it, expect, vi, afterEach } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { NotesService } from "./NotesService";
import { blocksToDoc } from "./docModel";

function make() {
  const store = new Store(new InMemoryAdapter());
  return new NotesService(store, "u-versions", () => {});
}
const docOf = (text: string) => blocksToDoc([{ id: "t", type: "text", text }]);

describe("version history", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("keeps the replaced document when the last version is older than ten minutes, twenty at most", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T10:00:00Z"));
    const svc = make();
    const id = (await svc.createNote("Roster", ""))!;
    await svc.setDoc(id, docOf("one"));
    expect((await svc.note(id))!.versions ?? []).toEqual([]);
    // Two minutes later: the first document is kept (there was no version
    // yet), and the gap starts counting from it.
    vi.setSystemTime(new Date("2026-09-14T10:02:00Z"));
    await svc.setDoc(id, docOf("two"));
    expect((await svc.note(id))!.versions!.map((v) => v.doc)).toEqual([docOf("one")]);
    // Four minutes on: too soon, "two" is not kept.
    vi.setSystemTime(new Date("2026-09-14T10:06:00Z"));
    await svc.setDoc(id, docOf("two-b"));
    expect((await svc.note(id))!.versions!.length).toBe(1);
    // Twelve minutes after the last version: the document being replaced is kept.
    vi.setSystemTime(new Date("2026-09-14T10:14:00Z"));
    await svc.setDoc(id, docOf("three"));
    const v = (await svc.note(id))!.versions!;
    expect(v.map((x) => x.doc)).toEqual([docOf("one"), docOf("two-b")]);
    // Twenty-five saves an hour apart keep only the newest twenty.
    for (let i = 0; i < 25; i++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 8, 15, i, 0, 0)));
      await svc.setDoc(id, docOf("n" + i));
    }
    expect((await svc.note(id))!.versions!.length).toBe(20);
  });

  it("restores a version and keeps the current document as one first", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T10:00:00Z"));
    const svc = make();
    const id = (await svc.createNote("Roster", ""))!;
    await svc.setDoc(id, docOf("first"));
    vi.setSystemTime(new Date("2026-09-14T10:20:00Z"));
    await svc.setDoc(id, docOf("second"));
    const at = (await svc.note(id))!.versions![0]!.at;
    expect(await svc.restoreVersion(id, at)).toBe(true);
    const n = (await svc.note(id))!;
    expect(n.doc).toEqual(docOf("first"));
    expect(n.blocks[0]!.text).toBe("first");
    expect(n.versions!.map((v) => v.doc)).toEqual([docOf("first"), docOf("second")]);
    expect(await svc.restoreVersion(id, 1)).toBe(false);
  });
});

describe("recently deleted", () => {
  it("a deleted note leaves the list, stays readable, comes back on restore, and goes for good on purge", async () => {
    const svc = make();
    const id = (await svc.createNote("Roster", ""))!;
    const other = (await svc.createNote("Kept", ""))!;
    expect(await svc.trashNote(id)).toBe(true);
    expect((await svc.listNotes()).map((n) => n.id)).toEqual([other]);
    expect((await svc.listNotes({ includeDeleted: true })).length).toBe(2);
    expect((await svc.note(id))!.deletedAt).toBeTruthy();
    expect((await svc.list()).map((n) => n.title)).toEqual(["Kept"]);
    expect(await svc.untrashNote(id)).toBe(true);
    expect((await svc.listNotes()).length).toBe(2);
    await svc.trashNote(id);
    const deletedAt = (await svc.note(id))!.deletedAt!;
    // Twenty-nine days on it stays; thirty days on it is purged.
    expect(await svc.purgeTrash(undefined, deletedAt + 29 * 86400000)).toEqual([]);
    expect(await svc.purgeTrash(undefined, deletedAt + 30 * 86400000)).toEqual([id]);
    expect(await svc.note(id)).toBeNull();
  });
});
