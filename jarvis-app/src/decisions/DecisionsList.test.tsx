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
    // ONE facts line per row (the round 2 review: the row stacked title, reason, a home and a day into six lines). The short toned
    // facts lead (the day), the long free-text home comes last, so only it can ever give way to an ellipsis; the date is the shared
    // small-caps primitive, not a class of its own.
    const factLines = Array.from(row.querySelectorAll(".facts"));
    expect(factLines).toHaveLength(1);
    const kids = Array.from(factLines[0]!.children);
    expect(kids[0]!.className).toMatch(/^fact (date|warn|red)$/);
    expect(kids[kids.length - 1]!.className).toContain("fact-link");
    expect(container.querySelector(".dec-when")).toBeNull();
    // Long decision sentences wrap (two-line clamp) rather than truncating.
    const name = Array.from(container.querySelectorAll(".dec-name")).find((n) => n.textContent!.includes("Student Template Ships"));
    expect(name).toBeInTheDocument();
  });

  it("keys the outcome, drops the source, and shows no reason line when there is none", async () => {
    const { container } = render(
      <NotesProvider userId="u-dec-list-key"><Seeded><DecisionsFlow onBack={() => {}} /></Seeded></NotesProvider>,
    );
    await waitFor(() => expect(screen.getByText("Keep Fridays for Writing")).toBeInTheDocument());
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
    const reasoned = rows.find((r) => r.textContent!.includes("Student Template"))!;
    expect(reasoned.querySelector(".conn-meta")!.textContent).toBe("Because Northlake gives 60 warm leads on day one");
    // ADDED 2026-09-26 (audit leftovers): the reason is the row's point and
    // it wraps rather than clipping to one line. It lost a third to a half
    // of itself on every seeded row at 390 while it wore .truncate.
    expect(reasoned.querySelector(".conn-meta")!.className).toBe("conn-meta");
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
    await waitFor(() => expect(screen.getByText("No Revisit on This One")).toBeInTheDocument());
    const dateOf = (name: string) => Array.from(container.querySelectorAll(".dec-row"))
      .find((r) => r.textContent!.includes(name))!.querySelector(".facts > .fact:last-child")!;
    expect(dateOf("Revisit the Gym Plan").className).toBe("fact warn");
    expect(dateOf("Revisit the Gym Plan").textContent).toBe("Revisit " + shortDate(dayFromToday(0)));
    expect(dateOf("Revisit the Reading List").className).toBe("fact warn");
    expect(dateOf("Revisit the Move").className).toBe("fact date");
    expect(dateOf("Revisit the Move").textContent).toBe("Revisit " + shortDate(dayFromToday(5)));
    // The recorded-on day is always the neutral date.
    expect(dateOf("No Revisit on This One").className).toBe("fact date");
    expect(dateOf("No Revisit on This One").textContent).toBe(shortDate(todayISO()));
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
    await waitFor(() => expect(screen.getByText("Ship the Student Template First")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Ship the Student Template First").closest(".dec-row")!);
    await waitFor(() => expect(screen.getByText("Attached To")).toBeInTheDocument());
    const card = screen.getByText("Attached To").closest(".sh2")!.nextElementSibling!;
    // EVERY HOME IS A ROW OF ITS OWN (Dave 2026-10-05, the review: "Rebuild Calder..." clipped beside 200px of empty card):
    // its name as the title, what it IS as the one grey, the area's dot on a home that sits in an area.
    const rows = Array.from(card.querySelectorAll(".row"));
    expect(rows.map((r) => r.querySelector(".conn-name")!.textContent)).toEqual(["Rebuild Bridge App", "Sam", "Get Fit"]);
    const facts = rows.map((r) => r.querySelector(".facts > .fact")!);
    expect(facts.map((f) => f.textContent)).toEqual(["Project", "Person", "Goal"]);
    // The area home: the category fact, its own area on the dot.
    const area = facts[0]!;
    expect(area.className).toBe("fact cat");
    await waitFor(() => expect(area.querySelector(".cd")!.className).toMatch(/\bcat-bg-orange\b/));
    // Every other home: a plain fact, no dot, no invented grey mark, and no row is clipped by a fixed width.
    for (const f of [facts[1]!, facts[2]!]) {
      expect(f.className).toBe("fact");
      expect(f.querySelector(".cd")).toBeNull();
    }
    expect(card.querySelector(".chip, .fact-link, .truncate")).toBeNull();
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
    const sub = screen.getByText(/Reason Is Still Here/);
    expect(sub.textContent).toBe("The Reason Is Still Here in Six Weeks");
    expect(sub.textContent!.trim().split(/\s+/).length, "one line's worth").toBeLessThanOrEqual(9);
    expect(sub.textContent, "one sentence, so no full stop mid-line").not.toMatch(/\.\s/);
    expect(screen.getByText("Record a Decision")).toBeInTheDocument();
  });
});

