import { describe, it, expect } from "vitest";
import { isAutoReplyHeaders } from "./autoReply";
import { ageWord, daysBetween, emailTodayRows, followUpRecipients, followUpState, localDate, newReply, orderWaiting, pausedLine, type ThreadMessage } from "./waiting";
import type { WaitingItem } from "../substrate/waiting/types";
import type { TaskItem } from "../tasks/TasksService";
import type { EventItem } from "../schedule/types";

const TODAY = "2026-10-03";
const w = (id: string, o: Partial<WaitingItem["data"]> = {}): WaitingItem => ({ id, data: { title: `Waiting ${id}`, waitingFor: "it", counterpartyDisplay: "Coach Miller", status: "open", startedAt: "2026-10-01T15:00:00Z", threadId: "t-" + id, ...o } });
const task = (id: string, due: string | null, o: Partial<TaskItem["data"]> = {}): TaskItem => ({ id, data: { text: `Task ${id}`, category: "", done: false, due, fromThread: "t-x", ...o } as TaskItem["data"] });
const event = (id: string, date: string, start: string, o: Partial<EventItem["data"]> = {}): EventItem => ({ id, data: { title: `Event ${id}`, date, start, end: "10:15", source: { type: "email" }, ...o } as EventItem["data"] });

describe("the words, in local dates (12)", () => {
  it("ages are whole local days with no urgency in them", () => {
    expect(ageWord("2026-10-03T01:00:00Z", TODAY, "UTC")).toBe("Today");
    expect(ageWord("2026-10-02T23:30:00Z", TODAY, "UTC")).toBe("Yesterday");
    expect(ageWord("2026-09-30T12:00:00Z", TODAY, "UTC")).toBe("3 Days");
    expect(ageWord("2026-09-12T12:00:00Z", TODAY, "UTC")).toBe("3 Weeks");
    expect(ageWord("2026-07-01T12:00:00Z", TODAY, "UTC")).toBe("3 Months");
    // Late evening in New York is already the next day in UTC; the person's date wins.
    expect(localDate("2026-10-03T03:30:00Z", "America/New_York")).toBe("2026-10-02");
    expect(ageWord("2026-10-03T03:30:00Z", TODAY, "America/New_York")).toBe("Yesterday");
    expect(daysBetween("2026-10-01", "2026-10-03")).toBe(2);
  });
  it("a follow-up date is none, overdue, today or upcoming", () => {
    expect(followUpState(undefined, TODAY)).toBe("none");
    expect(followUpState("2026-10-02", TODAY)).toBe("overdue");
    expect(followUpState("2026-10-03", TODAY)).toBe("today");
    expect(followUpState("2026-10-10", TODAY)).toBe("upcoming");
  });
  it("open items lead with overdue and today's follow-ups, then newest; resolved newest first", () => {
    const { open, resolved } = orderWaiting([
      w("a", { startedAt: "2026-10-02T10:00:00Z" }), w("b", { followUpOn: "2026-10-10", startedAt: "2026-09-01T10:00:00Z" }), w("c", { followUpOn: "2026-10-01" }), w("d", { followUpOn: "2026-10-03" }),
      w("r1", { status: "resolved", resolvedAt: "2026-10-01T10:00:00Z" }), w("r2", { status: "resolved", resolvedAt: "2026-10-02T10:00:00Z" }),
    ], TODAY);
    expect(open.map((x) => x.id)).toEqual(["c", "d", "a", "b"]);
    expect(resolved.map((x) => x.id)).toEqual(["r2", "r1"]);
  });
});

