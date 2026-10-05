// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import PeopleListPage from "./PeopleListPage";
import PersonDetail from "./PersonDetail";
import CallPrepSheet from "../CallPrepSheet";
import { reminderAtLabel } from "../mentions";
import { setCategoryRegistry } from "../../shared/categories";
import type { Person } from "../types";

// THE CATALOG HARD GATE (Dave 2026-10-05): the People screens added in the last
// two weeks (Brain Manual v1 triage roles, the import and repair offers) hold
// the same rules as every other row. A separator is drawn by CSS and never a
// character in a string (R6); one grey run under a title (R1); Title Case on
// every line the app writes, after dots and numbers too (H2); a clock keeps
// its one shape, "2:00 PM" (R8).
afterEach(cleanup);
setCategoryRegistry([]);

const p = (id: string, name: string, data: Partial<Person["data"]> = {}): Person =>
  ({ id, data: { name, group: "contacts", ...data } as Person["data"] });

const SMALL = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
/** Every word capitalised except the small words in the middle of the line. */
const titleCased = (t: string) => {
  const words = t.split(/\s+/).filter(Boolean);
  return words.every((w, i) => !/^[a-z]/.test(w) || (i > 0 && i < words.length - 1 && SMALL.has(w)));
};

const list = (extra: Partial<Parameters<typeof PeopleListPage>[0]> = {}) => render(
  <PeopleListPage
    people={[
      p("a", "Aaron Roman", { roles: ["family", "friend", "work"] }),
      p("b", "Bea Cole", { relationship: "Sister" }),
      p("c", "Cy Dean"),
    ]}
    onOpen={() => {}} onAdd={() => {}} onBack={() => {}} onImportFile={() => {}}
    {...extra}
  />,
);

describe("People list rows: roles are one grey run", () => {
  it("a row's triage roles are one comma list in one run, never a middle dot in the string", () => {
    const { container } = list();
    const row = [...container.querySelectorAll(".person-row-ruled")].find((r) => r.textContent?.includes("Aaron Roman"))!;
    const runs = row.querySelectorAll(".r-k > .r-goal");
    expect(runs).toHaveLength(1);
    expect(runs[0]!.textContent).toBe("Family, Friend, Work");
    expect(row.textContent).not.toContain("·");
  });

  it("no .r-k line on the list carries a typed middle dot", () => {
    const { container } = list();
    for (const k of container.querySelectorAll(".r-k, .facts, .conn-meta")) {
      expect(k.textContent, k.textContent ?? "").not.toContain("·");
    }
  });

  it("a row with nothing to say under it says nothing", () => {
    const { container } = list();
    const row = [...container.querySelectorAll(".person-row-ruled")].find((r) => r.textContent?.includes("Cy Dean"))!;
    expect(row.querySelector(".r-k")?.textContent ?? "").toBe("");
  });
});

describe("People list: every sub line is Title Case", () => {
  it("the old-import offer's sub line", () => {
    const { container } = list({ duplicateNotes: 2, onClearDuplicateNotes: () => {} });
    for (const sub of container.querySelectorAll(".bp-sub")) expect(titleCased(sub.textContent!), sub.textContent!).toBe(true);
    expect(container.querySelector(".bp-sub")!.textContent).toBe("Left There by an Old Import");
  });
});

// IMPORT IS NOT A PERSON (Dave 2026-10-05, the review: "Import from File" was the last row of the people card, drawn with a glyph
// and a chevron like a contact, with a sub line that read like a developer note). It is a section action, so it lives in the
// head behind the one round overflow button (decision D1) and the people card holds people only.
describe("People list: Import from File is in the head's overflow, never a row among the people", () => {
  it("the card holds only people, and the head holds Add Person and one More button that opens Import", () => {
    const { container } = list();
    expect([...container.querySelectorAll(".person-row-ruled")].map((r) => r.querySelector(".task-name")!.textContent))
      .toEqual(["Aaron Roman", "Bea Cole", "Cy Dean"]);
    expect(container.querySelector(".list-card-ruled")!.textContent).not.toMatch(/Import|\.vcf/);
    const head = [...container.querySelectorAll(".sh2")].find((h) => h.textContent?.includes("Your People"))!;
    const caps = head.querySelectorAll("button.pill-action");
    expect(caps).toHaveLength(2); // at most two, never a head that wraps (D1)
    expect(caps[0]!.textContent).toBe("Add Person");
    const more = head.querySelector("button.head-more") as HTMLElement;
    expect(more.getAttribute("aria-label")).toBe("More");
    fireEvent.click(more);
    expect(screen.getByRole("button", { name: "Import from File" })).toBeInTheDocument();
  });

  it("without an import handler there is no overflow at all", () => {
    const { container } = list({ onImportFile: undefined });
    expect(container.querySelector(".head-more")).toBeNull();
  });
});

