// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { useEffect, useState, type ReactNode } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NotesProvider, useCategories, useGoals, useProjects, useSchedule } from "../data/NotesProvider";
import { todayISO } from "../tasks/grouping";
import InsightsFlow from "./InsightsFlow";

// INSIGHTS, AS THE 2026-10-05 REVIEW LEFT IT (Dave: "Everything should look PERFECT"). The real flow, rendered through the real provider;
// each test names what it holds and fails without the change. The stylesheet rules are read as text, since jsdom draws none.

const CSS = ["components.css", "ruled.css"].map((f) => readFileSync(join(process.cwd(), "src/styles", f), "utf8")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = (sel: string) => [...CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1]!.split(",").some((s) => s.trim() === sel)).map((m) => m[2]!);

function Seeded({ children, week = false }: { children: ReactNode; week?: boolean }) {
  const goals = useGoals();
  const projects = useProjects();
  const cats = useCategories();
  const schedule = useSchedule();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void (async () => {
      await goals.create({ title: "Run a Half Marathon", state: "achieved", achievedOn: "2026-09-14" });
      await projects.create({ title: "Garage Cleanout", status: "done", closedOn: "2026-09-20" });
      if (week) {
        const work = (await cats.create("Work", "blue"))!;
        const health = (await cats.create("Health", "green"))!;
        await goals.create({ title: "Get Stronger", state: "on_track", tags: [health] });
        // Every day of the last week, an hour of Work on the calendar and none of Health: Health is the area with the fewest hours.
        await schedule.createEvent("Standup", { date: todayISO().slice(0, 7) + "-01", start: "09:00", end: "10:00", category: work, recurrence: "daily" });
      }
      setReady(true);
    })();
  }, [goals, projects, cats, schedule, week]);
  return ready ? <>{children}</> : null;
}

describe("Insights: the ledger (The Long Story)", () => {
  const open = async (id: string) => {
    const view = render(<NotesProvider userId={id}><Seeded><InsightsFlow onBack={() => {}} /></Seeded></NotesProvider>);
    // The row says what it holds, in words, not "2 Crossings and Counting".
    await waitFor(() => expect(screen.getByText("1 Goal Achieved, 1 Project Closed")).toBeInTheDocument());
    fireEvent.click(screen.getByText("The Long Story"));
    await screen.findByText("Garage Cleanout");
    return view;
  };

  it("the ledger row names what it holds", async () => {
    render(<NotesProvider userId="u-ins-ledger"><Seeded><InsightsFlow onBack={() => {}} /></Seeded></NotesProvider>);
    await waitFor(() => expect(screen.getByText("The Long Story")).toBeInTheDocument());
    const row = screen.getByText("The Long Story").closest(".row")!;
    await waitFor(() => expect(row.querySelector(".facts")!.textContent).toBe("1 Goal Achieved, 1 Project Closed"));
    expect(row.textContent).not.toMatch(/Crossing/);
  });

  it("each month is the standard section head inside the page's gutter, never a bare caps label outside it", async () => {
    const { container } = await open("u-ins-story-head");
    const head = [...container.querySelectorAll(".sh2")].find((h) => h.textContent === "September 2026")!;
    expect(head, "the month is a section head").toBeTruthy();
    expect(head.classList.contains("sh2-quiet")).toBe(true);
    expect(container.querySelector(".day-divide")).toBeNull();
    expect(head.nextElementSibling!.classList.contains("pad-x")).toBe(true); // its card is inside the gutter, directly under it
  });

  it("dates read month first like every date in the app (Sep 20, never 20 SEP), as small caps facts", async () => {
    const { container } = await open("u-ins-story-dates");
    const rows = [...container.querySelectorAll(".card .row")];
    const facts = rows.map((r) => [...r.querySelectorAll(".facts > .fact")].map((f) => f.textContent));
    expect(facts).toEqual([["Closed", "Sep 20"], ["Achieved", "Sep 14"]]);
    expect(rows[0]!.querySelector(".facts > .fact:last-child")!.className).toBe("fact date");
    expect(container.textContent).not.toMatch(/\b\d{1,2} (Sep|SEP)\b/);
  });

  it("the page closes on one warm line, and the check is the one glyph in both themes", async () => {
    const { container } = await open("u-ins-story-close");
    expect(container.querySelector(".input-hint")!.textContent).toBe("Everything You Achieve Lands Here, Dated, Forever");
    for (const g of container.querySelectorAll(".rep-good-glyph")) expect(g.querySelector(".ic-out")).not.toBeNull();
    // The filled twin is hidden everywhere but an active control, and no light-only rule brings it back.
    expect(rules(".ic-fill").join(" ")).toMatch(/display:\s*none/);
    expect(CSS).not.toMatch(/\[data-theme="light"\][^{}]*\.ic-fill[^{}]*\{[^}]*display:\s*(inline|block)/);
  });
});

