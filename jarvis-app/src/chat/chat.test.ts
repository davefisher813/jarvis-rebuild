// Chat v1 (addendum item 23). The deterministic layers are pure functions,
// tested straight: Q&A answers come from records with refs, commands resolve
// under the Uncertainty Protocol (one acts, several choose bounded, zero
// refuses), and the service hard-deletes on clearAll. The AI path is only
// reached when both deterministic layers pass, which the pipeline test pins.

import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { answerQuestion, looksLikeQuestion, type AnswerSnapshot } from "./answers";
import { parseCommand, resolveTarget, CHOOSER_CAP } from "./commands";
import { ChatService } from "./ChatService";
import { ENTITY_CHAT } from "./types";

const snap = (over: Partial<AnswerSnapshot> = {}): AnswerSnapshot => ({
  today: "2026-08-15",
  nowHHMM: "09:00",
  events: [
    { id: "e1", title: "Dinner with Marco", date: "2026-08-15", start: "19:00", location: "Osteria" },
    { id: "e2", title: "Standup", date: "2026-08-15", start: "10:00" },
    { id: "e3", title: "Dentist", date: "2026-08-18", start: "14:30" },
  ],
  tasks: [
    { id: "t1", text: "Call the bank", due: "2026-08-15", done: false },
    { id: "t2", text: "Ship the deck", due: null, done: false },
    { id: "t3", text: "Old thing", due: "2026-08-01", done: true },
  ],
  leftToSpend: null,
  mailNeedsYou: null,
  ...over,
});

describe("chat deterministic Q&A", () => {
  it("answers what's today with counts from records", () => {
    const a = answerQuestion("What's today?", snap());
    expect(a?.text).toBe("2 Events · 1 Task due");
    expect(a?.provenance.kind).toBe("records");
  });

  it("answers what's next with the next event and a ref", () => {
    const a = answerQuestion("what's next", snap());
    expect(a?.text).toBe("Standup · 10 AM");
    expect(a?.provenance.refs?.[0]).toEqual({ kind: "event", id: "e2", label: "Standup" });
  });

  it("says so when nothing is left today", () => {
    const a = answerQuestion("what's next", snap({ nowHHMM: "21:00" }));
    expect(a?.text).toBe("Nothing else on the calendar today");
  });

  it("answers when is X for a unique event", () => {
    const a = answerQuestion("when is dinner with marco?", snap());
    expect(a?.text).toBe("Dinner with Marco · Today 7 PM");
  });

  it("answers when is X from tasks when no event matches", () => {
    const a = answerQuestion("when is call the bank", snap());
    expect(a?.text).toBe("Call the bank · Due today");
    expect(a?.provenance.refs?.[0]?.kind).toBe("task");
  });

  it("returns null on an unknown title instead of guessing", () => {
    expect(answerQuestion("when is the moon landing", snap())).toBeNull();
  });

  it("answers where is X from the saved location", () => {
    const a = answerQuestion("where is dinner with marco", snap());
    expect(a?.text).toBe("Dinner with Marco · Osteria");
  });

  it("is honest when an event has no location", () => {
    const a = answerQuestion("where is standup", snap());
    expect(a?.text).toBe("Standup has no location saved");
  });

  it("passes spend questions through when money is not wired", () => {
    expect(answerQuestion("how much can i spend", snap())).toBeNull();
  });

  it("returns the money layer's derived line verbatim when present", () => {
    const a = answerQuestion("what's left to spend", snap({ leftToSpend: "$140 left this week" }));
    expect(a?.text).toBe("$140 left this week");
  });

  // S6-Q42 (2026-09-05): "Chat cannot see your email." mailNeedsYou null
  // means no snapshot to trust (no Gmail connection, or too stale) -- an
  // unknown, never a false all-clear; an empty array is a real "caught up".
  it("passes email questions through when there is no snapshot to trust", () => {
    expect(answerQuestion("what needs me in email", snap())).toBeNull();
    expect(answerQuestion("what's in my email", snap())).toBeNull();
  });

  it("says so when the inbox is genuinely caught up", () => {
    const a = answerQuestion("what needs me in email", snap({ mailNeedsYou: [] }));
    expect(a?.text).toBe("Nothing needs you in email");
    expect(a?.provenance.kind).toBe("records");
  });

  it("reports the needs-you count, singular and plural, with refs to the threads", () => {
    const one = answerQuestion("what needs me in email", snap({ mailNeedsYou: [{ id: "th1", subject: "Invoice due" }] }));
    // The number-leads-a-line rule (casing.ts): the word right after gets the
    // capital, same as triage.ts's identical "1 Needs you" for this bucket.
    expect(one?.text).toBe("1 Needs you in email");
    expect(one?.provenance.refs).toEqual([{ kind: "thread", id: "th1", label: "Invoice due" }]);

    const many = answerQuestion("what needs me in email", snap({
      mailNeedsYou: [{ id: "th1", subject: "Invoice due" }, { id: "th2", subject: "Reschedule?" }],
    }));
    expect(many?.text).toBe("2 Need you in email");
  });

  it("classifies questions vs everything else", () => {
    expect(looksLikeQuestion("when is dinner")).toBe(true);
    expect(looksLikeQuestion("dentist tuesday 2pm?")).toBe(true);
    expect(looksLikeQuestion("dinner with Marco Thursday 7pm")).toBe(false);
  });
});

