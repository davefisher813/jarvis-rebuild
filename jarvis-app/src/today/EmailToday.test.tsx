// @vitest-environment jsdom
// EMAIL ON TODAY (docs/jarvis-unified, slice 08; IMPLEMENTATION-SPEC.md 08
// E15, 09 T1, 12; prompt 08 "Verify before completing"). The band over the
// real services in the in-memory Store and a recording session: the generic
// count per card and nothing proposed, committed email-origin items due today
// or overdue, five at most with no padding, a tomorrow callback kept off
// Today, destinations deduplicated with what Today shows already, and each
// row opening its own module or Email on a focus.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter } from "@core";
import EmailToday from "./EmailToday";
import { TasksService } from "../tasks/TasksService";
import { ScheduleService } from "../schedule/ScheduleService";
import { WaitingService } from "../substrate/waiting/WaitingService";
import type { RpcClient } from "../substrate/commands/errors";

const USER = "user-1";
const TODAY = "2026-10-03";
const client = (count: number): RpcClient => ({ rpc: async (fn) => ({ data: fn === "candidate_review_count" ? { count, messages: Math.min(count, 3) } : { error: "NOT_FOUND" }, error: null }) });

async function world() {
  const store = new Store(new InMemoryAdapter());
  const tasks = new TasksService(store, USER);
  const schedule = new ScheduleService(store, USER);
  const waiting = new WaitingService(store, USER);
  const task = (text: string, due: string | null, email = true) => store.create(USER, "task", { text, category: "", done: false, due, ...(email ? { fromThread: "t-x" } : {}) });
  const event = (title: string, date: string, start: string, email = true) => store.create(USER, "event", { title, date, start, end: "10:15", ...(email ? { source: { type: "email", ref: "t-x", at: 1 } } : {}) });
  return { store, tasks, schedule, waiting, task, event };
}
const rows = () => [...document.querySelectorAll("[data-email-row]")].map((r) => `${r.getAttribute("data-email-row")}:${(r.querySelector(".conn-name") as HTMLElement).textContent}`);

afterEach(cleanup);

describe("Email on Today", () => {
  it("the count leads, labelled per card, carries no title or amount, and opens Email on the review focus", async () => {
    const w = await world();
    const opened: unknown[] = [];
    render(<EmailToday client={client(4)} tasks={w.tasks} schedule={w.schedule} waiting={w.waiting} today={TODAY} onOpenEmail={(f) => opened.push(f)} onOpenEntity={() => {}} />);
    await waitFor(() => expect(rows()).toEqual(["review:4 Email Items to Review"]));
    expect(document.body.textContent).not.toMatch(/\$|Con Edison|142/);
    fireEvent.click(document.querySelector("[data-email-row='review']") as HTMLElement);
    expect(opened).toEqual([{ kind: "candidates" }]);
  });

  it("committed email-origin items due today or overdue ride under the count; a plain task, a done task and a tomorrow callback do not; five at most, nothing padded", async () => {
    const w = await world();
    await w.task("Review the transcript", "2026-10-01");
    await w.task("Submit the roster", TODAY);
    await w.task("Tomorrow's thing", "2026-10-04");
    await w.task("Hand-made task", TODAY, false);
    const done = await w.task("Done already", TODAY);
    await w.store.update(USER, done, { done: true });
    await w.event("Quick Call About the Deposit", TODAY, "10:00");
    await w.event("Tomorrow Callback", "2026-10-04", "10:00");
    await w.waiting.create({ title: "Peña's Transcript", waitingFor: "it", counterpartyDisplay: "Coach Miller", status: "open", startedAt: "2026-10-01T10:00:00Z", followUpOn: TODAY });
    await w.waiting.create({ title: "Later", waitingFor: "it", counterpartyDisplay: "X", status: "open", startedAt: "2026-10-01T10:00:00Z", followUpOn: "2026-10-09" });
    const empty: boolean[] = [];
    render(<EmailToday client={client(2)} tasks={w.tasks} schedule={w.schedule} waiting={w.waiting} today={TODAY} onOpenEmail={() => {}} onOpenEntity={() => {}} onEmptyChange={(e) => empty.push(e)} />);
    await waitFor(() => expect(rows().length).toBe(5));
    expect(rows()).toEqual(["review:2 Email Items to Review", "task:Review the transcript", "task:Submit the roster", "waiting:Peña's Transcript", "event:Quick Call About the Deposit"]);
    expect(document.body.textContent).not.toMatch(/Tomorrow/);
    expect(empty.at(-1)).toBe(false);
  });

  it("with no count and nothing due it renders nothing and says so", async () => {
    const w = await world();
    const empty: boolean[] = [];
    render(<EmailToday client={client(0)} tasks={w.tasks} schedule={w.schedule} waiting={w.waiting} today={TODAY} onOpenEmail={() => {}} onOpenEntity={() => {}} onEmptyChange={(e) => empty.push(e)} />);
    await waitFor(() => expect(empty.at(-1)).toBe(true));
    expect(document.querySelector("[data-email-today]")).toBeNull();
  });

  it("eight eligible items are five rows; a task Today already deals is left to it; rows open their own module", async () => {
    const w = await world();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) ids.push(await w.task(`Task ${i}`, TODAY));
    const openedEntity: string[] = [];
    render(<EmailToday client={client(0)} tasks={w.tasks} schedule={w.schedule} waiting={w.waiting} today={TODAY} excludeIds={[ids[0]!]} onOpenEmail={() => {}} onOpenEntity={(k, id) => openedEntity.push(`${k}:${id}`)} />);
    await waitFor(() => expect(rows().length).toBe(5));
    expect(rows()).not.toContain("task:Task 0");
    fireEvent.click(document.querySelector("[data-email-row='task']") as HTMLElement);
    expect(openedEntity.length).toBe(1);
    expect(openedEntity[0]).toMatch(/^task:/);
  });

  it("a waiting row opens Email on that record", async () => {
    const w = await world();
    const id = await w.waiting.create({ title: "Peña's Transcript", waitingFor: "it", counterpartyDisplay: "Coach Miller", status: "open", startedAt: "2026-10-01T10:00:00Z", followUpOn: "2026-10-02" });
    const opened: unknown[] = [];
    render(<EmailToday client={null} tasks={w.tasks} schedule={w.schedule} waiting={w.waiting} today={TODAY} onOpenEmail={(f) => opened.push(f)} onOpenEntity={() => {}} />);
    await waitFor(() => expect(rows()).toEqual(["waiting:Peña's Transcript"]));
    expect(screen.getByText("Waiting On Coach Miller · Follow Up Was Oct 2")).toBeInTheDocument();
    fireEvent.click(document.querySelector("[data-email-row='waiting']") as HTMLElement);
    expect(opened).toEqual([{ kind: "waiting", id }]);
  });
});
