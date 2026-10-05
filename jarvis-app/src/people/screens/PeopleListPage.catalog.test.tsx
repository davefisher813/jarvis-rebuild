// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
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
  it("the import row's requirement and the old-import offer", () => {
    const { container } = list({ duplicateNotes: 2, onClearDuplicateNotes: () => {} });
    const importRow = [...container.querySelectorAll(".person-row-ruled")].find((r) => r.textContent?.includes("Import from File"))!;
    const line = importRow.querySelector(".r-k")!.textContent!;
    expect(line).toBe(".vcf or .csv with a Name Column");
    expect(titleCased(line)).toBe(true);
    for (const sub of container.querySelectorAll(".bp-sub")) expect(titleCased(sub.textContent!), sub.textContent!).toBe(true);
    expect(container.querySelector(".bp-sub")!.textContent).toBe("Left There by an Old Import");
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
