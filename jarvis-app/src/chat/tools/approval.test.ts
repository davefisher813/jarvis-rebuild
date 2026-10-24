import { describe, it, expect, vi } from "vitest";
import type { TaskData } from "../../notes/types";
import { REFUSED_WORDS, approveAndRun } from "./approval";
import type { WriteDeps } from "./execute";
import { APPROVAL_MS, ProposalStore, type ProposalContent } from "./proposals";

// THE TAP (chat box order, 2026-10-24): the only road from a card to a write. A yes from the store goes on to execute; every other answer
// is a reason in words, and nothing was written.

function setup() {
  let t = 1_700_000_000_000;
  let n = 0;
  const store = new ProposalStore(() => t, () => `p${++n}`);
  const tasks = new Map<string, TaskData>([["t1", { text: "Call the plumber", category: "", done: false, due: "2026-10-29" }]]);
  const deps = {
    task: vi.fn(async (id: string) => (tasks.has(id) ? { ...tasks.get(id)! } : null)),
    createTask: vi.fn(async () => "new1"),
    deleteTask: vi.fn(async () => {}),
    setDue: vi.fn(async (id: string, due: string | null) => { tasks.get(id)!.due = due; return true; }),
    completeTask: vi.fn(async () => ({ ok: true })),
    restoreCompletion: vi.fn(async () => true),
    editText: vi.fn(async () => true),
    setPriority: vi.fn(async () => true),
    createDecision: vi.fn(async () => "d1"),
    removeDecision: vi.fn(async () => {}),
  } satisfies WriteDeps;
  const writes = () => [deps.createTask, deps.deleteTask, deps.setDue, deps.completeTask, deps.restoreCompletion, deps.editText, deps.setPriority, deps.createDecision, deps.removeDecision];
  return { store, deps, tasks, writes, advance: (ms: number) => { t += ms; } };
}

const move: ProposalContent = {
  kind: "update_task", taskId: "t1", title: "Call the plumber",
  basis: { text: "Call the plumber", due: "2026-10-29", done: false, priority: null },
  change: { due: "2026-10-30" },
};

describe("a tap that counts", () => {
  it("makes the change, returns the receipt, and leaves the card on screen, working, until the screen settles it", async () => {
    const s = setup();
    const p = await s.store.open("update_task", move);
    const r = await approveAndRun(s.store, p.id, p.hash, s.deps);
    expect(r).toMatchObject({ ok: true, proposalId: p.id, receipt: "Moved to Fri, Oct 30: Call the plumber" });
    expect(s.tasks.get("t1")!.due).toBe("2026-10-30");
    expect(s.store.get(p.id)?.state).toBe("approved");
    expect(s.store.list().map((x) => x.id)).toEqual([p.id]);
  });

  it("two taps together make one change", async () => {
    const s = setup();
    const p = await s.store.open("update_task", move);
    const results = await Promise.all([approveAndRun(s.store, p.id, p.hash, s.deps), approveAndRun(s.store, p.id, p.hash, s.deps)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(s.deps.setDue).toHaveBeenCalledTimes(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ reason: "not_open", message: REFUSED_WORDS.not_open });
  });
});

describe("a tap that does not count writes nothing", () => {
  it("one that ran out of time", async () => {
    const s = setup();
    const p = await s.store.open("update_task", move);
    s.advance(APPROVAL_MS);
    expect(await approveAndRun(s.store, p.id, p.hash, s.deps)).toEqual({ ok: false, reason: "expired", message: "That card timed out · Nothing was changed" });
    for (const w of s.writes()) expect(w).not.toHaveBeenCalled();
  });

  it("one whose card drew other content than the proposal holds", async () => {
    const s = setup();
    const p = await s.store.open("update_task", move);
    expect(await approveAndRun(s.store, p.id, "0".repeat(64), s.deps)).toMatchObject({ ok: false, reason: "changed" });
    for (const w of s.writes()) expect(w).not.toHaveBeenCalled();
  });

  it("one on a card that was replaced, set aside or never there", async () => {
    const s = setup();
    const older = await s.store.open("update_task", move);
    await s.store.open("update_task", { ...move, change: { due: "2026-11-02" } });
    expect(await approveAndRun(s.store, older.id, older.hash, s.deps)).toMatchObject({ ok: false, reason: "superseded" });
    const other = await s.store.open("create_task", { kind: "create_task", text: "x" });
    s.store.cancel(other.id);
    expect(await approveAndRun(s.store, other.id, other.hash, s.deps)).toMatchObject({ ok: false, reason: "not_open" });
    expect(await approveAndRun(s.store, "nope", "abc", s.deps)).toMatchObject({ ok: false, reason: "gone" });
    for (const w of s.writes()) expect(w).not.toHaveBeenCalled();
  });

  it("every reason says nothing was changed, in a short fragment", () => {
    for (const [reason, words] of Object.entries(REFUSED_WORDS)) {
      expect(words, reason).toMatch(/ · Nothing was changed$/);
      expect(words, reason).not.toMatch(/[.!]/);
    }
  });
});

describe("a change that cannot be made", () => {
  it("comes back as a failure in words, with the card still approved for the screen to settle", async () => {
    const s = setup();
    s.tasks.get("t1")!.due = "2026-11-09";
    const p = await s.store.open("update_task", move);
    const r = await approveAndRun(s.store, p.id, p.hash, s.deps);
    expect(r).toEqual({ ok: false, reason: "failed", message: "That task changed since this card was drawn · Nothing was changed" });
    expect(s.deps.setDue).not.toHaveBeenCalled();
    expect(s.store.get(p.id)?.state).toBe("approved");
  });
});
