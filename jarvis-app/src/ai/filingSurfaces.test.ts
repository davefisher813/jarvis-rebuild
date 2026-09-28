// Brain Manual v1 (in-flow filing surfaces): focused tests.
//
// Covers the five filing doors at the seams a unit test can reach:
// pickFileText (note selection vs full-note snapshot, empty-note disabled),
// the voice guardrails + 5-sample cap + 6th-sample replacement + restorative
// Undo, decision defaults (date/status/linkedItemIds), person-role merging
// on triage, the destination toast with its 8-second Undo, and the filing
// bypass of aiGate (no filing module may reference it: the tap is approval).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Store, InMemoryAdapter, type ItemData } from "@core";
import { BrainMemoryService } from "./brainMemoryService";
import { pickFileText } from "./filing";
import {
  fileMemory,
  showFilingConfirm,
  oldestVoiceSample,
} from "./filingIntake";
import {
  BRAIN_MEMORY_ENTITY,
  PERSON_ENTITY,
  UNDO_MS,
  VOICE_SAMPLE_CAP,
  type BrainMemoryCategory,
} from "./brainMemory";

const here = dirname(fileURLToPath(import.meta.url));

vi.mock("../shared/toast", () => ({
  showToast: vi.fn(),
}));
import { showToast } from "../shared/toast";

const mk = () => new BrainMemoryService(new Store(new InMemoryAdapter()), "u1");

// 60 words: comfortably over the 50-word voice minimum.
const LONG = (seed: string) =>
  Array.from({ length: 60 }, (_, i) => `${seed}${i}`).join(" ");

describe("pickFileText: note selection vs full-note snapshot", () => {
  it("files the selection when one exists", () => {
    expect(pickFileText("the highlighted line", "Full note body here")).toBe(
      "the highlighted line",
    );
  });
  it("snapshots the whole note when nothing is selected", () => {
    expect(pickFileText(null, "  Full note body here  ")).toBe("Full note body here");
  });
  it("a blank snapshot means the menu item renders disabled (never files blank)", async () => {
    expect(pickFileText(null, "   \n  ")).toBe("");
    // And the service refuses blank text at the write boundary too.
    const svc = mk();
    const data = fileMemory({ category: "philosophy", text: "x", source: "note" });
    expect(await svc.file({ ...data, text: "   " })).toBeNull();
  });
});

describe("voice guardrails (§4.4)", () => {
  it("a short sample warns instead of filing silently", async () => {
    const svc = mk();
    expect(await svc.voiceCheck("too short")).toBe("too-short");
  });
  it("an exact duplicate is skipped with a notice, never filed twice", async () => {
    const svc = mk();
    const text = LONG("dup");
    await svc.saveVoiceSample(text);
    expect(await svc.voiceCheck(text)).toBe("duplicate");
    expect((await svc.voiceSamples()).length).toBe(1);
  });
  it("duplicate wins over too-short: a short repeat is already-saved, never re-filed", async () => {
    const svc = mk();
    // Dave saved it short once via "save anyway"; tapping Save My Voice on
    // the same words again must say already-saved, not offer save-anyway a
    // second time (which would file it twice).
    await svc.saveVoiceSample("too short");
    expect(await svc.voiceCheck("too short")).toBe("duplicate");
    expect((await svc.voiceSamples()).length).toBe(1);
  });
});

describe("voice 5-sample cap and 6th-sample replacement", () => {
  it("holds five, and the sixth replaces the oldest", async () => {
    const svc = mk();
    const first = await svc.saveVoiceSample(LONG("first"));
    for (const s of ["b", "c", "d", "e"]) await svc.saveVoiceSample(LONG(s));
    expect((await svc.voiceSamples()).length).toBe(VOICE_SAMPLE_CAP);
    const sixth = await svc.saveVoiceSample(LONG("sixth"));
    expect(sixth.replaced?.id).toBe(first.id);
    const after = await svc.voiceSamples();
    expect(after.length).toBe(VOICE_SAMPLE_CAP);
    expect(after.some((r) => r.id === first.id)).toBe(false);
    expect(after.some((r) => r.id === sixth.id)).toBe(true);
  });
  it("oldestVoiceSample is null while there is room", async () => {
    const svc = mk();
    await svc.saveVoiceSample(LONG("one"));
    expect(oldestVoiceSample(await svc.voiceSamples())).toBeNull();
  });
  it("Undo of a capped replacement restores the oldest under its old id", async () => {
    const svc = mk();
    const first = await svc.saveVoiceSample(LONG("first"));
    for (const s of ["b", "c", "d", "e"]) await svc.saveVoiceSample(LONG(s));
    const firstText = (await svc.voiceSamples()).find((r) => r.id === first.id)!.data.text;
    const sixth = await svc.saveVoiceSample(LONG("sixth"));
    await svc.restoreVoiceSample(sixth.id!, sixth.replaced!);
    const after = await svc.voiceSamples();
    expect(after.length).toBe(VOICE_SAMPLE_CAP);
    const restored = after.find((r) => r.id === first.id);
    expect(restored?.data.text).toBe(firstText);
    expect(after.some((r) => r.id === sixth.id)).toBe(false);
  });
  it("plain Undo deletes the row it just wrote", async () => {
    const svc = mk();
    const r = await svc.saveVoiceSample(LONG("gone"));
    await svc.unfile(r.id!);
    expect(await svc.voiceSamples()).toEqual([]);
  });
});