// CLEAN ROWS AND CARDS (Dave 2026-10-05, locked). A decision row is a door with a swipe-left Delete behind it; the record page
// holds no capsule in a card: the outcome is a segmented choice, and Change It, Make It a Rule and Delete live in its More menu.
describe("Decisions: clean rows, one menu", () => {
  const noCaps = (root: Element) => root.querySelector(".card .pill-act, .card .row-act, .card .btn-sm, .card .quiet-action");

  it("every list row is a swipe row with Delete behind it, and no capsule sits in the list card", async () => {
    const { container } = render(
      <NotesProvider userId="u-dec-clean-list"><Seeded><DecisionsFlow onBack={() => {}} /></Seeded></NotesProvider>,
    );
    await waitFor(() => expect(screen.getByText("Keep Fridays for Writing")).toBeInTheDocument());
    const rows = Array.from(container.querySelectorAll(".dec-row"));
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.closest(".task-swipe")?.querySelector(".task-del"), r.textContent ?? "").not.toBeNull();
    }
    expect(noCaps(container)).toBeNull();
  });

  it("the record page: the outcome is a segmented choice, no card holds a capsule, and the actions are in More", async () => {
    const { container } = render(
      <NotesProvider userId="u-dec-clean-record"><Seeded><DecisionsFlow onBack={() => {}} /></Seeded></NotesProvider>,
    );
    await waitFor(() => expect(screen.getByText("Keep Fridays for Writing")).toBeInTheDocument());
    fireEvent.click(Array.from(container.querySelectorAll(".dec-name")).find((n) => n.textContent!.includes("Keep Fridays"))!);
    const seg = await waitFor(() => { const e = container.querySelector(".segmented[aria-label='Outcome']"); expect(e).not.toBeNull(); return e!; });
    expect(Array.from(seg.querySelectorAll("button.seg")).map((b) => b.textContent)).toEqual(["Worked", "Mixed", "Didn't"]);
    expect(seg.querySelector("[aria-pressed=true]")?.textContent).toBe("Worked");
    expect(noCaps(container)).toBeNull();
    // The record's own actions are in its menu, not in rows at the foot of a card.
    expect(screen.queryByText("Change It")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(await screen.findByRole("button", { name: "Change It" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Decision" })).toHaveClass("destructive");
  });

  it("a call that did not work surfaces Change It on its outcome row, as text; one that worked shows nothing", async () => {
    const { container } = render(
      <NotesProvider userId="u-dec-ctx"><Seeded><DecisionsFlow onBack={() => {}} /></Seeded></NotesProvider>,
    );
    await waitFor(() => expect(screen.getByText("Keep Fridays for Writing")).toBeInTheDocument());
    fireEvent.click(Array.from(container.querySelectorAll(".dec-name")).find((n) => n.textContent!.includes("Student Template"))!);
    // The marked line under the control: the day it was marked, and the call's one action as text, never a capsule.
    const ctx = await waitFor(() => { const c = container.querySelector(".dec-marked .row-ctx"); expect(c).not.toBeNull(); return c!; });
    expect(ctx.textContent).toBe("Change It");
    expect(ctx.className).toBe("row-ctx");
    expect(container.querySelector(".dec-marked .fact.date")!.textContent).toMatch(/^Marked /);
  });
});

// THE CATALOG, HELD ON THE RECORD PAGE (Dave 2026-10-05, the hard gate). Rendered through the real flow and read from the DOM.
// Drift this pins: the headline wore whatever case it was typed in; the Revisit row put a chip at its edge with "No Date" in it;
// Ruled Out drew chips in a card; the outcome card opened with a "Mark Outcome" row that said the head again; "Still good" was
// sentence case.
function OneRecord({ children, extra }: { children: ReactNode; extra: Parameters<ReturnType<typeof useDecisions>["create"]>[0] }) {
  const svc = useDecisions();
  const [ready, setReady] = useState(false);
  useEffect(() => { void (async () => { await svc.create(extra); setReady(true); })(); }, [svc, extra]);
  return ready ? <>{children}</> : null;
}
const openRecord = async (container: HTMLElement, text: string) => {
  await waitFor(() => expect(container.querySelector(".dec-name")).not.toBeNull());
  fireEvent.click(Array.from(container.querySelectorAll(".dec-name")).find((n) => n.textContent!.includes(text))!);
  await waitFor(() => expect(container.querySelector(".dec-main")).not.toBeNull());
};

describe("Decisions record page follows the catalog", () => {
  const base = { decision: "build a six-month runway before the hire", why: "cash is the constraint", ruledOut: ["wait a month", "hire two"] };

  it("shows the headline in Title Case at rest and as typed while it is edited", async () => {
    const { container } = render(<NotesProvider userId="u-dec-cat-head"><OneRecord extra={base}><DecisionsFlow onBack={() => {}} /></OneRecord></NotesProvider>);
    await openRecord(container, "Build a Six-Month Runway");
    const head = container.querySelector(".dec-main") as HTMLElement;
    expect(head.textContent).toBe("Build a Six-Month Runway Before the Hire");
    fireEvent.focus(head);
    expect(head.textContent, "edited as typed").toBe("build a six-month runway before the hire");
    head.textContent = "build a six-month runway before the hire, please";
    fireEvent.blur(head);
    await waitFor(() => expect(container.querySelector(".dec-main")!.textContent).toBe("Build a Six-Month Runway Before the Hire, Please"));
  });

  it("Ruled Out is rows in Title Case, never chips, with Remove only while editing", async () => {
    const { container } = render(<NotesProvider userId="u-dec-cat-ruled"><OneRecord extra={base}><DecisionsFlow onBack={() => {}} /></OneRecord></NotesProvider>);
    await openRecord(container, "Build a Six-Month Runway");
    const head = screen.getByText("Ruled Out").closest(".sh2")!;
    const card = head.nextElementSibling!;
    expect(card.querySelector(".chip")).toBeNull();
    expect(Array.from(card.querySelectorAll(".row .conn-name")).map((n) => n.textContent)).toEqual(["Wait a Month", "Hire Two"]);
    expect(card.querySelector(".row-ctx"), "no verb while reading").toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(card.querySelectorAll(".row-ctx")).toHaveLength(2);
    expect(card.querySelector(".chip")).toBeNull();
  });

  it("the Revisit row has no chip and no placeholder: a date is a keyed fact, no date is nothing", async () => {
    const dated = render(<NotesProvider userId="u-dec-cat-rev1"><OneRecord extra={{ ...base, revisitOn: "2099-03-04" }}><DecisionsFlow onBack={() => {}} /></OneRecord></NotesProvider>);
    await openRecord(dated.container, "Build a Six-Month Runway");
    const row = screen.getByText("Shows on Today").closest(".row")!;
    expect(row.querySelector(".chip")).toBeNull();
    const fact = row.querySelector(".facts .fact")!;
    expect(fact.textContent).toBe("Mar 4");
    expect(fact.className, "a later revisit is a neutral small-caps date").toContain("date");
    expect(row.textContent).not.toContain("·");
    dated.unmount();

    const none = render(<NotesProvider userId="u-dec-cat-rev2"><OneRecord extra={base}><DecisionsFlow onBack={() => {}} /></OneRecord></NotesProvider>);
    await openRecord(none.container, "Build a Six-Month Runway");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const bare = screen.getByText("Shows on Today").closest(".row")!;
    expect(bare.querySelector(".chip")).toBeNull();
    expect(bare.querySelector(".facts"), "nothing to say, nothing drawn").toBeNull();
    expect(screen.queryByText("No Date")).toBeNull();
  });

  it("an overdue revisit takes the key (a due date is never grey)", async () => {
    const { container } = render(<NotesProvider userId="u-dec-cat-late"><OneRecord extra={{ ...base, revisitOn: "2020-01-02" }}><DecisionsFlow onBack={() => {}} /></OneRecord></NotesProvider>);
    await openRecord(container, "Build a Six-Month Runway");
    const fact = screen.getByText("Shows on Today").closest(".row")!.querySelector(".facts .fact")!;
    expect(fact.className).toContain("red");
  });

  it("the outcome card opens on the three words, not on a row that says the head again", async () => {
    const { container } = render(<NotesProvider userId="u-dec-cat-out"><OneRecord extra={base}><DecisionsFlow onBack={() => {}} /></OneRecord></NotesProvider>);
    await openRecord(container, "Build a Six-Month Runway");
    expect(screen.queryByText("Mark Outcome")).toBeNull();
    // The control stands on its own: no card round it, no track-inside-a-card, no title row that repeats the word it shows (Dave
    // 2026-10-05, the review: three nested containers).
    const block = screen.getByText("Outcome", { selector: ".sh2 .t" }).closest(".sh2")!.nextElementSibling!;
    expect(block.querySelector(".segmented")).not.toBeNull();
    expect(block.classList.contains("card")).toBe(false);
    expect(block.querySelector(".card, .row, .conn-name")).toBeNull();
    expect(block.querySelector(".dec-marked")).toBeNull(); // nothing marked yet, so nothing to caption
  });

  // THE ROUND 2 REVIEW (2026-10-05): the biggest type on the page said the generic word "Decision" while the real call sat in a
  // smaller card under a DECIDED label, and the outcome strip had nothing to say what it was for.
  it("the call is the large title, with its day as the caption, and the bar keeps the small word", async () => {
    const { container } = render(<NotesProvider userId="u-dec-r2-hero"><OneRecord extra={base}><DecisionsFlow onBack={() => {}} /></OneRecord></NotesProvider>);
    await openRecord(container, "Build a Six-Month Runway");
    const hero = container.querySelector(".pagehead .pagehead-title.dec-hero")!;
    expect(hero.textContent).toBe("Build a Six-Month Runway Before the Hire");
    // Not the generic word in the big slot, and no second Decided card repeating the call.
    expect(container.querySelector(".pagehead-title:not(.dec-hero)")).toBeNull();
    expect(screen.queryByText("Decided", { selector: ".sh2 .t" })).toBeNull();
    expect(container.querySelector(".pagebar-title")!.textContent).toBe("Decision");
    expect(container.querySelector(".pagehead .dec-recorded .fact.date")!.textContent).toMatch(/^Recorded /);
  });

  it("an outcome nobody has picked asks its question, and the question goes once one is", async () => {
    const { container } = render(<NotesProvider userId="u-dec-r2-ask"><OneRecord extra={base}><DecisionsFlow onBack={() => {}} /></OneRecord></NotesProvider>);
    await openRecord(container, "Build a Six-Month Runway");
    expect(screen.getByText("How Did It Turn Out?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Worked" }));
    await waitFor(() => expect(screen.queryByText("How Did It Turn Out?")).toBeNull());
  });

  it("the notes field invites in two plain words, not a sentence", async () => {
    const { container } = render(<NotesProvider userId="u-dec-r2-notes"><OneRecord extra={base}><DecisionsFlow onBack={() => {}} /></OneRecord></NotesProvider>);
    await openRecord(container, "Build a Six-Month Runway");
    expect(container.querySelector(".dec-notes")!.innerHTML).toContain("Add Notes");
    expect(container.innerHTML).not.toContain("Longer Thinking");
  });

  it("an empty reason invites in Title Case and states nothing", async () => {
    const { container } = render(<NotesProvider userId="u-dec-cat-why"><OneRecord extra={{ decision: "keep fridays for writing" }}><DecisionsFlow onBack={() => {}} /></OneRecord></NotesProvider>);
    await openRecord(container, "Keep Fridays for Writing");
    const why = container.querySelector(".dec-why") as HTMLElement;
    expect(why.getAttribute("data-placeholder")).toBe("Why You Chose It");
  });

  it("a held list row offers Open as well as Delete (the long press is the menu)", async () => {
    const { container } = render(<NotesProvider userId="u-dec-cat-menu"><OneRecord extra={base}><DecisionsFlow onBack={() => {}} /></OneRecord></NotesProvider>);
    await waitFor(() => expect(container.querySelector(".dec-row")).not.toBeNull());
    fireEvent.contextMenu(container.querySelector(".swipe-row")!);
    expect(await screen.findByRole("button", { name: "Open" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass("destructive");
  });
});