describe("New Reply and the follow-up's address (E12, E14)", () => {
  const latest = { message_id: "m9", internal_date: "2026-10-03T16:00:00Z", from_address: "coach@example.test", from_name: "Coach Miller", subject: "Re: Transcript", account_id: "acct" };
  it("a newer message from the counterparty is a New Reply; the person's own reply, an older message, or a resolved record is not", () => {
    const item = { startedAt: "2026-10-02T15:10:00Z", threadId: "t-a2", status: "open" as const };
    expect(newReply(item, latest, ["dave@example.test"])).toEqual(latest);
    expect(newReply(item, { ...latest, from_address: "Dave@Example.test" }, ["dave@example.test"])).toBeNull();
    expect(newReply(item, { ...latest, internal_date: "2026-10-02T15:00:00Z" }, [])).toBeNull();
    expect(newReply({ ...item, status: "resolved" }, latest, [])).toBeNull();
    expect(newReply(item, undefined, [])).toBeNull();
  });
  it("an automatic reply is not a New Reply (spec 5.3): the auto_reply fact (0071), or a subject that starts like one", () => {
    const item = { startedAt: "2026-10-02T15:10:00Z", threadId: "t-a2", status: "open" as const };
    expect(newReply(item, { ...latest, auto_reply: true }, [])).toBeNull();
    for (const subject of ["Automatic reply: Transcript", "Out of Office: Re: Transcript", "out of the office until Monday", "Auto: Away", "AutoReply: Transcript", "Auto-Reply: Transcript"]) {
      expect(newReply(item, { ...latest, subject }, []), subject).toBeNull();
    }
    // Conservative: only a subject that STARTS with the marker. A person writing about office hours is still a reply.
    expect(newReply(item, { ...latest, subject: "Re: Out of office hours next week" }, [])).toEqual({ ...latest, subject: "Re: Out of office hours next week" });
    expect(isAutoReplyHeaders("auto-replied", null)).toBe(true);
    expect(isAutoReplyHeaders("no", "list")).toBe(false);
    expect(isAutoReplyHeaders(null, "junk")).toBe(true);
  });
  it("recipients come from the thread's own senders, Reply-To first, never the person, each once", () => {
    const msg = (o: Partial<ThreadMessage>): ThreadMessage => ({ id: "m", account_id: "a", account: "dave@example.test", provider_id: "p", thread_id: "t", internal_date: "2026-10-03T00:00:00Z", from_address: "coach@example.test", from_name: "Coach", to_addresses: [], cc_addresses: [], subject: "", snippet: "", has_body: true, deleted: false, source_hash: "s", reply_to: "", message_id_header: "", references: [], ...o });
    expect(followUpRecipients([msg({ reply_to: "desk@school.test" }), msg({ from_address: "dave@example.test" }), msg({ from_address: "Coach@Example.test" })], ["dave@example.test"])).toEqual(["desk@school.test", "coach@example.test"]);
    expect(followUpRecipients([msg({ from_address: "dave@example.test" })], ["dave@example.test"])).toEqual([]);
  });
});

