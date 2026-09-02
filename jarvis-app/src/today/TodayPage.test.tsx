// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import TodayPage from "./TodayPage";
import type { EventItem } from "../schedule/types";
import type { TaskItem } from "../tasks/TasksService";
import { setCategoryRegistry } from "../shared/categories";
import NoticeCard from "./NoticeCard";
import { WAITING, FAILING, NEW, RESUME } from "./stream";

setCategoryRegistry([
  { id: "orgB", name: "Ridgeley", color: "sky" },
  { id: "elite", name: "Elite", color: "red" },
  { id: "family", name: "Family", color: "pink" },
  { id: "money", name: "Money", color: "yellow" },
  { id: "health", name: "Health", color: "green" },
  { id: "brain", name: "Brain", color: "blue" },
  { id: "friends", name: "Friends", color: "teal" },
]);


const ev = (id: string, start: string, cat = "orgB"): EventItem => ({ id, data: { title: id, date: "2026-05-20", start, category: cat } });
const tk = (id: string, due: string | null, cat = "orgB", done = false): TaskItem => ({ id, data: { text: id, category: cat, done, due } });

const base = {
  greeting: "Good Morning",
  dateLong: "Wednesday, May 20",
  summary: { events: 2, due: 1, overdue: 1, moves: 0 },
  todayEvents: [ev("e1", "09:00")],
  now: "08:00",
  nowLabel: "8:00",
  tomorrowEvents: [ev("t1", "09:00")],
  tomorrowDate: "Thu, May 21",
  tasks: [tk("over", "2026-05-18"), tk("due", "2026-05-20")],
  today: "2026-05-20",
  onSeeAllSchedule: () => {},
  onSeeAllTasks: () => {},
};

