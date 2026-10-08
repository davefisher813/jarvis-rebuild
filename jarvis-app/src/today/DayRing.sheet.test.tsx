// @vitest-environment jsdom
// Dave 2026-10-06: "make the ring tappable: Still Open on top with quick
// actions on each, Done below". (He later confirmed the counter itself is
// accurate, so it is not touched.)
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { todayISO } from "../schedule/calendar";
import { notifyFreshLists } from "../data/store";
import { ENTITY_TASK } from "../notes/types";
import TodayFlow from "./TodayFlow";

vi.mock("../shared/toast", () => ({ showToast: () => {}, hideToast: () => {} }));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

// THE CLOCK IS PINNED TO MIDDAY (2026-10-08): TodayFlow draws the evening posture (no ring) after the evening hour, so this file
// failed for everyone who ran it at night. Only Date is faked, so waitFor and the timers are untouched. Test-only.
beforeAll(() => { const d = new Date(); d.setHours(12, 0, 0, 0); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(d); });
afterAll(() => { vi.useRealTimers(); });

type Svc = import("../tasks/TasksService").TasksService;

async function mount(user: string, titles: string[], opts: { ring?: boolean } = {}) {
  let svc: Svc | null = null;
  function Grab() { svc = useTasks(); return null; }
  const view = render(
    <NotesProvider userId={user}>
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
        <Grab /><TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} />
      </GoogleSessionProvider>
    </NotesProvider>);
  const ids: string[] = [];
  for (const t of titles) ids.push((await svc!.createTask(t, { category: "c1", due: todayISO(), estimateMin: 15 }))!);
  notifyFreshLists(ENTITY_TASK);
  const ring = () => view.container.querySelector(".dring b")?.textContent;
  if (opts.ring !== false) await waitFor(() => expect(ring()).toBe(`0/${titles.length}`));
  return { svc: svc!, ids, ring, view };
}

describe("tapping the ring opens the day", () => {
  it("is a button, and opens Still Open above Done, each open row with its two quick actions", async () => {
    const { svc, ids, ring, view } = await mount("ring-sheet-1", ["Task A", "Task B", "Task C"]);
    await svc.toggleDone(ids[2]!);
    notifyFreshLists(ENTITY_TASK);
    await waitFor(() => expect(ring()).toBe("1/3"));
    const dring = view.container.querySelector(".dring") as HTMLElement;
    expect(dring.getAttribute("role")).toBe("button");
    fireEvent.click(dring);
    const sheet = await screen.findByRole("dialog", { name: "Today’s Tasks" });
    const heads = [...sheet.querySelectorAll(".sh2 .t")].map((n) => n.textContent);
    expect(heads).toEqual(["Still Open", "Done"]);
    const rows = [...sheet.querySelectorAll(".row")];
    expect(rows.map((r) => r.querySelector(".conn-name")?.textContent)).toEqual(["Task A", "Task B", "Task C"]);
    // Open rows: a check and a Tomorrow action. The done row: a check, no Tomorrow.
    expect(within(rows[0] as HTMLElement).getByRole("checkbox", { name: "Mark done" })).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByRole("button", { name: "Tomorrow" })).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).queryByRole("button", { name: "Tomorrow" })).toBeNull();
    expect(rows[2]!.querySelector(".task-check.done")).not.toBeNull();
  });

  it("ticking a row moves it from Still Open to Done and the ring behind it follows", async () => {
    const { ring, view } = await mount("ring-sheet-2", ["Task A", "Task B"]);
    fireEvent.click(view.container.querySelector(".dring") as HTMLElement);
    const sheet = await screen.findByRole("dialog", { name: "Today’s Tasks" });
    fireEvent.click(within(sheet).getAllByRole("checkbox", { name: "Mark done" })[0]!);
    await waitFor(() => expect(ring()).toBe("1/2"));
    await waitFor(() => expect([...sheet.querySelectorAll(".sh2 .t")].map((n) => n.textContent)).toEqual(["Still Open", "Done"]));
  });

  it("Tomorrow takes the row off today and out of the ring", async () => {
    const { ring, view } = await mount("ring-sheet-3", ["Task A", "Task B"]);
    fireEvent.click(view.container.querySelector(".dring") as HTMLElement);
    const sheet = await screen.findByRole("dialog", { name: "Today’s Tasks" });
    fireEvent.click(within(sheet).getAllByRole("button", { name: "Tomorrow" })[0]!);
    await waitFor(() => expect(ring()).toBe("0/1"));
    await waitFor(() => expect(sheet.querySelectorAll(".row")).toHaveLength(1));
  });

  it("Done closes the sheet", async () => {
    const { view } = await mount("ring-sheet-4", ["Task A"]);
    fireEvent.click(view.container.querySelector(".dring") as HTMLElement);
    const sheet = await screen.findByRole("dialog", { name: "Today’s Tasks" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Today’s Tasks" })).toBeNull());
  });
});

// DAVE 2026-10-06, on the live build: the header said "8 Done Today" as plain text and tapping it did nothing. In the
// evening the hero ring is gone and this line is the header, so it is the door.
describe("the evening header opens the day too", () => {
  it("the done-today line is a button that opens the same sheet", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(new Date().setHours(21, 30, 0, 0)));
    try {
      const { ids, svc, view } = await mount("ring-evening-1", ["Task A", "Task B"], { ring: false });
      await svc.toggleDone(ids[0]!);
      notifyFreshLists(ENTITY_TASK);
      const line = await waitFor(() => {
        const el = view.container.querySelector(".today-summary") as HTMLElement;
        expect(el.getAttribute("role")).toBe("button");
        return el;
      });
      expect(view.container.querySelector(".dring")).toBeNull();
      fireEvent.click(line);
      const sheet = await screen.findByRole("dialog", { name: "Today’s Tasks" });
      expect([...sheet.querySelectorAll(".sh2 .t")].map((n) => n.textContent)).toEqual(["Still Open", "Done"]);
    } finally { vi.useRealTimers(); }
  });
});
