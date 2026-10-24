import { describe, expect, it, vi } from "vitest";
import { intakeDocument, type IntakeDeps } from "./intake";

const pdf = new File([new Uint8Array([1, 2, 3])], "bill.pdf", { type: "application/pdf" });
const photo = new File([new Uint8Array([1, 2, 3])], "sched.jpg", { type: "image/jpeg" });

function deps(over: Partial<IntakeDeps> = {}) {
  const log: string[] = [];
  const d: IntakeDeps = {
    files: {
      create: vi.fn(async (data) => { log.push("create:" + data.scope + ":" + data.doc?.state); return "f1"; }),
      update: vi.fn(async (_id, patch) => { log.push("update:" + patch.doc?.state); return true; }),
      remove: vi.fn(async () => { log.push("remove"); }),
    },
    store: {
      upload: vi.fn(async () => { log.push("upload"); return { path: "u/f1/bill.pdf", name: "bill.pdf", mime: "application/pdf", bytes: 3 }; }),
      remove: vi.fn(async () => { log.push("removeBytes"); }),
    },
    enqueue: vi.fn(async () => { log.push("enqueue"); return { ok: true as const, value: { enqueued: true } }; }),
    putText: vi.fn(async () => { log.push("putText"); return { ok: true as const, value: true as const }; }),
    reader: null,
    today: "2026-10-24",
    ...over,
  };
  return { d, log };
}

describe("intake: one door for an upload and a photo", () => {
  it("makes the row first, then the bytes, then says Saved, then queues", async () => {
    const { d, log } = deps();
    const r = await intakeDocument(pdf, d);
    expect(r).toEqual({ ok: true, id: "f1", queued: true });
    expect(log).toEqual(["create:library:uploading", "upload", "update:stored", "enqueue"]);
  });

  it("refuses anything that is not a PDF or a photo, touching nothing", async () => {
    const { d, log } = deps();
    const r = await intakeDocument(new File(["x"], "a.exe", { type: "application/x-msdownload" }), d);
    expect(r).toEqual({ ok: false, reason: "Documents Must Be a PDF or a Photo" });
    expect(log).toEqual([]);
  });

  it("a failed upload takes its own row back and says why", async () => {
    const { d, log } = deps();
    d.store.upload = vi.fn(async () => { throw new Error("That File Is Too Large"); });
    const r = await intakeDocument(pdf, d);
    expect(r).toEqual({ ok: false, reason: "That File Is Too Large" });
    expect(log).toEqual(["create:library:uploading", "remove"]);
  });

  it("a queue that cannot be reached leaves the document saved, not lost", async () => {
    const { d } = deps();
    d.enqueue = vi.fn(async () => ({ ok: false as const, reason: "OFFLINE" as const }));
    const r = await intakeDocument(pdf, d);
    expect(r).toEqual({ ok: true, id: "f1", queued: false });
  });

  it("a photo is read on the phone first, and the text is stored before the queue is told", async () => {
    const { d, log } = deps({ reader: { read: async () => ({ text: "Practice Tuesday 4 PM", pages: [{ page: 1, start: 0, end: 21 }], words: 4 }) } });
    await intakeDocument(photo, d);
    expect(log.indexOf("putText")).toBeGreaterThan(log.indexOf("update:stored"));
    expect(log.indexOf("putText")).toBeLessThan(log.indexOf("enqueue"));
  });

  it("with no phone reader, a photo is still saved and queued, and nothing is stored as text", async () => {
    const { d, log } = deps();
    const r = await intakeDocument(photo, d);
    expect(r).toMatchObject({ ok: true, queued: true });
    expect(log).not.toContain("putText");
  });

  it("a reader that throws does not lose the photo", async () => {
    const { d } = deps({ reader: { read: async () => { throw new Error("vision"); } } });
    expect(await intakeDocument(photo, d)).toMatchObject({ ok: true });
  });

  it("a PDF never goes to the phone reader", async () => {
    const read = vi.fn(async () => null);
    const { d } = deps({ reader: { read } });
    await intakeDocument(pdf, d);
    expect(read).not.toHaveBeenCalled();
  });
});
