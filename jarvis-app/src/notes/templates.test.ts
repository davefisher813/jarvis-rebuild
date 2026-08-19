// Templates create the structure their card promises (Dave 2026-08-19,
// "I meant all of these"). These laws pin each template's real shape, the
// dated pieces applyTemplate adds, and the Tracker's living table.
import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { NotesService } from "./NotesService";

const rig = () => new NotesService(new Store(new InMemoryAdapter()), "u1");

const make = async (svc: NotesService, key: "meeting" | "tracker" | "journal" | "brief") => {
  const id = (await svc.createNote("T", "cat1"))!;
  await svc.applyTemplate(id, key);
  return { id, note: (await svc.note(id))! };
};

describe("law: templates deliver what their card promises", () => {
  it("Meeting Notes opens dated, then agenda, decisions, action items", async () => {
    const { note: n } = await make(rig(), "meeting");
    expect(n.blocks[0]!.type).toBe("text");
    expect(n.blocks[0]!.text).toMatch(/^[A-Z][a-z]{2} \d{1,2} · Attendees$/);
    const heads = n.blocks.filter((b) => b.type === "heading").map((b) => b.text);
    expect(heads).toEqual(["Agenda", "Decisions", "Action Items"]);
    expect(n.blocks.some((b) => b.type === "checklist")).toBe(true);
  });

  it("Project Brief carries objective, key dates, tasks, notes", async () => {
    const { note: n } = await make(rig(), "brief");
    const heads = n.blocks.filter((b) => b.type === "heading").map((b) => b.text);
    expect(heads).toEqual(["Objective", "Key Dates", "Tasks", "Notes"]);
  });

  it("Journal opens with today's first entry ready to write", async () => {
    const { note: n } = await make(rig(), "journal");
    const last = n.blocks[n.blocks.length - 1]!;
    const dateHead = n.blocks[n.blocks.length - 2]!;
    expect(dateHead.type).toBe("heading");
    expect(dateHead.text).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
    expect(last.type).toBe("text");
    expect(last.text).toBe("");
  });

  it("Tracker starts with an editable row and grows by patch", async () => {
    const svc = rig();
    const { id, note: n } = await make(svc, "tracker");
    const table = n.blocks.find((b) => b.type === "table")!;
    expect(table.rows).toEqual([["", ""]]);
    // Cell edits and growth are plain editBlock patches, so undo covers them.
    await svc.editBlock(id, table.id, { columns: ["Item", "Cost"] });
    await svc.editBlock(id, table.id, { rows: [["Cleats", "$120"], ["Bats", "$80"]] });
    const after = (await svc.note(id))!.blocks.find((b) => b.type === "table")!;
    expect(after.columns).toEqual(["Item", "Cost"]);
    expect(after.rows).toHaveLength(2);
  });
});
