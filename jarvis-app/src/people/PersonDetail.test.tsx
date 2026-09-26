// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import PersonDetail from "./screens/PersonDetail";
import type { Person } from "./types";

// The richer person card (2026-08-10): email, phone, writing style, and
// categories were all STORED and all hidden. Now the card shows them, and
// phone/email are launchers (tel/sms/mailto), not text to retype.

const MOM: Person = {
  id: "p1",
  data: {
    name: "Mom", group: "contacts", relationship: "Mother",
    email: "mom@example.com", phone: "(607) 555-0142",
    register: "friend", categoryIds: ["c1"],
  },
};

describe("PersonDetail reach and facts", () => {
  it("renders tappable call, text, and email rows with real hrefs", () => {
    render(<PersonDetail person={MOM} onEdit={() => {}} onBack={() => {}} categoryNames={["Family"]} />);
    expect(screen.getByText("Call").closest("a")).toHaveAttribute("href", "tel:6075550142");
    expect(screen.getByText("Text").closest("a")).toHaveAttribute("href", "sms:6075550142");
    expect(screen.getByText("Email").closest("a")).toHaveAttribute("href", "mailto:mom@example.com");
  });

  it("shows how JARVIS writes to them and their categories", () => {
    render(<PersonDetail person={MOM} onEdit={() => {}} onBack={() => {}} categoryNames={["Family"]} />);
    expect(screen.getByText("Like a close friend")).toBeInTheDocument();
    expect(screen.getByText("Family")).toBeInTheDocument();
  });

  it("flagged wins over register, same precedence as drafting", () => {
    const flagged: Person = { id: "p2", data: { ...MOM.data, flagged: true } };
    render(<PersonDetail person={flagged} onEdit={() => {}} onBack={() => {}} />);
    expect(screen.getByText("With care, always professional")).toBeInTheDocument();
  });

  it("no email or phone means no reach card, not empty launchers", () => {
    const bare: Person = { id: "p3", data: { name: "Old Import", group: "contacts" } };
    render(<PersonDetail person={bare} onEdit={() => {}} onBack={() => {}} />);
    expect(screen.queryByText("Call")).not.toBeInTheDocument();
    expect(screen.queryByText("Email")).not.toBeInTheDocument();
  });
});