// ISSUE 112 (ruling 18, Dave 2026-10-13; Email Build Spec section 7, AC48). These tests were rewritten when the Email band stopped
// drawing a second, email-flavoured copy of the tasks and events a capture made. They used to cover "committed email-origin
// items" (tasks, events and Waiting) in one list; Email's Today rows are now the combined paused card and the due Waiting
// follow-ups, and nothing else. The task and event copies are Tasks' and Schedule's to show, once (today/onceOnToday.ts).
describe("Today's Email rows (12, E15, T1; issue 112)", () => {
  const dueToday = (n: number) => Array.from({ length: n }, (_, i) => w(`w${i}`, { followUpOn: TODAY }));
  const paused = { count: 1, replies: 1 };
  const none = { count: 0, replies: 0 };

  it("the combined paused card leads only while paused sends exist, in Dave's words; the generic review count is never on Today", () => {
    expect(pausedLine(2, 2)).toBe("2 Replies Need Your Review");
    expect(pausedLine(1, 1)).toBe("1 Reply Needs Your Review");
    expect(pausedLine(1, 0)).toBe("1 Message Needs Your Review");
    expect(pausedLine(3, 2)).toBe("3 Messages Need Your Review");
    expect(emailTodayRows({ paused: { count: 2, replies: 2 }, waiting: [], today: TODAY }).map((r) => r.title)).toEqual(["2 Replies Need Your Review"]);
    expect(emailTodayRows({ paused: none, waiting: [], today: TODAY })).toEqual([]);
    expect(emailTodayRows({ paused: null, waiting: [], today: TODAY })).toEqual([]);
  });

  it("open Waiting follow-ups due today or overdue, overdue first, then today's; tomorrow, later, undated and resolved never; nothing padded", () => {
    const rows = emailTodayRows({
      paused: { count: 2, replies: 2 }, today: TODAY,
      waiting: [w("w-today", { followUpOn: TODAY }), w("w-over", { followUpOn: "2026-10-02" }), w("w-older", { followUpOn: "2026-10-01" }), w("w-tomorrow", { followUpOn: "2026-10-04" }), w("w-later", { followUpOn: "2026-10-09" }), w("w-none"), w("w-resolved", { followUpOn: TODAY, status: "resolved" })],
      cap: 10,
    });
    // The card first; then overdue by date, oldest first; then today's.
    expect(rows.map((r) => `${r.kind}:${r.id}`)).toEqual(["paused:paused", "waiting:w-older", "waiting:w-over", "waiting:w-today"]);
    expect(rows[1]!.facts).toEqual([{ text: "Follow Up Was Oct 1", tone: "red" }, { text: "Waiting On Coach Miller" }]);
    // The toned fact leads and the free-text name is last: a facts line ellipsizes only its last fact.
    expect(rows[3]!.facts).toEqual([{ text: "Follow Up Today", tone: "warn" }, { text: "Waiting On Coach Miller" }]);
  });

  it("five at most including the card: 0, 1, 3, 5 and 8 due Waiting items", () => {
    expect(emailTodayRows({ paused, waiting: dueToday(0), today: TODAY }).length).toBe(1);
    expect(emailTodayRows({ paused, waiting: dueToday(1), today: TODAY }).length).toBe(2);
    expect(emailTodayRows({ paused, waiting: dueToday(3), today: TODAY }).length).toBe(4);
    expect(emailTodayRows({ paused, waiting: dueToday(5), today: TODAY }).length).toBe(5);
    expect(emailTodayRows({ paused, waiting: dueToday(8), today: TODAY }).length).toBe(5);
    expect(emailTodayRows({ paused: none, waiting: dueToday(8), today: TODAY }).length).toBe(5);
    expect(emailTodayRows({ paused: none, waiting: dueToday(2), today: TODAY }).length).toBe(2);
    // The card is never the row the cap cuts.
    expect(emailTodayRows({ paused, waiting: dueToday(8), today: TODAY })[0]).toMatchObject({ kind: "paused" });
  });

  it("each destination once: a Waiting record that appears twice is one row", () => {
    const rows = emailTodayRows({ paused: none, waiting: [w("same", { followUpOn: "2026-10-02" }), w("same", { followUpOn: "2026-10-01" }), w("other", { followUpOn: TODAY })], today: TODAY });
    expect(rows.map((r) => r.id)).toEqual(["same", "other"]);
    // The first of the two is the row that was taken.
    expect(rows[0]!.facts[0]).toEqual({ text: "Follow Up Was Oct 2", tone: "red" });
  });

  it("Email's rows are its own (issue 112): the only kinds are the paused card and Waiting, and a task or an event handed in anyway draws nothing", () => {
    // A task and an event with an email origin, due today. They used to be band rows; they are Tasks' and Schedule's now.
    const stale = { paused, waiting: [w("w1", { followUpOn: TODAY })], today: TODAY, tasks: [task("t1", TODAY), task("t2", "2026-10-01")], events: [event("e1", TODAY, "10:00")] };
    const rows = emailTodayRows(stale as unknown as Parameters<typeof emailTodayRows>[0]);
    expect(rows.map((r) => r.kind)).toEqual(["paused", "waiting"]);
    expect(rows.map((r) => r.id)).toEqual(["paused", "w1"]);
    // And the type says so: there is no task or event input to pass.
    // @ts-expect-error tasks is not an input any more
    emailTodayRows({ waiting: [], today: TODAY, tasks: [] });
    // @ts-expect-error events is not an input any more
    emailTodayRows({ waiting: [], today: TODAY, events: [] });
  });

  it("no proposed title ever rides along: the only Email words are the paused card's", () => {
    const rows = emailTodayRows({ paused: { count: 3, replies: 3 }, waiting: [], today: TODAY });
    expect(rows[0]).toMatchObject({ kind: "paused", id: "paused", title: "3 Replies Need Your Review", facts: [] });
  });
});
