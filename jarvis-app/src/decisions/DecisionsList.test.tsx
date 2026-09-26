// The decision list anatomy (Dave 2026-08-18 styling pass): each linked
// home renders as its own fact in the sub line, the recorded date rides the
// name line, and long decision sentences wrap instead of truncating.
// @vitest-environment jsdom
import { describe, it, expect, afterAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useEffect, useState, type ReactNode } from "react";
import { NotesProvider, useDecisions, useProjects } from "../data/NotesProvider";
import { setCategoryRegistry } from "../shared/categories";
import DecisionsFlow from "./DecisionsFlow";

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
  it("renders each home as its own fact with a date in the name line", async () => {
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
    // A person is not an area of life: the name, no dot, not the category
    // fact, and not the project's colour borrowed from the first link.
    const person = screen.getByText("Sam").closest(".fact-link")!;
    expect(person).toBeInTheDocument();
    expect(person.className).not.toMatch(/\bcat\b/);
    expect(person.querySelector(".cd")).toBeNull();
    expect(container.querySelector(".dec-when")).toBeInTheDocument();
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