describe("TodayPage", () => {
  it("renders greeting, date, and the summary with overdue in red", () => {
    const { container } = render(<TodayPage {...base} />);
    expect(screen.getByText("Good Morning")).toBeInTheDocument();
    expect(screen.getByText("Wednesday, May 20")).toBeInTheDocument();
    // SPEC MOVED AGAIN (ruled 2026-09-01, superseding Catalog V3.1): the
    // workload line is stat TILES, number big with the word small beneath.
    // Time is blue, due is a quiet count, late wears amber (red from three),
    // goals are green, and a zero tile does not render at all.
    const summary = container.querySelector(".today-summary")!;
    const tiles = summary.querySelectorAll(".stat-tile");
    expect(tiles.length).toBe(3);
    expect(summary.querySelector(".st-time .st-n")).toHaveTextContent("2");
    expect(summary.querySelector(".st-time .st-w")).toHaveTextContent("events");
    expect(summary.querySelector(".st-quiet .st-n")).toHaveTextContent("1");
    expect(summary.querySelector(".st-quiet .st-w")).toHaveTextContent("due");
    expect(summary.querySelector(".st-warn .st-n")).toHaveTextContent("1");
    expect(summary.querySelector(".st-warn .st-w")).toHaveTextContent("late");
    expect(summary.querySelector(".st-late")).toBeNull(); // one late is amber, not red
    expect(summary.querySelector(".day-pill")).toBeNull(); // the old pills are gone
  });

  it("Your Move deals ONE task into the stream with its reason and the deck receipt", () => {
    // Combine B (resumed 2026-08-26): Heads Up and Up Next were two sections
    // answering the same question; the dealt task now rides the one stream.
    // It keeps the standard row anatomy (check + title + urgency) plus the
    // reason line every automatic pick owes; the deck behind it is a count
    // on a receipt that opens the Focus flow. With one member there is
    // nothing folded, so the head carries no See All (the button belongs to
    // the fold now, not to navigation).
    const { container } = render(
      <TodayPage {...base} upNext={[tk("over", "2026-05-18")]} upNextWaiting={2}
        upNextReason="Waiting 2 days" onUpNext={() => {}} />,
    );
    expect(screen.getByText("Your Move")).toBeInTheDocument();
    expect(screen.queryByText("Up Next")).toBeNull(); // the section is gone, not renamed twice
    expect(screen.queryByText("See All")).toBeNull();
    // THE RULED ROW (2026-09-01): the ring is never category-coloured, the
    // category rides the kicker bar, and urgency is a chip on the kicker line
    // that says the DISTANCE. Two days past 2026-05-18 on 2026-05-20.
    expect(container.querySelector(".task-check.cat-bd-sky")).toBeNull();
    expect(container.querySelector(".task-row .r-bar.cat-bg-sky")).toBeTruthy();
    expect(container.querySelector(".uchip.u-late")).toHaveTextContent("2 DAYS LATE");
    expect(container.querySelector(".urgency-red")).toBeNull(); // the trailing label is gone
    // SAY IT ONCE: the reason's due-part ("Waiting 2 days") is what the chip
    // now says, so it is not printed a second time under the kicker.
    expect(screen.queryByText("Waiting 2 days")).toBeNull();
    expect(screen.getByText("2 More waiting \u00b7 Skip deals the next one")).toBeInTheDocument();
    // one dealt card means one task row, however deep the deck is
    expect(container.querySelectorAll(".task-row").length).toBe(1);
    // the old daytime task list stays replaced
    expect(screen.queryByText("Today\u2019s Tasks")).toBeNull();
  });

  it("the reason line keeps only what the chip does not already say", () => {
    // "Due today · your focus peak": the chip says TODAY, so the line says
    // just the peak. A reason that is ONLY the due-part renders no line.
    const { container, rerender } = render(
      <TodayPage {...base} upNext={[tk("due", "2026-05-20")]} upNextReason={"Due today \u00b7 your focus peak"} onUpNext={() => {}} />,
    );
    expect(container.querySelector(".uchip.u-today")).toHaveTextContent("TODAY");
    // "Together" (2026-09-01): the reason is the second line now, sentence
    // case, after the chip. No third line, no caps eyebrow.
    expect(container.querySelector(".r-k .r-why")).toHaveTextContent("Your focus peak");
    expect(container.querySelector(".task-title .eyebrow")).toBeNull();
    expect(screen.queryByText(/Due today/)).toBeNull();
    // A reason that was only the due-part leaves the line to the goal, or,
    // with no goal, the category.
    rerender(<TodayPage {...base} upNext={[tk("due", "2026-05-20")]} upNextReason="Due today" onUpNext={() => {}} />);
    expect(container.querySelector(".r-k .r-why")).toBeNull();
    expect(container.querySelector(".r-k .r-goal")).toBeTruthy();
  });

  it("shows three, folds the rest behind See All in the head, Less refolds", () => {
    // "Option 1 with a limit. Have a see all button if it exceeds 3 things"
    // (Dave 2026-08-26). The cap counts rows; the ranker has already put
    // the heaviest three on top, so what folds is the lightest. See All
    // expands IN PLACE: what folds is mostly notices, and notices live on
    // no other page, so a See All that navigated would show him everything
    // except what it hid.
    const notice = (title: string, weight: number) => (
      <NoticeCard key={title} weight={weight} icon={null} title={title} action={{ label: "Do It", onClick: () => {} }} />
    );
    const { container } = render(
      <TodayPage {...base} offersQuiet upNext={[tk("over", "2026-05-18")]} upNextReason="Waiting 2 days"
        onUpNext={() => {}} notices={[
          notice("Day Is Sliding", FAILING),
          notice("Money Waits", WAITING),
          notice("Fresh Offer", NEW),
          notice("Old Thread", RESUME),
        ]} />,
    );
    const streamRows = () =>
      container.querySelectorAll(".heads-up-stream .notice-vrow").length +
      container.querySelectorAll(".heads-up-stream .task-row").length;
    // Shown: FAILING, WAITING, then NEW -- the three heaviest non-anchor
    // members. The dealt task is DEALT-weight and the stream's anchor
    // (2026-08-26, "I don't want a task wedged in between 2 arrows"):
    // FAILING(90) outranks its 71, so the WHOLE notice block rides above
    // it, not just FAILING, which pushes the anchor itself down to fold
    // with the lightest notice (Old Thread) instead of riding mid-list.
    expect(streamRows()).toBe(3);
    expect(screen.getByText("Day Is Sliding")).toBeInTheDocument();
    expect(screen.getByText("Fresh Offer")).toBeInTheDocument();
    expect(screen.queryByText("Old Thread")).toBeNull();
    expect(screen.queryByText("over")).toBeNull(); // the dealt task's title
    fireEvent.click(screen.getByText("See All"));
    expect(streamRows()).toBe(5);
    expect(screen.getByText("Old Thread")).toBeInTheDocument();
    expect(screen.getByText("over")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Less"));
    expect(streamRows()).toBe(3);
    expect(screen.queryByText("over")).toBeNull();
  });

  it("rows down a pinned card too: one grammar, no exceptions in the stream", () => {
    // The pinned-card exemption is repealed in the stream (Dave 2026-08-26,
    // Option 1 picked with the tradeoff stated). A producer may still ask
    // for the card form; the stream rows it down, and tap-to-expand is
    // where the full card lives now.
    const { container } = render(
      <TodayPage {...base} offersQuiet notices={[
        <NoticeCard key="g" form="card" weight={RESUME} icon={null}
          title="Run three times a week" sub="Nothing today moves it"
          action={{ label: "Pick One", onClick: () => {} }} />,
      ]} />,
    );
    const stream = container.querySelector(".heads-up-stream")!;
    expect(stream.querySelectorAll(".notice-card-row").length).toBe(1);
    // nothing in the stream kept the card form (the box only returns on tap)
    expect(stream.querySelectorAll(".notice-card:not(.notice-card-row)").length).toBe(0);
    // the rows ride inside ONE grouped card, the page's own material
    // (Dave 2026-08-26: bare rows "don't look like the rest of the home page")
    expect(stream.classList.contains("stream-grouped")).toBe(true);
    const group = stream.querySelector(".card.stream-card")!;
    expect(group).toBeTruthy();
    expect(group.querySelectorAll(".notice-card-row").length).toBe(1); // rows live in the group
  });

  // FIXED 2026-08-26: this fixture WAS Dave's screenshot -- a FAILING notice
  // above, a WAITING notice below, the dealt task sorting in between them
  // because plain-weight DEALT sits between the two. "I don't want a task
  // wedged in between 2 arrows." The dealt task is now the stream's anchor:
  // FAILING outranks it, so the WHOLE block (FAILING AND WAITING, not just
  // the notice that outranks it) moves above, and the task trails both.
  it("the dealt task no longer wedges between a FAILING notice and a WAITING one", () => {
    const notice = (title: string, weight: number) => (
      <NoticeCard key={title} weight={weight} icon={null} title={title} action={{ label: "Do It", onClick: () => {} }} />
    );
    const { container } = render(
      <TodayPage {...base} offersQuiet upNext={[tk("over", "2026-05-18")]} upNextReason="Waiting 2 days"
        onUpNext={() => {}} notices={[notice("Money Waits", WAITING), notice("Day Is Sliding", FAILING)]} />,
    );
    const stream = container.querySelector(".heads-up-stream")!;
    const texts = stream.textContent!;
    // FAILING first, then WAITING, then the dealt task trailing both --
    // never between them.
    expect(texts.indexOf("Day Is Sliding")).toBeLessThan(texts.indexOf("Money Waits"));
    expect(texts.indexOf("Money Waits")).toBeLessThan(texts.indexOf("over"));
  });

  it("shows today's birthdays above Up Next, and nothing on ordinary days", () => {
    const { container, rerender } = render(
      <TodayPage {...base} birthdays={[{ id: "p1", name: "Mike Torres" }]} upNext={[tk("due", "2026-05-20")]} onUpNext={() => {}} />,
    );
    expect(screen.getByText("Birthday")).toBeInTheDocument();
    expect(screen.getByText("Mike Torres")).toBeInTheDocument();
    expect(screen.getByText("Turns a year older today")).toBeInTheDocument();
    // SPEC MOVED (Library phase 2, 2026-08-18): section heads are the bold
    // sh2 form; the birthday avatar keeps people-pink (never red).
    expect(container.querySelector(".av.cat-bg-pink")).toBeTruthy();
    // section order: Birthday section head precedes Your Move's
    const heads = [...container.querySelectorAll(".sh2 .t")].map((e) => e.textContent);
    expect(heads.indexOf("Birthday")).toBeLessThan(heads.indexOf("Your Move"));
    // absent = the normal state, and the plural title only with 2+
    rerender(<TodayPage {...base} birthdays={[]} />);
    expect(screen.queryByText("Birthday")).toBeNull();
    rerender(<TodayPage {...base} birthdays={[{ id: "a", name: "A" }, { id: "b", name: "B" }]} />);
    expect(screen.getByText("Birthdays")).toBeInTheDocument();
  });

  it("shows the Focus button paired with Plan My Day (daytime only)", () => {
    render(<TodayPage {...base} upNext={[tk("due", "2026-05-20")]} onUpNext={() => {}} onPlanDay={() => {}} />);
    expect(screen.getByText("Focus")).toBeInTheDocument();
    expect(screen.getByText("Plan My Day")).toBeInTheDocument();
  });

  it("evening keeps the Still Open recap instead of Up Next, no Focus", () => {
    render(
      <TodayPage
        {...base}
        evening={{ doneDue: 2, dueTotal: 3, eventsLeft: 0, openCount: 1, thingsDone: 2 }}
        upNext={[tk("due", "2026-05-20")]}
        onUpNext={() => {}}
        onPlanDay={() => {}}
      />,
    );
    expect(screen.queryByText("Up Next")).toBeNull();
    // No dealt card at night, so the stream never wears the daytime name.
    expect(screen.queryByText("Your Move")).toBeNull();
    expect(screen.queryByText("Focus")).toBeNull();
    expect(screen.getByText("Still Open")).toBeInTheDocument();
  });

  it("evening folds a long Still Open list to five rows and a receipt", () => {
    // Dave's screenshot (2026-08-26): fifteen bare rows at 10:35 PM. The
    // recap shows the top five; the rest is a count that opens Tasks.
    const many = Array.from({ length: 8 }, (_, i) => tk("t" + i, "2026-05-20"));
    const { container } = render(
      <TodayPage {...base}
        evening={{ doneDue: 2, dueTotal: 3, eventsLeft: 0, openCount: 8, thingsDone: 2 }}
        tasks={many} onUpNext={() => {}} />,
    );
    expect(container.querySelectorAll(".task-row").length).toBe(5);
    expect(screen.getByText("3 More still open")).toBeInTheDocument();
  });

  it("renders Your Day and Tomorrow sections", () => {
    render(<TodayPage {...base} />);
    expect(screen.getByText("Your Day")).toBeInTheDocument();
    expect(screen.getByText("Tomorrow")).toBeInTheDocument();
  });

  it("hides Today's Tasks and Tomorrow when there is no data", () => {
    render(<TodayPage {...base} tasks={[]} tomorrowEvents={[]} />);
    expect(screen.queryByText("Today\u2019s Tasks")).toBeNull();
    expect(screen.queryByText("Tomorrow")).toBeNull();
  });
});
