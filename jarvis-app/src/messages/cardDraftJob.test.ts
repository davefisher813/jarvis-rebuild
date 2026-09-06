import { describe, it, expect, vi } from "vitest";
import { cardDraftJob } from "./cardDraftJob";
import type { MailSnapshot } from "./home";

// The whole reason this module exists is that the tap handler and the
// background pass have to agree about the hash. If they disagreed by one
// space, every pre-generated entry would miss and the feature would look
// like it worked while spending double. So these tests are mostly about the
// hash: what changes it, and what must not.

const snap = (over: Partial<MailSnapshot> = {}): MailSnapshot => ({
  ts: 0, needsYou: 1, threads: [], waiting: [], promises: [], ...over,
});

const thread = (over = {}) => ({
  id: "t1", from: "Nadia", subject: "Invoice", gist: "She needs the invoice",
  snippet: "Can you send the invoice today?", by: "", account: "a@b.c", ...over,
} as MailSnapshot["threads"][number]);

const wait = (over = {}) => ({
  threadId: "w1", to: "Rob", subject: "Field booking", days: 9, ...over,
} as MailSnapshot["waiting"][number]);

const noInstruction = () => "";
// Typed with the arguments the job actually passes, so a test can assert what
// reached `system` (UP-MIND-01) and not just that a call happened.
const complete = vi.fn(async (messages: { role: string; content: string }[], system: string) => {
  void messages; void system;
  return "Sending it over this afternoon.";
});

const job = (n: { kind: string; threadId: string }, s: MailSnapshot, counts = {}, instr = noInstruction, voice = "") =>
  cardDraftJob(n, s, counts, instr, complete, voice);

describe("cardDraftJob", () => {
  it("describes a reply as a request keyed by its thread", () => {
    const j = job({ kind: "reply", threadId: "t1" }, snap({ threads: [thread()] }));
    expect(j?.kind).toBe("reply");
    expect(j?.sourceId).toBe("t1");
    expect(j?.pin).toBe("emailDrafts");
    expect(j?.hash).toBeTruthy();
  });

  it("returns null when the snapshot no longer holds the thread", () => {
    expect(job({ kind: "reply", threadId: "gone" }, snap({ threads: [thread()] }))).toBeNull();
  });

  it("returns null for a nudge with no recipient or subject to nudge about", () => {
    expect(job({ kind: "nudge", threadId: "w1" }, snap())).toBeNull();
  });

  // The point of the hash: same email in, same key out, whichever path asked.
  it("gives the same hash for the same source, called twice", () => {
    const s = snap({ threads: [thread()] });
    const a = job({ kind: "reply", threadId: "t1" }, s);
    const b = job({ kind: "reply", threadId: "t1" }, s);
    expect(a?.hash).toBe(b?.hash);
  });

  it("changes the hash when the email itself changes", () => {
    const a = job({ kind: "reply", threadId: "t1" }, snap({ threads: [thread()] }));
    const b = job({ kind: "reply", threadId: "t1" }, snap({ threads: [thread({ snippet: "Actually, next week is fine." })] }));
    expect(a?.hash).not.toBe(b?.hash);
  });

  it("changes the hash when the subject changes", () => {
    const a = job({ kind: "reply", threadId: "t1" }, snap({ threads: [thread()] }));
    const b = job({ kind: "reply", threadId: "t1" }, snap({ threads: [thread({ subject: "Invoice, revised" })] }));
    expect(a?.hash).not.toBe(b?.hash);
  });

  // A nudge that has climbed a rung is a different draft. A cache that
  // ignored the rung would keep serving the gentle version forever, which is
  // the exact failure the escalation ladder exists to prevent.
  it("changes the hash when the nudge escalates", () => {
    const s = snap({ waiting: [wait()] });
    const gentle = job({ kind: "nudge", threadId: "w1" }, s, {}, () => "Keep it light.");
    const firm = job({ kind: "nudge", threadId: "w1" }, s, {}, () => "Name a date.");
    expect(gentle?.hash).not.toBe(firm?.hash);
  });

  it("changes the hash when the wait gets longer", () => {
    const a = job({ kind: "nudge", threadId: "w1" }, snap({ waiting: [wait({ days: 9 })] }));
    const b = job({ kind: "nudge", threadId: "w1" }, snap({ waiting: [wait({ days: 55 })] }));
    expect(a?.hash).not.toBe(b?.hash);
  });

  it("changes the hash when another nudge has already been sent", () => {
    const s = snap({ waiting: [wait()] });
    const a = job({ kind: "nudge", threadId: "w1" }, s, { w1: 0 });
    const b = job({ kind: "nudge", threadId: "w1" }, s, { w1: 2 });
    expect(a?.hash).not.toBe(b?.hash);
  });

  // A reply and a nudge for the same thread are different drafts, and
  // pregen keys on kind + id precisely so one cannot answer for the other.
  it("files a chase under the nudge namespace, not its own", () => {
    const s = snap({ chases: [{ threadId: "w1", to: "Rob", subject: "Field booking" }] as MailSnapshot["chases"] });
    expect(job({ kind: "chase", threadId: "w1" }, s)?.kind).toBe("nudge");
  });

  // UP-MIND-01: the home page's drafts used to skip the How You Write doc
  // entirely, so they read generic while the Sweep deck's read like him.
  it("carries the voice into the system prompt of a reply", async () => {
    complete.mockClear();
    const j = job({ kind: "reply", threadId: "t1" }, snap({ threads: [thread()] }), {}, noInstruction, "Writing voice: short, no greeting.");
    await j!.build();
    expect(complete.mock.calls[0]![1]).toContain("Writing voice: short, no greeting.");
  });

  it("carries the voice into the system prompt of a nudge", async () => {
    complete.mockClear();
    const j = job({ kind: "nudge", threadId: "w1" }, snap({ waiting: [wait()] }), {}, noInstruction, "Writing voice: short, no greeting.");
    await j!.build();
    expect(complete.mock.calls[0]![1]).toContain("Writing voice: short, no greeting.");
  });

  // The doc is an input to the prompt, so it is an input to the hash: an
  // edited voice must not keep serving the draft the old voice wrote.
  it("changes the hash when the voice changes", () => {
    const s = snap({ threads: [thread()] });
    const a = job({ kind: "reply", threadId: "t1" }, s, {}, noInstruction, "");
    const b = job({ kind: "reply", threadId: "t1" }, s, {}, noInstruction, "Never opens with Hi there.");
    expect(a?.hash).not.toBe(b?.hash);
  });

  it("builds through the caller's complete, and parses what comes back", async () => {
    complete.mockClear();
    const j = job({ kind: "reply", threadId: "t1" }, snap({ threads: [thread()] }));
    const text = await j!.build();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(text).toBe("Sending it over this afternoon.");
  });

  // Building is what costs a model call, so it must not happen until asked.
  it("does not call the model just to describe the job", () => {
    complete.mockClear();
    job({ kind: "reply", threadId: "t1" }, snap({ threads: [thread()] }));
    expect(complete).not.toHaveBeenCalled();
  });
});
