import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { NotesService } from "./NotesService";

// NOTE TAGS (button audit phase 3, 2026-09-19). setTags had no test anywhere,
// and it is not a pass-through: it trims, strips a leading #, drops empties
// and dedupes before writing. Every one of those is a rule the tag sheet
// relies on -- it appends whatever was typed, "#drills" and "drills" arrive
// as the same tag, and a stray space must not create a second one.

describe("NotesService.setTags", () => {
  it("stores the tag the user meant, not the characters they typed", async () => {
    const svc = new NotesService(new Store(new InMemoryAdapter()), "u");
    const id = (await svc.createNote("Practice Plan", ""))!;

    await svc.setTags(id, ["  drills  ", "#drills", "Drills", "", "   ", "#film"]);
    const note = await svc.note(id);

    // The hash is how tags are written, not part of the tag; case is the
    // user's own, so "Drills" is not "drills"; blanks never become a tag.
    expect(note!.tags).toEqual(["drills", "Drills", "film"]);
  });

  it("replaces the set rather than adding to it, so removing a tag sticks", async () => {
    const svc = new NotesService(new Store(new InMemoryAdapter()), "u");
    const id = (await svc.createNote("Roster", ""))!;

    await svc.setTags(id, ["film", "drills"]);
    expect((await svc.note(id))!.tags).toEqual(["film", "drills"]);

    await svc.setTags(id, ["film"]);
    expect((await svc.note(id))!.tags).toEqual(["film"]);

    // And clearing them all is a legal state, not a no-op.
    await svc.setTags(id, []);
    expect((await svc.note(id))!.tags).toEqual([]);
  });
});
