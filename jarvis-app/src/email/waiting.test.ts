import { describe, it, expect } from "vitest";
import { ageWord, daysBetween, emailTodayRows, followUpRecipients, followUpState, localDate, newReply, orderWaiting, reviewLine, type ThreadMessage } from "./waiting";
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
  it("recipients come from the thread's own senders, Reply-To first, never the person, each once", () => {
    const msg = (o: Partial<ThreadMessage>): ThreadMessage => ({ id: "m", account_id: "a", account: "dave@example.test", provider_id: "p", thread_id: "t", internal_date: "2026-10-03T00:00:00Z", from_address: "coach@example.test", from_name: "Coach", to_addresses: [], cc_addresses: [], subject: "", snippet: "", has_body: true, deleted: false, source_hash: "s", reply_to: "", message_id_header: "", references: [], ...o });
    expect(followUpRecipients([msg({ reply_to: "desk@school.test" }), msg({ from_address: "dave@example.test" }), msg({ from_address: "Coach@Example.test" })], ["dave@example.test"])).toEqual(["desk@school.test", "coach@example.test"]);
    expect(followUpRecipients([msg({ from_address: "dave@example.test" })], ["dave@example.test"])).toEqual([]);
  });
});

describe("Today's Email rows (12, E15, T1)", () => {
  it("the count leads when there is one, labelled per card, and is omitted when there is none", () => {
    expect(reviewLine(4)).toBe("4 Email Items to Review");
    expect(reviewLine(1)).toBe("1 Email Item to Review");
    expect(emailTodayRows({ count: 4, tasks: [], events: [], waiting: [], today: TODAY }).map((r) => r.title)).toEqual(["4 Email Items to Review"]);
    expect(emailTodayRows({ count: 0, tasks: [], events: [], waiting: [], today: TODAY })).toEqual([]);
  });
  it("committed email-origin items due today or overdue, overdue first, then by time; tomorrow never; nothing padded", () => {
    const rows = emailTodayRows({
      count: 2, today: TODAY,
      tasks: [task("t-today", TODAY), task("t-over", "2026-10-01"), task("t-tomorrow", "2026-10-04"), task("t-done", TODAY, { done: true }), task("t-plain", TODAY, { fromThread: undefined, source: undefined } as Partial<TaskItem["data"]>), task("t-nodue", null)],
      events: [event("e-today", TODAY, "10:00"), event("e-tomorrow", "2026-10-04", "10:00"), event("e-plain", TODAY, "09:00", { source: undefined, emailIds: [] })],
      waiting: [w("w-today", { followUpOn: TODAY }), w("w-over", { followUpOn: "2026-10-02" }), w("w-later", { followUpOn: "2026-10-09" }), w("w-none"), w("w-resolved", { followUpOn: TODAY, status: "resolved" })],
      cap: 10,
    });
    // Overdue first by date; then today's, the dated ones before the timed one, each by its key.
    expect(rows.map((r) => `${r.kind}:${r.id}`)).toEqual(["review:review", "task:t-over", "waiting:w-over", "task:t-today", "waiting:w-today", "event:e-today"]);
    expect(rows[1]!.line).toBe("Task · Was Due Oct 1");
    expect(rows[3]!.line).toBe("Task · Due Today");
    expect(rows[4]!.line).toBe("Waiting On Coach Miller · Follow Up Today");
    expect(rows[5]!.line).toBe("Schedule · 10:00 to 10:15");
  });
  it("five at most including the count: 0, 1, 3, 5 and 8 eligible items", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => task(`t${i}`, TODAY));
    expect(emailTodayRows({ count: 1, tasks: many(0), events: [], waiting: [], today: TODAY }).length).toBe(1);
    expect(emailTodayRows({ count: 1, tasks: many(1), events: [], waiting: [], today: TODAY }).length).toBe(2);
    expect(emailTodayRows({ count: 1, tasks: many(3), events: [], waiting: [], today: TODAY }).length).toBe(4);
    expect(emailTodayRows({ count: 1, tasks: many(5), events: [], waiting: [], today: TODAY }).length).toBe(5);
    expect(emailTodayRows({ count: 1, tasks: many(8), events: [], waiting: [], today: TODAY }).length).toBe(5);
    expect(emailTodayRows({ count: 0, tasks: many(8), events: [], waiting: [], today: TODAY }).length).toBe(5);
    expect(emailTodayRows({ count: 0, tasks: many(2), events: [], waiting: [], today: TODAY }).length).toBe(2);
  });
  it("each destination once: an item Today already shows elsewhere is left to it, and a duplicate id is one row", () => {
    const rows = emailTodayRows({ count: 0, tasks: [task("dealt", TODAY), task("other", TODAY)], events: [], waiting: [], today: TODAY, excludeIds: new Set(["dealt"]) });
    expect(rows.map((r) => r.id)).toEqual(["other"]);
    expect(emailTodayRows({ count: 0, tasks: [task("same", TODAY), task("same", "2026-10-01")], events: [], waiting: [], today: TODAY }).length).toBe(1);
  });
  it("no proposed title ever rides along: the only Email words are the count's", () => {
    const rows = emailTodayRows({ count: 3, tasks: [], events: [], waiting: [], today: TODAY });
    expect(rows[0]).toMatchObject({ kind: "review", id: "review", title: "3 Email Items to Review", line: "Open Email to Review" });
  });
});