describe("chat commands under the Uncertainty Protocol", () => {
  const open = [
    { id: "t1", text: "Call the bank" },
    { id: "t2", text: "Call mom" },
    { id: "t3", text: "Ship the deck" },
  ];

  it("parses complete, reschedule, and delete", () => {
    expect(parseCommand("complete call the bank")).toEqual({ kind: "complete", query: "call the bank" });
    expect(parseCommand("move ship the deck to tomorrow")).toEqual({ kind: "reschedule", query: "ship the deck", when: "tomorrow" });
    expect(parseCommand("delete task call mom")).toEqual({ kind: "deleteTask", query: "call mom" });
    expect(parseCommand("dinner with Marco Thursday")).toBeNull();
  });

  it("one match resolves to act", () => {
    const r = resolveTarget(open, "bank");
    expect(r).toEqual({ kind: "one", target: { id: "t1", text: "Call the bank" } });
  });

  it("several matches return a bounded chooser, never an action", () => {
    const r = resolveTarget(open, "call");
    expect(r.kind).toBe("choose");
    if (r.kind === "choose") expect(r.options.length).toBe(2);
  });

  it("the chooser is capped", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, text: `call ${i}` }));
    const r = resolveTarget(many, "call");
    if (r.kind === "choose") expect(r.options.length).toBe(CHOOSER_CAP);
    else throw new Error("expected chooser");
  });

  it("zero matches is a refusal", () => {
    expect(resolveTarget(open, "zzz")).toEqual({ kind: "none" });
  });
});

describe("ChatService", () => {
  const rig = () => new ChatService(new Store(new InMemoryAdapter()), "u1");

  it("appends and lists in time order with provenance intact", async () => {
    const s = rig();
    await s.append({ role: "user", text: "hi" });
    await s.append({ role: "jarvis", text: "2 Events · 1 Task due", provenance: { kind: "records" } });
    const msgs = await s.list();
    expect(msgs.map((m) => m.data.text)).toEqual(["hi", "2 Events · 1 Task due"]);
    expect(msgs[1]?.data.provenance?.kind).toBe("records");
  });

  it("clearAll hard deletes every row and reports the count", async () => {
    const s = rig();
    await s.append({ role: "user", text: "a" });
    await s.append({ role: "jarvis", text: "b" });
    expect(await s.clearAll()).toBe(2);
    expect(await s.list()).toEqual([]);
    expect(await s.clearAll()).toBe(0);
  });

  it("stores under the registered entity type", () => {
    expect(ENTITY_CHAT).toBe("chat_message");
  });
});

describe("law: chat pipeline is deterministic before AI", () => {
  // The source order in ChatFlow is the law: commands run first, deterministic
  // Q&A second, and only a null from both reaches ai.complete. Pinned here
  // structurally so a refactor cannot quietly put the billed call first.
  it("ChatFlow places parseCommand and answerQuestion before ai.complete", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("./ChatFlow.tsx", import.meta.url), "utf8");
    const cmdAt = src.indexOf("parseCommand(text)");
    const qaAt = src.indexOf("answerQuestion(text");
    const aiAt = src.indexOf("ai.complete(");
    expect(cmdAt).toBeGreaterThan(-1);
    expect(qaAt).toBeGreaterThan(cmdAt);
    expect(aiAt).toBeGreaterThan(qaAt);
  });

  it("the chat AI call is foreground kind chat", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("./ChatFlow.tsx", import.meta.url), "utf8");
    expect(src).toContain('{ kind: "chat", background: false }');
  });
});
