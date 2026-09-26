// The decision list anatomy (Dave 2026-08-18 styling pass, and the lead's
// 2026-09-26 ruling): each home that sits in an area renders as its own
// category fact in the facts line, a person, goal or task home stays on the
// record page, the date closes the line in small caps, and long decision
// sentences wrap instead of truncating.
// @vitest-environment jsdom
import { describe, it, expect, afterAll } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useEffect, useState, type ReactNode } from "react";
import { NotesProvider, useDecisions, useProjects } from "../data/NotesProvider";
import { setCategoryRegistry } from "../shared/categories";
import DecisionsFlow from "./DecisionsFlow";
import { todayISO } from "../schedule/calendar";
import { shortDate } from "../shared/dateFormat";

setCategoryRegistry([{ id: "cat-home", name: "Home", color: "orange" }]);
afterAll(() => setCategoryRegistry([]));

// Seeds BEFORE the flow mounts, so its one read of the projects sees the
// project's category (the flow resolves each home's dot from it).
function Seeded({ children }: { children: ReactNode }) {
  const svc = useDecisions();
  const projects = useProjects();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void (async () => {
      await projects.create({ title: "Rebuild Bridge App", category: "cat-home", status: "active" }, "p1");
      await svc.create({
        decision: "Student template ships before the other two are even started",
        why: "Northlake gives 60 warm leads on day one",
        linkedType: "project",
        linkedId: "p1",
        linkedLabel: "Rebuild Bridge App",
        links: [
          { type: "project", id: "p1", label: "Rebuild Bridge App" },
          { type: "person", id: "per-sam", label: "Sam" },
        ],
        source: { kind: "email", entityId: "t1", at: new Date().toISOString() },
        outcome: { word: "didnt", at: new Date().toISOString() },
      });
      await svc.create({ decision: "Keep Fridays for writing", source: { kind: "manual", at: new Date().toISOString() }, outcome: { word: "worked", at: new Date().toISOString() } });
      setReady(true);
    })();
  }, [svc, projects]);
  return ready ? <>{children}</> : null;
}

describe("Decision list anatomy", () => {
  it("renders each home in an area as its own fact, and the date as small caps", async () => {
    const { container } = render(
      <NotesProvider userId="u-dec-list"><Seeded><DecisionsFlow onBack={() => {}} /></Seeded></NotesProvider>,
    );
    await waitFor(() => expect(screen.getByText("Rebuild Bridge App")).toBeInTheDocument());
    // A project home is the category fact: the name sits in .cat-t inside
    // the .fact-link, and the PROJECT'S OWN area rides its dot, never the
    // words (§AM).
    const link = screen.getByText("Rebuild Bridge App").closest(".fact-link")!;
    expect(link).toBeInTheDocument();
    expect(link.className).toContain("fact cat");
    await waitFor(() => expect(link.querySelector(".cd")!.className).toMatch(/\bcat-bg-orange\b/));
    expect(link.className).not.toMatch(/cat-fg-/);
    // A person is not an area of life, so it has no dot to wear and is not
    // on the row at all (lead, 2026-09-26): a bare name would be a second
    // plain grey beside the reason (§AK). The record page's Attached To card
    // names it.
    const row = link.closest(".dec-row")!;
    expect(row.textContent).not.toContain("Sam");
    expect(screen.queryByText("Sam")).toBeNull();
    // Every home left on the row wears a dot.
    for (const f of Array.from(row.querySelectorAll(".fact-link"))) {
      expect(f.className).toContain("fact cat");
      expect(f.querySelector(".cd")).not.toBeNull();
    }
    // The date is the shared small-caps primitive, not a class of its own.
    const date = row.querySelector(".facts > .fact:last-child")!;
    expect(date.className).toBe("fact date");
    expect(container.querySelector(".dec-when")).toBeNull();
    // Long decision sentences wrap (two-line clamp) rather than truncating.
    const name = Array.from(container.querySelectorAll(".dec-name")).find((n) => n.textContent!.includes("Student template ships"));
    expect(name).toBeInTheDocument();
  });

  it("keys the outcome, drops the source, and shows no reason line when there is none", async () => {
    const { container } = render(
      <NotesProvider userId="u-dec-list-key"><Seeded><DecisionsFlow onBack={() => {}} /></Seeded></NotesProvider>,
    );
    await waitFor(() => expect(screen.getByText("Keep Fridays for writing")).toBeInTheDocument());
    // The outcome takes the Colour Key: didn't is missed, worked is done.
    expect(screen.getByText("Didn't").className).toBe("fact red");
    expect(screen.getByText("Worked").className).toBe("fact good");
    // Where it came from lives on the record page, not on the row.
    expect(screen.queryByText("Email")).toBeNull();
    expect(screen.queryByText("Manual")).toBeNull();
    // A row with no reason says nothing about it (§AK): no placeholder line.
    expect(screen.queryByText("No reason recorded")).toBeNull();
    const rows = Array.from(container.querySelectorAll(".dec-row"));
    const bare = rows.find((r) => r.textContent!.includes("Keep Fridays"))!;
    expect(bare.querySelector(".conn-meta")).toBeNull();
    const reasoned = rows.find((r) => r.textContent!.includes("Student template"))!;
    expect(reasoned.querySelector(".conn-meta")!.textContent).toBe("Because Northlake gives 60 warm leads on day one");
  });
});

// A day N days from today, local, as YYYY-MM-DD.
const dayFromToday = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return todayISO(d); };