describe("Insights: the week card", () => {
  const mount = (id: string) => render(<NotesProvider userId={id}><Seeded week><InsightsFlow onBack={() => {}} /></Seeded></NotesProvider>);

  it("the offer says which blocks go where and why, with one primary and a quiet No Thanks", async () => {
    const { container } = mount("u-ins-week-offer");
    const why = await waitFor(() => { const e = container.querySelector(".week-why"); expect(e).not.toBeNull(); return e!; });
    expect(why.textContent).toBe("Two Focus Blocks Go to Health Next Week, Where This Week Had the Fewest Hours");
    const acts = container.querySelector(".week-acts")!;
    expect(acts.querySelector(".btn-primary")!.textContent).toBe("Move Two Blocks");
    // One primary: the dismissal is a quiet text button, not a second slab.
    expect(acts.querySelectorAll(".btn-primary")).toHaveLength(1);
    expect(acts.querySelector(".btn-tertiary")!.textContent).toBe("No Thanks");
    expect(acts.querySelector(".btn-secondary")).toBeNull();
  });

  it("the Next line reads as a sentence (Got 0 of 7h), the area a dot and the amount its own fact", async () => {
    const { container } = mount("u-ins-week-next");
    const next = await waitFor(() => { const k = [...container.querySelectorAll(".eq")].find((e) => e.querySelector(".eq-k")?.textContent === "Next"); expect(k).toBeTruthy(); return k!; });
    const facts = [...next.querySelectorAll(".facts > .fact")];
    expect(facts[0]!.className).toBe("fact cat");
    expect(facts[0]!.textContent).toBe("Health");
    expect(facts[1]!.textContent).toMatch(/^Got 0 of \d+h$/);
    expect(next.textContent).not.toMatch(/None of/);
  });

  it("the Flexible tile is the key's sky and holds one line: the larger unit leads, the smaller rides beside it", async () => {
    const { container } = mount("u-ins-week-tiles");
    const tile = await waitFor(() => { const t = container.querySelector(".itile-sky"); expect(t).not.toBeNull(); return t!; });
    expect(tile.querySelector("span")!.textContent).toBe("flexible");
    expect(container.querySelectorAll(".itile")).toHaveLength(3);
    // A number with no state is white (itile-plain); the duration is sky, not white.
    expect(rules(".itile-sky").join(" ")).toMatch(/color:\s*var\(--est-ink\)/);
    expect(rules(".itile-plain").join(" ")).toMatch(/color:\s*var\(--tx-1\)/);
    // "37h 45m" never breaks into two lines inside the tile: the smaller unit is an inline <small>.
    expect(rules(".itile b").join(" ")).toMatch(/white-space:\s*nowrap/);
  });

  it("the values of every line share one left edge: a line with no dot reserves the dot's width", () => {
    expect(rules(".week-card:has(.eq .fact.cat) .eq .facts > .fact:first-child:not(.cat)").join(" ")).toMatch(/padding-left/);
  });
});