// A CONTACT'S AVATAR IS A SOFT TINT (Dave 2026-10-05, the review: five identical solid brand-red discs). Brand red is for what can
// be tapped; a person with no colour of their own wears the warm neutral, and one with a colour wears that colour's tint.
describe("People list: avatars are never the flat brand red", () => {
  it("a person with no colour wears the neutral avatar; one with a colour wears a soft tint of it", () => {
    const { container } = list({ people: [p("a", "Aaron Roman"), p("b", "Bea Cole", { color: "teal" })] });
    const avs = [...container.querySelectorAll(".person-row-ruled .av")];
    expect(avs).toHaveLength(2);
    expect(avs[0]!.className).not.toMatch(/av-accent|cat-bg-red/);
    expect(avs[0]!.className).toMatch(/av-soft/);
    expect(avs[1]!.className).toMatch(/av-soft/);
    expect(avs[1]!.className).toMatch(/teal/);
  });
});

describe("a person's card: the lines it writes are Title Case", () => {
  const baseProps = { onEdit: () => {}, onBack: () => {}, quiet: false, onCheckIn: () => {} };

  it("the way JARVIS writes, the trusted adult and the promise", () => {
    render(<PersonDetail person={p("m", "Mom", { register: "friend" })} {...baseProps} />);
    expect(screen.getByText("JARVIS Writes")).toBeInTheDocument();
    expect(screen.getByText("Like a Close Friend")).toBeInTheDocument();
    cleanup();
    render(<PersonDetail person={p("m", "Mom", { flagged: true })} {...baseProps} />);
    expect(screen.getByText("With Care, Always Professional")).toBeInTheDocument();
    cleanup();
    render(<PersonDetail person={p("m", "Mom")} {...baseProps} trustedAdult promises={[{ threadId: "t1", text: "Send the form" }]} onAddTask={() => {}} />);
    expect(screen.getByText("Trusted Adult")).toBeInTheDocument();
    expect(screen.getByText("You Promised")).toBeInTheDocument();
  });

  it("no lowercase word leads a fact or a label on the card", () => {
    const { container } = render(<PersonDetail person={p("m", "Mom", { register: "casual", relationship: "Mother" })} {...baseProps} trustedAdult lastTalked="3 Days Ago" />);
    for (const el of container.querySelectorAll(".conn-name, .kv-val, .facts .fact")) {
      expect(el.textContent ?? "", el.textContent ?? "").not.toMatch(/^[a-z]/);
    }
  });
});

describe("Call Prep: the lines under the name", () => {
  const draw = (iso: string | null) => render(
    <CallPrepSheet person={p("m", "Mom", { register: "friend", ...(iso ? { lastCallAttempt: iso } : {}) } as Partial<Person["data"]>)}
      onCall={async () => null} onUndoCall={async () => {}} onClose={() => {}} />,
  );

  it("says when you last called in Title Case, whatever the day count", () => {
    const day = 86400000;
    for (const [ago, want] of [[0, "You Called Today"], [1, "You Called Yesterday"], [5, "You Called 5 Days Ago"], [45, "You Called a Month Ago"]] as const) {
      draw(new Date(Date.now() - ago * day - 1000).toISOString());
      const line = [...document.querySelectorAll(".conn-meta")].map((e) => e.textContent).find((t) => t?.startsWith("You Called"));
      expect(line, `${ago} days`).toBe(want);
      cleanup();
    }
  });

  it("the way JARVIS writes is Title Case", () => {
    draw(null);
    expect(screen.getByText("Like a Close Friend")).toBeInTheDocument();
  });
});

describe("a reminder's own words on a person's row keep the one clock shape", () => {
  it("2:00 PM, with the space, never 2:00PM", () => {
    expect(reminderAtLabel("14:00")).toBe("Reminds at 2:00 PM");
    expect(reminderAtLabel("09:05")).toBe("Reminds at 9:05 AM");
    expect(reminderAtLabel("00:30")).toBe("Reminds at 12:30 AM");
  });
});