// S6-Q40 (2026-09-05): "a person's card cannot reach their email." Last
// Talked and the gone-quiet check-in draft (already written for the
// Family/area pages) brought to the person's own card, presentationally --
// this screen has no service access, so the caller resolves everything.
describe("PersonDetail: Last Talked and the check-in draft (S6-Q40)", () => {
  it("no lastTalked means no row at all, not an empty one", () => {
    render(<PersonDetail person={MOM} onEdit={() => {}} onBack={() => {}} />);
    expect(screen.queryByText("Last Talked")).not.toBeInTheDocument();
  });

  it("shows the ago sentence with no Check In action while still in touch", () => {
    render(<PersonDetail person={MOM} onEdit={() => {}} onBack={() => {}} lastTalked="3 Days ago" quiet={false} onCheckIn={() => {}} />);
    expect(screen.getByText("Last Talked")).toBeInTheDocument();
    expect(screen.getByText("3 Days ago")).toBeInTheDocument();
    expect(screen.queryByText("Check In")).not.toBeInTheDocument();
  });

  it("offers Check In once gone quiet, and it fires the draft", () => {
    const onCheckIn = vi.fn();
    render(<PersonDetail person={MOM} onEdit={() => {}} onBack={() => {}} lastTalked="Gone quiet · 2 Months ago" quiet onCheckIn={onCheckIn} />);
    expect(screen.getByText("Gone quiet · 2 Months ago")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Check In"));
    expect(onCheckIn).toHaveBeenCalledTimes(1);
  });

  it("reads Drafting and stays disabled while a draft is in flight", () => {
    render(<PersonDetail person={MOM} onEdit={() => {}} onBack={() => {}} lastTalked="Gone quiet · 2 Months ago" quiet onCheckIn={() => {}} checkingIn />);
    expect(screen.getByText("Drafting")).toBeDisabled();
  });

  it("a lastTalked row appears even with no other fact, so About isn't gated shut", () => {
    const bare: Person = { id: "p4", data: { name: "Old Coach", group: "contacts" } };
    render(<PersonDetail person={bare} onEdit={() => {}} onBack={() => {}} lastTalked="Yesterday" />);
    expect(screen.getByText("Last Talked")).toBeInTheDocument();
    expect(screen.getByText("Yesterday")).toBeInTheDocument();
  });

  // UP-ATH-07 (2026-09-06): the one fact the health module knows about this
  // person, resolved by the caller like everything else on this card.
  it("says Trusted adult on the person Say It to Someone reaches, and on nobody else", () => {
    render(<PersonDetail person={MOM} onEdit={() => {}} onBack={() => {}} trustedAdult />);
    expect(screen.getByText("Trusted adult")).toBeInTheDocument();
  });

  it("says nothing about it on an ordinary person", () => {
    render(<PersonDetail person={MOM} onEdit={() => {}} onBack={() => {}} />);
    expect(screen.queryByText("Trusted adult")).not.toBeInTheDocument();
  });
});

// EVERY WAY TO REACH THEM (People handoff, 2026-09-16). The card read the
// PRIMARY of each kind, so a contact with a mobile and a work line showed one
// and the other was invisible -- and before the import was fixed, the second
// one was sitting in the notes blob under this very card.
describe("reach them, with more than one of a kind", () => {
  const many = {
    id: "p9",
    data: {
      name: "Linda Fisher", group: "contacts" as const,
      phone: "555-010-3311",
      phones: [
        { value: "555-010-3311", label: "mobile" },
        { value: "555-010-9922", label: "home" },
      ],
      email: "linda@example.com",
      emails: [
        { value: "linda@example.com", label: "home" },
        { value: "l.fisher@bridgeclub.org", label: "work" },
      ],
    },
  };

  it("keeps the three verbs on the primary and gives every other one a row", () => {
    render(<PersonDetail person={many} onEdit={() => {}} onBack={() => {}} />);
    // The primary still answers Call, Text and Email without a choice.
    expect(screen.getByText("Call")).toBeInTheDocument();
    expect(screen.getByText("Text")).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
    // And the second of each is reachable at all, labelled as the file
    // labelled it.
    expect(screen.getByText("Call home")).toBeInTheDocument();
    // Drawn grouped now, though the stored value is untouched.
    expect(screen.getByText("(555) 010-9922")).toBeInTheDocument();
    expect(screen.getByText("Email work")).toBeInTheDocument();
    expect(screen.getByText("l.fisher@bridgeclub.org")).toBeInTheDocument();
  });

  it("labels nothing the source did not label", () => {
    render(<PersonDetail person={{ id: "p8", data: { name: "Plain", group: "contacts" as const, phones: [{ value: "555-1" }, { value: "555-2" }] } }} onEdit={() => {}} onBack={() => {}} />);
    // The extra number is a row that says "Call", not "Call mobile" on the
    // app's say-so.
    expect(screen.getAllByText("Call")).toHaveLength(2);
  });

  it("reads a person saved before the lists existed exactly as it did", () => {
    render(<PersonDetail person={{ id: "p7", data: { name: "Old Row", group: "contacts" as const, phone: "555-0100" } }} onEdit={() => {}} onBack={() => {}} />);
    // Call and Text each show the number, as they always have.
    // Seven digits: not a shape the formatter is certain about, so it draws
    // exactly what was stored.
    expect(screen.getAllByText("555-0100")).toHaveLength(2);
    expect(screen.queryByText("Call home")).not.toBeInTheDocument();
  });
});

// NEXT TIME WE TALK (People handoff, 2026-09-16). Undated points that raise
// no alert: "Do not automatically schedule alerts for talking points."
describe("next time we talk", () => {
  const withPoints = (points?: { id: string; text: string; discussed?: boolean }[]) => ({
    id: "p5",
    data: {
      name: "Alberto Martinez", group: "contacts" as const,
      ...(points ? { talkingPoints: points } : {}),
    },
  });

  it("is off entirely on a surface that cannot write", () => {
    render(<PersonDetail person={withPoints()} onEdit={() => {}} onBack={() => {}} />);
    expect(screen.queryByText("Next Time We Talk")).not.toBeInTheDocument();
  });

  it("offers a way to add one even when there are none yet", () => {
    render(<PersonDetail person={withPoints()} onEdit={() => {}} onBack={() => {}} onAddPoint={() => {}} />);
    expect(screen.getByText("Next Time We Talk")).toBeInTheDocument();
    expect(screen.getByText("Add Something")).toBeInTheDocument();
  });

  it("counts only the ones still to raise", () => {
    render(<PersonDetail onEdit={() => {}} onBack={() => {}} onAddPoint={() => {}}
      person={withPoints([
        { id: "a", text: "Ask about the layout" },
        { id: "b", text: "Thank him for the ride", discussed: true },
      ])} />);
    // Both are shown -- a discussed one is kept, not deleted, so "did I bring
    // that up?" is answerable -- and the count is of what is left.
    expect(screen.getByText("Ask about the layout")).toBeInTheDocument();
    expect(screen.getByText("Thank him for the ride")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("marks one discussed from the ring or from anywhere on the row", () => {
    const toggled: string[] = [];
    render(<PersonDetail onEdit={() => {}} onBack={() => {}} onAddPoint={() => {}}
      onTogglePoint={(id) => toggled.push(id)}
      person={withPoints([{ id: "a", text: "Ask about the layout" }])} />);
    fireEvent.click(screen.getByLabelText("Mark discussed: Ask about the layout"));
    expect(toggled).toEqual(["a"]);
    // The row is the door: a talking point has nothing else to open, so a tap
    // on the words means the same thing as a tap on the ring.
    fireEvent.click(screen.getByText("Ask about the layout"));
    expect(toggled).toEqual(["a", "a"]);
  });

  it("can undo the tick, so a wrong tap is not a one-way door", () => {
    const toggled: string[] = [];
    render(<PersonDetail onEdit={() => {}} onBack={() => {}} onAddPoint={() => {}}
      onTogglePoint={(id) => toggled.push(id)}
      person={withPoints([{ id: "a", text: "Ask about the layout", discussed: true }])} />);
    fireEvent.click(screen.getByLabelText("Not discussed yet: Ask about the layout"));
    expect(toggled).toEqual(["a"]);
  });
});

// A ROLE PER AREA: "Family · Mother", "Bridge · Board secretary". One label
// for the whole person could not hold both.
describe("roles, per area", () => {
  it("says what they are in each area that gave them a role", () => {
    render(<PersonDetail onEdit={() => {}} onBack={() => {}}
      person={{ id: "p6", data: { name: "Linda Fisher", group: "contacts" as const } }}
      categoryColors={[
        { name: "Family", color: "pink", role: "Mother" },
        { name: "Bridge", color: "teal", role: "Board secretary" },
      ]} />);
    expect(screen.getByText("Family · Mother")).toBeInTheDocument();
    expect(screen.getByText("Bridge · Board secretary")).toBeInTheDocument();
  });

  it("leaves an area with no role reading exactly as it did", () => {
    render(<PersonDetail onEdit={() => {}} onBack={() => {}}
      person={{ id: "p6", data: { name: "Linda Fisher", group: "contacts" as const } }}
      categoryColors={[{ name: "Family", color: "pink" }]} />);
    expect(screen.getByText("Family")).toBeInTheDocument();
  });
});

// THE GOALS THEIR WORK IS UNDER (People handoff, 2026-09-16). Reached through
// the projects they are on, because a person is not attached to a goal --
// their work is.
describe("goals, reached through their projects", () => {
  const person = { id: "g1", data: { name: "Alberto Martinez", group: "contacts" as const } };

  it("names the goal and says which project carried them there", () => {
    render(<PersonDetail person={person} onEdit={() => {}} onBack={() => {}}
      goals={[{ id: "goal1", title: "Open the second site", via: "Facility planning" }]} />);
    expect(screen.getByText("Open the second site")).toBeInTheDocument();
    // The link is visible rather than asserted.
    expect(screen.getByText("Through Facility planning")).toBeInTheDocument();
  });

  it("invents no progress figure for it", () => {
    const { container } = render(<PersonDetail person={person} onEdit={() => {}} onBack={() => {}}
      goals={[{ id: "goal1", title: "Open the second site", via: "Facility planning" }]} />);
    // The handoff: "do not invent progress calculations". Nothing on the row
    // claims a percentage or a count of anything.
    expect(container.textContent).not.toMatch(/%/);
  });

  it("says nothing at all when their work sits under no goal", () => {
    render(<PersonDetail person={person} onEdit={() => {}} onBack={() => {}} />);
    expect(screen.queryByText("Goals")).not.toBeInTheDocument();
  });
});

// TAP A FACT TO CHANGE IT (Dave 2026-09-16: "Why can't I edit anything?").
// The About rows stated what the app knew and answered no tap, so changing
// one wrong word meant finding the pencil in the bar.
describe("editing from the card", () => {
  const mom = {
    id: "m1",
    data: { name: "Mom", group: "contacts" as const, relationship: "Family", birthday: "1960-04-20" },
  };

  it("opens the editor from any fact row", () => {
    const edits: number[] = [];
    render(<PersonDetail person={mom} onEdit={() => edits.push(1)} onBack={() => {}} categoryNames={["Family"]} />);
    fireEvent.click(screen.getByText("Relationship"));
    fireEvent.click(screen.getByText("Birthday"));
    expect(edits).toHaveLength(2);
  });

  // NOT THE SAME WORD TWICE (photographed: "Family · Family"). The handoff
  // bans duplicated relationship labels, and typing "Family" as the
  // relationship beside the Family area is how one appears.
  it("drops a relationship chip that only repeats an area", () => {
    const { container } = render(<PersonDetail person={mom} onEdit={() => {}} onBack={() => {}}
      categoryColors={[{ name: "Family", color: "pink" }]} />);
    const facts = container.querySelector(".person-facts")!;
    expect(facts.querySelectorAll(".fact")).toHaveLength(1);
    // The relationship used to be found by .fact.sky. That class was deleted
    // with the blue subtext on 2026-09-21 and had painted nothing since, so the
    // relationship is now the one fact on this line that is not an area (an
    // area always carries .cat and its dot).
    expect(facts.querySelector(".fact:not(.cat)")).toBeNull();
  });

  it("keeps a relationship that says something the areas do not", () => {
    const { container } = render(
      <PersonDetail person={{ ...mom, data: { ...mom.data, relationship: "Mother" } }}
        onEdit={() => {}} onBack={() => {}} categoryColors={[{ name: "Family", color: "pink" }]} />);
    expect(container.querySelector(".person-facts .fact:not(.cat)")?.textContent).toBe("Mother");
  });
});

// C-61 under the Colour Key (§AM, R8): the promise's DATE carries the
// meaning, not the words. "You promised" is the line's one grey; the date
// follows the reminder and project window: gone by is late (red), today or
// tomorrow is due (amber), later is a neutral small-caps date, and a promise
// with no date has nothing to colour.
describe("PersonDetail: a promise's deadline takes the key", () => {
  const iso = (d: Date) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const inDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

  it("colours the date, not the words", () => {
    render(<PersonDetail person={MOM} onEdit={() => {}} onBack={() => {}}
      promises={[
        { threadId: "t-late", text: "Send the lease", due: "2020-01-15" },
        { threadId: "t-today", text: "Pay the deposit", due: inDays(0) },
        { threadId: "t-tomorrow", text: "Book the table", due: inDays(1) },
        { threadId: "t-later", text: "Return the ladder", due: inDays(2) },
        { threadId: "t-far", text: "Plan the trip", due: "2999-12-31" },
        { threadId: "t-open", text: "Call the plumber" },
      ]} />);
    const factsOf = (text: string) => screen.getByText(text).closest(".row")!.querySelector(".facts")!;
    for (const t of ["Send the lease", "Pay the deposit", "Book the table", "Return the ladder", "Plan the trip", "Call the plumber"]) {
      const words = factsOf(t).querySelector(".fact")!;
      expect(words.textContent).toBe("You promised");
      expect(words.className, t).toBe("fact");
    }
    expect(factsOf("Send the lease").querySelectorAll(".fact")[1]!.className).toBe("fact red");
    expect(factsOf("Pay the deposit").querySelectorAll(".fact")[1]!.className).toBe("fact warn");
    expect(factsOf("Book the table").querySelectorAll(".fact")[1]!.className).toBe("fact warn");
    expect(factsOf("Return the ladder").querySelectorAll(".fact")[1]!.className).toBe("fact date");
    expect(factsOf("Plan the trip").querySelectorAll(".fact")[1]!.className).toBe("fact date");
    expect(factsOf("Call the plumber").querySelectorAll(".fact")).toHaveLength(1);
  });
});

// Decided with Them (R8): the decision's date is a neutral date, so it is
// the small-caps .fact.date, not a second run of the row's grey.
describe("PersonDetail: a decision's date is a neutral date", () => {
  it("draws the date as .fact.date", () => {
    render(<PersonDetail person={MOM} onEdit={() => {}} onBack={() => {}}
      decided={[{ id: "d1", decision: "Split the rent", createdAt: "2026-03-04" }]} />);
    const facts = screen.getByText("Split the rent").closest(".row")!.querySelector(".facts")!;
    const date = facts.querySelectorAll(".fact");
    expect(date).toHaveLength(1);
    expect(date[0]!.className).toBe("fact date");
  });
});
