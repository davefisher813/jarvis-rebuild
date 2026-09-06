import { describe, it, expect } from "vitest";
import { relatedLines, relatedStrands, RELATED_CAP, type RelatedStores, type Anchor } from "./related";

// UP-MIND-23. ai/context.ts said "unscoped until relevance scoping ships"
// and every prompt carried everything JARVIS knew. These pin the walk: one
// hop, the anchor decides, and with no anchor nothing changes.

const stores = (over: Partial<RelatedStores> = {}): RelatedStores => ({
  today: "2026-08-15",
  tasks: [
    { id: "t1", text: "Send the roster", personId: "p1" },
    { id: "t2", text: "Buy milk" },
    { id: "t3", text: "Old thing", personId: "p1", done: true },
    { id: "t4", text: "Draft the scope", projectId: "pr1" },
  ],
  events: [
    { id: "e1", title: "Dinner with Marco Silva", date: "2026-08-20" },
    { id: "e2", title: "Dinner with Marco Silva", date: "2026-08-01" },
  ],
  decisions: [
    { decision: "Going with Ridgeline", why: "cheapest", linkedType: "person", linkedId: "p1" },
    { decision: "Moving the gym to mornings", linkedType: "person", linkedId: "p9" },
  ],
  notes: [{ title: "Field notes", connections: [{ type: "person", id: "p1" }] }],
  strands: [],
  projects: [{ id: "pr1", title: "Ridgeline" }],
  ...over,
});

const marco: Anchor = { personId: "p1", personName: "Marco Silva" };

describe("one hop from the thing in hand", () => {
  it("returns nothing without an anchor, which is what leaves every caller alone", () => {
    expect(relatedLines({}, stores())).toEqual([]);
  });

  it("walks the person's open work, upcoming time, decisions and notes", () => {
    const out = relatedLines(marco, stores());
    expect(out).toContain("Still open: Send the roster");
    expect(out).toContain("On the calendar: Dinner with Marco Silva (2026-08-20)");
    expect(out).toContain("Already decided: Going with Ridgeline (because cheapest)");
    expect(out).toContain("Note: Field notes");
  });

  it("leaves out what is finished, past, or somebody else's", () => {
    const out = relatedLines(marco, stores()).join(" | ");
    expect(out).not.toContain("Buy milk");
    expect(out).not.toContain("Old thing");
    expect(out).not.toContain("2026-08-01");
    expect(out).not.toContain("Moving the gym");
  });

  it("treats the project a thread is linked to as an anchor of its own", () => {
    const out = relatedLines({ threadId: "th1" }, stores({
      threadProject: (id) => (id === "th1" ? "pr1" : undefined),
    }));
    expect(out).toContain("Working on: Ridgeline");
    expect(out).toContain("Still open: Draft the scope");
  });

  it("stays capped, so a scoped block cannot become the unscoped one", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: "t" + i, text: "Thing " + i, personId: "p1" }));
    expect(relatedLines(marco, stores({ tasks: many }))).toHaveLength(RELATED_CAP);
  });
});

describe("the strands that ride along", () => {
  const strands = [
    { text: "Never opens with Hi there", category: "writing" },
    { text: "Trains in the mornings", category: "energy" },
    { text: "Marco Silva prefers a phone call", category: "people" },
  ];

  it("is everything when there is no anchor", () => {
    expect(relatedStrands({}, strands)).toHaveLength(3);
  });

  it("is the named bucket plus anything about the person, and nothing else", () => {
    const out = relatedStrands(marco, strands, "writing");
    expect(out).toEqual(["Never opens with Hi there", "Marco Silva prefers a phone call"]);
  });
});