describe("decision filing defaults (§4.2/§4.3)", () => {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  it("a decision gets today's date and active status automatically", () => {
    const d = fileMemory({ category: "decision", text: "Ship it", source: "task" });
    expect(d.date).toBe(todayStr);
    expect(d.status).toBe("active");
    expect(d.state).toBe("LEARNED");
  });
  it("a decision filed from a task/event keeps the link", () => {
    const d = fileMemory({
      category: "decision", text: "Ship it", source: "task", linkedItemIds: ["task-1"],
    });
    expect(d.linkedItemIds).toEqual(["task-1"]);
  });
  it("the optional why is kept, blank why is dropped", () => {
    expect(fileMemory({ category: "decision", text: "x", source: "task", why: "  " }).why).toBeUndefined();
    expect(fileMemory({ category: "decision", text: "x", source: "task", why: "Because" }).why).toBe("Because");
  });
});

describe("triagePerson: person-role merging", () => {
  const seedPerson = async (store: Store) => {
    const id = await store.create("u1", PERSON_ENTITY, {
      name: "Sam Rivera",
      // Per-area role objects (the person sheet's shape) plus a stale triage string.
      roles: [{ categoryId: "work", role: "Manager" }, "Friend"],
    } as unknown as ItemData);
    return id;
  };
  it("preserves per-area role objects and replaces only triage strings", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new BrainMemoryService(store, "u1");
    const id = await seedPerson(store);
    expect(await svc.triagePerson(id, ["Colleague", "Mentor"], "Met at the game", "email")).toBe(true);
    const row = (await store.read("u1", id))!;
    const roles = (row.data as { roles: unknown[] }).roles;
    expect(roles).toContainEqual({ categoryId: "work", role: "Manager" });
    expect(roles).toContain("Colleague");
    expect(roles).toContain("Mentor");
    expect(roles).not.toContain("Friend");
    expect((row.data as { triageState: string }).triageState).toBe("sorted");
    expect((row.data as { roleNote: string }).roleNote).toBe("Met at the game");
  });
  it("dedupes the picked roles", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new BrainMemoryService(store, "u1");
    const id = await seedPerson(store);
    await svc.triagePerson(id, ["Colleague", "Colleague"], undefined, "email");
    const row = (await store.read("u1", id))!;
    const roles = (row.data as { roles: unknown[] }).roles;
    expect(roles.filter((r) => r === "Colleague").length).toBe(1);
  });
});

describe("destination toast + 8-second Undo", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("names the destination and offers Undo for UNDO_MS", () => {
    const onUndo = vi.fn();
    const cats: BrainMemoryCategory[] = ["decision", "philosophy", "value", "voice", "fact"];
    for (const c of cats) {
      vi.clearAllMocks();
      showFilingConfirm(c, onUndo);
      expect(showToast).toHaveBeenCalledTimes(1);
      const [toast, ms] = (showToast as unknown as { mock: { calls: [object, number][] } }).mock.calls[0]!;
      expect((toast as { message: string }).message).toMatch(/^Saved to /);
      expect((toast as { actionLabel?: string }).actionLabel).toBe("Undo");
      expect(ms).toBe(UNDO_MS);
      expect(UNDO_MS).toBe(8000);
    }
    // The Undo capsule runs the caller's restore, not a toggle.
    showFilingConfirm("decision", onUndo);
    const last = (showToast as unknown as { mock: { calls: [{ onAction: () => void }, number][] } }).mock.calls.at(-1)!;
    last[0].onAction();
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
  it("filing writes a row the toast's Undo can delete (service round-trip)", async () => {
    const svc = mk();
    const data = fileMemory({ category: "philosophy", text: "Discipline beats motivation.", source: "note" });
    const id = await svc.file(data);
    expect(id).toBeTruthy();
    expect((await svc.listByCategory("philosophy")).length).toBe(1);
    await svc.unfile(id!);
    expect((await svc.listByCategory("philosophy")).length).toBe(0);
  });
});

describe("filing bypasses aiGate at every AI Control level", () => {
  it("no filing module references aiGate: the tap itself is approval (§6)", () => {
    // The filing-owned modules only. The host flows (Messages, QuickCapture,
    // NoteEditor, TaskSheet, EventSheet) pre-date filing and consult the
    // gate for their own AI features; the filing additions inside them never
    // call it -- verified by reading those call sites.
    const files = [
      "filing.ts",
      "filingIntake.ts",
      "brainMemoryService.ts",
      "FileAsSheet.tsx",
      "FilingSheet.tsx",
      "WhoIsThisSheet.tsx",
    ];
    const hits: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(here, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .split("\n")
        .filter((l) => !/^\s*\/\//.test(l))
        .join("\n");
      if (/aiGate/i.test(src)) hits.push(f);
    }
    expect(hits).toEqual([]);
  });
  it("every brain_memory row lands in the shared entity table", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new BrainMemoryService(store, "u1");
    const id = await svc.file(fileMemory({ category: "fact", text: "Dave files fast.", source: "plus-menu" }));
    const items = await store.listForUser("u1", BRAIN_MEMORY_ENTITY);
    expect(items.some((i) => i.id === id)).toBe(true);
  });
});
