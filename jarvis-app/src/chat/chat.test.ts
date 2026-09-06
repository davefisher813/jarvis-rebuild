// Chat v1 (addendum item 23). The deterministic layers are pure functions,
// tested straight: Q&A answers come from records with refs, commands resolve
// under the Uncertainty Protocol (one acts, several choose bounded, zero
// refuses), and the service hard-deletes on clearAll. The AI path is only
// reached when both deterministic layers pass, which the pipeline test pins.

import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { answerQuestion, looksLikeQuestion, rewriteFollowUp, type AnswerSnapshot } from "./answers";
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
  people: [],
  waiting: [],
  ...over,
});

describe("chat deterministic Q&A", () => {
  it("answers what's today with counts from records", async () => {
    const a = await answerQuestion("What's today?", snap());
    expect(a?.text).toBe("2 Events · 1 Task due");
    expect(a?.provenance.kind).toBe("records");
  });

  it("answers what's next with the next event and a ref", async () => {
    const a = await answerQuestion("what's next", snap());
    expect(a?.text).toBe("Standup · 10 AM");
    expect(a?.provenance.refs?.[0]).toEqual({ kind: "event", id: "e2", label: "Standup" });
  });

  it("says so when nothing is left today", async () => {
    const a = await answerQuestion("what's next", snap({ nowHHMM: "21:00" }));
    expect(a?.text).toBe("Nothing else on the calendar today");
  });

  it("answers when is X for a unique event", async () => {
    const a = await answerQuestion("when is dinner with marco?", snap());
    expect(a?.text).toBe("Dinner with Marco · Today 7 PM");
  });

  it("answers when is X from tasks when no event matches", async () => {
    const a = await answerQuestion("when is call the bank", snap());
    expect(a?.text).toBe("Call the bank · Due today");
    expect(a?.provenance.refs?.[0]?.kind).toBe("task");
  });

  it("returns null on an unknown title instead of guessing", async () => {
    expect(await answerQuestion("when is the moon landing", snap())).toBeNull();
  });

  it("answers where is X from the saved location", async () => {
    const a = await answerQuestion("where is dinner with marco", snap());
    expect(a?.text).toBe("Dinner with Marco · Osteria");
  });

  it("is honest when an event has no location", async () => {
    const a = await answerQuestion("where is standup", snap());
    expect(a?.text).toBe("Standup has no location saved");
  });

  it("passes spend questions through when money is not wired", async () => {
    expect(await answerQuestion("how much can i spend", snap())).toBeNull();
  });

  it("returns the money layer's derived line verbatim when present", async () => {
    const a = await answerQuestion("what's left to spend", snap({ leftToSpend: "$140 left this week" }));
    expect(a?.text).toBe("$140 left this week");
  });

  // S6-Q42 (2026-09-05): "Chat cannot see your email." mailNeedsYou null
  // means no snapshot to trust (no Gmail connection, or too stale) -- an
  // unknown, never a false all-clear; an empty array is a real "caught up".
  it("passes email questions through when there is no snapshot to trust", async () => {
    expect(await answerQuestion("what needs me in email", snap())).toBeNull();
    expect(await answerQuestion("what's in my email", snap())).toBeNull();
  });

  it("says so when the inbox is genuinely caught up", async () => {
    const a = await answerQuestion("what needs me in email", snap({ mailNeedsYou: { total: 0, threads: [] } }));
    expect(a?.text).toBe("Nothing needs you in email");
    expect(a?.provenance.kind).toBe("records");
  });

  it("reports the needs-you count, singular and plural, with refs to the threads", async () => {
    const one = await answerQuestion("what needs me in email", snap({ mailNeedsYou: { total: 1, threads: [{ id: "th1", subject: "Invoice due" }] } }));
    // The number-leads-a-line rule (casing.ts): the word right after gets the
    // capital, same as triage.ts's identical "1 Needs you" for this bucket.
    expect(one?.text).toBe("1 Needs you in email");
    expect(one?.provenance.refs).toEqual([{ kind: "thread", id: "th1", label: "Invoice due" }]);

    const many = await answerQuestion("what needs me in email", snap({
      mailNeedsYou: { total: 2, threads: [{ id: "th1", subject: "Invoice due" }, { id: "th2", subject: "Reschedule?" }] },
    }));
    expect(many?.text).toBe("2 Need you in email");
  });

  // SHELL-F-08 (2026-09-05): "Chat's what needs me in email count is capped
  // at 6." The snapshot carries the true total separately from a preview list
  // it caps at 6 for refs (snapshotRefresh.ts:129-130), and this answer
  // counted the preview: nine threads needing him, Chat said six, Today and
  // the Email tab said nine.
  it("counts what actually needs him, not the six-thread preview", async () => {
    const a = await answerQuestion("what needs me in email", snap({
      mailNeedsYou: {
        total: 9,
        threads: Array.from({ length: 6 }, (_, i) => ({ id: "th" + i, subject: "Subject " + i })),
      },
    }));
    expect(a?.text).toBe("9 Need you in email");
    // The preview is still what the refs are for, capped at four.
    expect(a?.provenance.refs).toHaveLength(4);
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
    // UP-MIND-04 (2026-09-05): both now read `asked`, the follow-up rewrite
    // of what was typed. The law is the ORDER, which is unchanged: commands
    // first, deterministic Q&A second, the billed call only after both.
    const cmdAt = src.indexOf("parseCommand(asked)");
    const qaAt = src.indexOf("answerQuestion(asked");
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

// UP-MIND-03 (2026-09-05): people as a first-class subject. All from records,
// no AI call, and the same narrow matchers the person card uses, so a wrong
// name never attaches someone else's work to a person.
describe("chat answers about a person", () => {
  const people = [
    { id: "p1", name: "Marco Silva", email: "marco@example.com", birthday: "1980-03-04", relationship: "Client" },
    { id: "p2", name: "Nadia Brandt" },
  ];
  const withPeople = (over: Partial<AnswerSnapshot> = {}) => snap({
    people,
    tasks: [
      { id: "t1", text: "Send Marco Silva the roster", due: null, done: false },
      { id: "t2", text: "Call the bank", due: null, done: false },
      { id: "t3", text: "Old Marco Silva thing", due: null, done: true },
    ],
    events: [{ id: "e1", title: "Dinner with Marco Silva", date: "2026-08-20", start: "19:00" }],
    ...over,
  });

  it("counts what is open with someone, and cites every row", async () => {
    const a = (await withPeopleAnswer("what's open with Marco Silva", withPeople()))!;
    expect(a.text).toBe("2 Open");
    expect(a.provenance.refs?.map((r) => r.id)).toEqual(["p1", "t1", "e1"]);
  });

  it("counts a thread still waiting on them alongside the open work", async () => {
    const a = (await withPeopleAnswer("what's open with Marco Silva", withPeople({
      waiting: [{ threadId: "th1", to: "Marco Silva", subject: "Field booking", days: 9 }],
    })))!;
    expect(a.text).toBe("2 Open · 1 Waiting on Marco Silva");
    expect(a.provenance.refs?.some((r) => r.kind === "thread")).toBe(true);
  });

  it("says nothing is open rather than inventing something", async () => {
    const a = (await withPeopleAnswer("what's open with Nadia Brandt", withPeople()))!;
    expect(a.text).toBe("Nothing open with Nadia Brandt");
  });

  it("names the open tasks that mention someone, and never calls them owed", async () => {
    const a = (await withPeopleAnswer("what do I owe Marco Silva", withPeople()))!;
    expect(a.text).toBe("1 Open task naming Marco Silva");
  });

  it("reads the birthday it has, and says so when it has none", async () => {
    expect((await withPeopleAnswer("when is Marco Silva's birthday", withPeople()))!.text).toBe("Marco Silva · Mar 4");
    expect((await withPeopleAnswer("when is Nadia Brandt's birthday", withPeople()))!.text).toBe("Nadia Brandt has no birthday saved");
  });

  it("distinguishes no email on file from no mail connection", async () => {
    expect((await withPeopleAnswer("when did I last talk to Nadia Brandt", withPeople()))!.text)
      .toBe("Nadia Brandt has no email on file");
    expect((await withPeopleAnswer("when did I last talk to Marco Silva", withPeople()))!.text)
      .toBe("Marco Silva · Email isn't connected");
  });

  it("reads the last message time when the mail lookup is available", async () => {
    const now = Date.parse("2026-08-15T12:00:00Z");
    const a = (await withPeopleAnswer("when did I last talk to Marco Silva", withPeople({
      now,
      lastContact: async () => now - 3 * 86400000,
    })))!;
    expect(a.text).toBe("Marco Silva · Last talked 3 Days ago");
  });

  // Two Bills: "Bill" is on the ambiguous list (it is an ordinary word), so
  // only the full name matches a row, which makes the pick change the answer.
  it("asks which one when two people answer to the name, and answers on the pick", async () => {
    const two = withPeople({
      people: [{ id: "p1", name: "Bill Silva" }, { id: "p9", name: "Bill Diaz" }],
      tasks: [{ id: "t1", text: "Send Bill Silva the roster", due: null, done: false }],
      events: [],
    });
    const ask = (await answerQuestion("what's open with Bill Silva", two))!;
    expect(ask.text).toBe("1 Open");
    const both = (await answerQuestion("what's open with Bill Silva and Bill Diaz", two))!;
    expect(both.text).toBe("Which one?");
    expect(both.choose?.map((o) => o.text)).toEqual(["Bill Silva", "Bill Diaz"]);
    const picked = (await answerQuestion("what's open with Bill Silva and Bill Diaz", two, { id: "p9" }))!;
    expect(picked.text).toBe("Nothing open with Bill Diaz");
  });

  it("falls through to the AI path when it knows nobody by that name", async () => {
    expect(await answerQuestion("what's open with Priya", withPeople())).toBeNull();
  });
});

const withPeopleAnswer = (q: string, s: AnswerSnapshot) => answerQuestion(q, s);

// UP-MIND-04 (2026-09-05): a follow-up resolves against the conversation.
// The rewriter answers nothing; it says what was MEANT, so every shape above
// stays stateless and a rewrite it cannot make honestly is a null.
describe("chat follow-ups", () => {
  it("rewrites and tomorrow into a whole question", () => {
    expect(rewriteFollowUp("and tomorrow?", { question: "what's on today" })).toBe("what's on tomorrow");
    expect(rewriteFollowUp("what about today", { question: "what's on tomorrow" })).toBe("what's on today");
  });

  it("answers the rewritten day question from records", async () => {
    const a = (await answerQuestion("what's on tomorrow", snap({
      events: [{ id: "e9", title: "Dentist", date: "2026-08-16", start: "14:30" }],
      tasks: [],
    })))!;
    expect(a.text).toBe("1 Event · 0 Tasks due");
    expect(a.provenance.refs?.[0]?.id).toBe("e9");
  });

  it("carries the verb over onto a new subject", () => {
    expect(rewriteFollowUp("and the standup", { question: "when is the dentist" })).toBe("when is the standup");
  });

  it("refuses to carry a verb that has no subject", () => {
    expect(rewriteFollowUp("and the standup", { question: "how much can i spend" })).toBeNull();
  });

  it("fills a pronoun from the record the last answer cited", () => {
    const prior = { question: "what's next", refs: [{ kind: "event", id: "e2", label: "Standup" }] };
    expect(rewriteFollowUp("where is it", prior)).toBe("where is Standup");
    expect(rewriteFollowUp("move it to friday", prior)).toBe("move Standup to friday");
  });

  it("stays silent with nothing to resolve against", () => {
    expect(rewriteFollowUp("where is it", null)).toBeNull();
    expect(rewriteFollowUp("where is it", { question: "what's on today" })).toBeNull();
    expect(rewriteFollowUp("what's on today", { question: "what's next" })).toBeNull();
  });
});