// A revisit that is still waiting on him is a DUE date (§AM R8, the lead's
// 2026-09-26 window): today or tomorrow is amber, later is the neutral
// small-caps date. The day the call was recorded is always neutral.
function SeededRevisits({ children }: { children: ReactNode }) {
  const svc = useDecisions();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void (async () => {
      await svc.create({ decision: "Revisit the gym plan", revisitOn: dayFromToday(0), source: { kind: "manual", at: new Date().toISOString() } });
      await svc.create({ decision: "Revisit the reading list", revisitOn: dayFromToday(1), source: { kind: "manual", at: new Date().toISOString() } });
      await svc.create({ decision: "Revisit the move", revisitOn: dayFromToday(5), source: { kind: "manual", at: new Date().toISOString() } });
      await svc.create({ decision: "No revisit on this one", source: { kind: "manual", at: new Date().toISOString() } });
      setReady(true);
    })();
  }, [svc]);
  return ready ? <>{children}</> : null;
}

describe("the decision row's date", () => {
  it("wears the reminder window when a revisit is due, and small caps otherwise", async () => {
    const { container } = render(
      <NotesProvider userId="u-dec-revisit"><SeededRevisits><DecisionsFlow onBack={() => {}} /></SeededRevisits></NotesProvider>,
    );
    await waitFor(() => expect(screen.getByText("No revisit on this one")).toBeInTheDocument());
    const dateOf = (name: string) => Array.from(container.querySelectorAll(".dec-row"))
      .find((r) => r.textContent!.includes(name))!.querySelector(".facts > .fact:last-child")!;
    expect(dateOf("Revisit the gym plan").className).toBe("fact warn");
    expect(dateOf("Revisit the gym plan").textContent).toBe("Revisit " + shortDate(dayFromToday(0)));
    expect(dateOf("Revisit the reading list").className).toBe("fact warn");
    expect(dateOf("Revisit the move").className).toBe("fact date");
    expect(dateOf("Revisit the move").textContent).toBe("Revisit " + shortDate(dayFromToday(5)));
    // The recorded-on day is always the neutral date.
    expect(dateOf("No revisit on this one").className).toBe("fact date");
    expect(dateOf("No revisit on this one").textContent).toBe(shortDate(todayISO()));
  });
});

// THE ATTACHED TO CARD (lead, 2026-09-26, the row's ruling carried over): a
// home in an area draws as the row draws it, the category fact with its own
// area's dot and the name in .cat-t. A person, goal or task has no dot to
// wear, so every such home shares ONE plain fact, joined, and the line keeps
// one grey. No invented grey dot for them.
function SeededHomes({ children }: { children: ReactNode }) {
  const svc = useDecisions();
  const projects = useProjects();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void (async () => {
      await projects.create({ title: "Rebuild Bridge App", category: "cat-home", status: "active" }, "p1");
      await svc.create({
        decision: "Ship the student template first",
        links: [
          { type: "project", id: "p1", label: "Rebuild Bridge App" },
          { type: "person", id: "per-sam", label: "Sam" },
          { type: "goal", id: "g-fit", label: "Get Fit" },
        ],
        source: { kind: "manual", at: new Date().toISOString() },
      });
      setReady(true);
    })();
  }, [svc, projects]);
  return ready ? <>{children}</> : null;
}

describe("the record's Attached To card", () => {
  it("dots each area home and joins every other home into one plain fact", async () => {
    const { container } = render(
      <NotesProvider userId="u-dec-homes"><SeededHomes><DecisionsFlow onBack={() => {}} /></SeededHomes></NotesProvider>,
    );
    await waitFor(() => expect(screen.getByText("Ship the student template first")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Ship the student template first").closest(".dec-row")!);
    await waitFor(() => expect(screen.getByText("Attached To")).toBeInTheDocument());
    const card = screen.getByText("Attached To").closest(".sh2")!.nextElementSibling!;
    const facts = Array.from(card.querySelectorAll(".facts > .fact"));
    expect(facts.map((f) => f.textContent)).toEqual(["Rebuild Bridge App", "Sam, Get Fit"]);
    // The area home: the category fact, its own area on the dot, the name in .cat-t.
    const area = facts[0]!;
    expect(area.className).toBe("fact cat fact-link");
    await waitFor(() => expect(area.querySelector(".cd")!.className).toMatch(/\bcat-bg-orange\b/));
    expect(area.querySelector(".cat-t")!.textContent).toBe("Rebuild Bridge App");
    // Every other home: ONE plain fact, no dot, no invented grey mark.
    const plain = facts[1]!;
    expect(plain.className).toBe("fact");
    expect(plain.querySelector(".cd")).toBeNull();
    expect(container.querySelector(".cat-bg-graphite")).toBeNull();
  });
});

// ONE LINE, LIKE EVERY OTHER EMPTY STATE (Dave 2026-09-03, pic 1: "too much
// subtext"). This state ran two full sentences over three lines while its
// siblings run one short line each. The count is the point: a sub that has
// to be read twice is not an empty state, it is a paragraph on an empty
// screen.
describe("the empty state", () => {
  it("offers the payoff in one short line, not two sentences", async () => {
    render(<NotesProvider userId="u-dec-empty"><DecisionsFlow onBack={() => {}} /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Worth Remembering")).toBeInTheDocument());
    const sub = screen.getByText(/reason is still here/);
    expect(sub.textContent).toBe("The reason is still here in six weeks");
    expect(sub.textContent!.trim().split(/\s+/).length, "one line's worth").toBeLessThanOrEqual(9);
    expect(sub.textContent, "one sentence, so no full stop mid-line").not.toMatch(/\.\s/);
    expect(screen.getByText("Record a Decision")).toBeInTheDocument();
  });
});