// CLEAN ROWS, SECTION ACTIONS ON THE HEAD (Dave 2026-10-05, locked). "Add Person" is the Your People head's one capsule,
// beside the title, never a row at the foot of the card; person rows hold no capsule at all.
describe("People list: the add is on the section head, rows are clean", () => {
  it("Add Person is the head's see-all capsule, not a row inside the card", () => {
    const { container } = list();
    const head = [...container.querySelectorAll(".sh2")].find((h) => h.textContent?.includes("Your People"))!;
    const cap = head.querySelector("button.see-all.pill-action");
    expect(cap?.textContent).toBe("Add Person");
    for (const card of container.querySelectorAll(".card")) {
      expect(card.textContent).not.toContain("Add Person");
    }
    expect(container.querySelector(".row-act")).toBeNull();
  });

  it("no person row carries a capsule", () => {
    const { container } = list();
    for (const row of container.querySelectorAll(".person-row-ruled")) {
      expect(row.querySelector(".pill-act, .row-act, .btn-sm, .quiet-action"), row.textContent ?? "").toBeNull();
    }
  });
});

describe("a person's card: rows are clean and the right action shows when it is wanted", () => {
  const baseProps = { onEdit: () => {}, onBack: () => {}, onCheckIn: () => {} };
  const person = p("m", "Mom", { relationship: "Family" });
  const rowCaps = (c: Element) => [...c.querySelectorAll(".row, .task-row")].flatMap((r) => [...r.querySelectorAll(".pill-act, .row-act, .btn-sm, .quiet-action")]);

  it("a quiet contact surfaces Check In as text in the row, never as a capsule; a recent one shows nothing", () => {
    const quiet = render(<PersonDetail person={person} {...baseProps} lastTalked="2 Months ago" quiet />);
    const ctx = quiet.container.querySelector(".row .row-ctx");
    expect(ctx?.textContent).toBe("Check In");
    expect(rowCaps(quiet.container)).toEqual([]);
    quiet.unmount();
    const recent = render(<PersonDetail person={person} {...baseProps} lastTalked="3 Days Ago" quiet={false} />);
    expect(recent.container.querySelector(".row-ctx")).toBeNull();
  });

  it("a promise's Add Task is in its sheet, and surfaces on the row only once the promise is overdue", () => {
    const past = { threadId: "t1", text: "Send the roster", due: "2020-01-01" };
    const later = { threadId: "t2", text: "Book the field", due: "2099-01-01" };
    const { container } = render(<PersonDetail person={person} {...baseProps} promises={[past, later]} onAddTask={() => {}} />);
    expect(rowCaps(container)).toEqual([]);
    const rows = [...container.querySelectorAll(".row")];
    const overdueRow = rows.find((r) => r.textContent?.includes("Send the roster"))!;
    const laterRow = rows.find((r) => r.textContent?.includes("Book the field"))!;
    expect(overdueRow.querySelector(".row-ctx")?.textContent).toBe("Add Task");
    expect(laterRow.querySelector(".row-ctx")).toBeNull();
  });

  it("Add Something is on the Next Time We Talk head, and with nothing to list there is no card round it", () => {
    const { container } = render(<PersonDetail person={person} {...baseProps} onAddPoint={() => {}} onTogglePoint={() => {}} />);
    const head = [...container.querySelectorAll(".sh2")].find((h) => h.textContent?.includes("Next Time We Talk"))!;
    // "Add Topic", not a bare "Add": the capsule says what it adds (Dave 2026-10-05, the review).
    expect(head.querySelector("button.see-all.pill-action")?.textContent).toBe("Add Topic");
    expect(head.querySelector("button.see-all.pill-action")?.getAttribute("aria-label")).toBe("Add Something to Talk About");
    expect(container.querySelector(".card .row-create")).toBeNull();
    // The only card with "Add Something" in it would be a box holding nothing but an action.
    for (const card of container.querySelectorAll(".card")) expect(card.textContent).not.toMatch(/Add Something|Add Topic|^Add$/);
  });

  // CRAFTED, NOT BLANK, AND NEVER A DEAD END (2026-10-05, law L7): the empty talking-points state keeps its words and carries the
  // one action that fills it, in its own words so it never reads as a second copy of the head's capsule.
  it("with no topics saved the empty state carries its own action, which opens the add field", () => {
    const { container } = render(<PersonDetail person={person} {...baseProps} onAddPoint={() => {}} onTogglePoint={() => {}} />);
    const empty = container.querySelector(".empty-state")!;
    expect(empty.querySelector(".empty-title")?.textContent).toBe("Nothing to Bring Up Yet");
    const act = empty.querySelector("button")!;
    expect(act.textContent).toBe("Save a Topic");
    fireEvent.click(act);
    expect(container.querySelector(".empty-state"), "the empty state steps aside once the field is open").toBeNull();
    expect(container.querySelector("input, [contenteditable]")).not.toBeNull();
  });
});
