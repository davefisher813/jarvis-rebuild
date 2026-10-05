// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useCategories } from "../data/NotesProvider";
import BrainFlow from "./BrainFlow";

// One Money (2026-08-10): Dave, first "there should only be one money
// category with all of its features", then, after the category still opened
// a page here, "it looks the same. i only want one money category." The
// category no longer renders as a row in Brain at all -- LIFE_AREAS_TAB_HANDOFF
// (2026-09-16) moved every category off Brain and onto Life's Areas tab,
// money-kind included by name -- so there is nothing to tap here to reach
// it. The one remaining path that can still land on a money category id is
// a deep-link (openKey, e.g. from search): that gets caught here and handed
// to onOpenMoney instead of opening a page.

// A category's detail page is open when its page is drawn. These areas hold nothing, so the page is the one crafted empty state
// (round-2 review, 2026-10-05): "Nothing in <Name> Yet", not four bare section heads.
const AREA_OPEN = /^Nothing in .* Yet$/;

describe("BrainFlow: the Money category is never a destination here", () => {
  it("no category renders as a row on Brain at all, money-kind or ordinary", async () => {
    function Seeded() {
      const cats = useCategories();
      const [ready, setReady] = useState(false);
      useEffect(() => {
        (async () => {
          await cats.create("Money", "yellow"); // "Money" auto-suggests kind money
          await cats.create("Home", "blue"); // an ordinary category, unaffected
          setReady(true);
        })();
      }, [cats]);
      return ready ? <BrainFlow /> : null;
    }
    render(<NotesProvider userId="b1"><Seeded /></NotesProvider>);
    // The hub itself, proven by a static nav row that always renders.
    expect(await screen.findByText("Contacts")).toBeInTheDocument();
    expect(screen.queryByText("Home")).not.toBeInTheDocument();
    expect(screen.queryByText("Money")).not.toBeInTheDocument();
  });

  it("a search deep-link straight into a money category id hands off to onOpenMoney, not a dead-end page", async () => {
    const onOpenMoney = vi.fn();
    function SeededDeepLink() {
      const c = useCategories();
      const [key, setKey] = useState<string | undefined>(undefined);
      useEffect(() => {
        (async () => {
          const moneyId = await c.create("Money", "yellow");
          setKey(moneyId!);
        })();
      }, [c]);
      return key ? <BrainFlow openKey={key} onOpenMoney={onOpenMoney} /> : null;
    }
    render(<NotesProvider userId="b2"><SeededDeepLink /></NotesProvider>);
    await waitFor(() => expect(onOpenMoney).toHaveBeenCalled());
    expect(screen.queryByText(AREA_OPEN)).not.toBeInTheDocument();
  });

  it("a deep-link into an ordinary category still opens its detail page, unaffected", async () => {
    const onOpenMoney = vi.fn();
    function SeededDeepLink() {
      const c = useCategories();
      const [key, setKey] = useState<string | undefined>(undefined);
      useEffect(() => {
        (async () => {
          const homeId = await c.create("Home", "blue");
          setKey(homeId!);
        })();
      }, [c]);
      return key ? <BrainFlow openKey={key} onOpenMoney={onOpenMoney} /> : null;
    }
    render(<NotesProvider userId="b3"><SeededDeepLink /></NotesProvider>);
    await waitFor(() => expect(screen.getByText(AREA_OPEN)).toBeInTheDocument());
    expect(onOpenMoney).not.toHaveBeenCalled();
  });

  it("without onOpenMoney wired, a money deep-link falls back to the old page rather than doing nothing", async () => {
    function SeededDeepLink() {
      const c = useCategories();
      const [key, setKey] = useState<string | undefined>(undefined);
      useEffect(() => {
        (async () => {
          const moneyId = await c.create("Money", "yellow");
          setKey(moneyId!);
        })();
      }, [c]);
      return key ? <BrainFlow openKey={key} /> : null;
    }
    render(<NotesProvider userId="b4"><SeededDeepLink /></NotesProvider>);
    // No onOpenMoney passed: the effect's guard (`!onOpenMoney`) means the
    // category still opens normally, so an un-wired caller never silently
    // eats the deep-link.
    await waitFor(() => expect(screen.getByText(AREA_OPEN)).toBeInTheDocument());
  });
});

// S5-Q31 (2026-09-04): "a workout in progress is invisible outside the gym."
// Today's live-session card hands AppShell a categoryId plus a flag saying
// "and open the gym," not just "open this category" -- openKey alone used to
// land on the ordinary health page, one more tap away from the session it
// was already in. autoOpenGym is what closes that last hop, threaded through
// BrainFlow into CategoryDetail's own gymOpen seed.
describe("BrainFlow: a live-session deep-link lands in the gym, not the category page (S5-Q31)", () => {
  it("openKey + autoOpenGym skips straight past the health page", async () => {
    function Seeded() {
      const cats = useCategories();
      const [cid, setCid] = useState("");
      useEffect(() => {
        (async () => { setCid((await cats.create("Health", "blue"))!); })();
      }, [cats]);
      return cid ? <BrainFlow openKey={cid} autoOpenGym /> : null;
    }
    render(<NotesProvider userId="b-gym1"><Seeded /></NotesProvider>);
    // GymFlow's own empty state (no program seeded here) proves the gym
    // mounted immediately -- the ordinary health page's log section
    // never gets a chance to render.
    await waitFor(() => expect(screen.getByText("No Program Yet")).toBeInTheDocument());
    expect(screen.queryByText("Today's Log")).not.toBeInTheDocument();
  });

  // BRAIN-F-04 (2026-09-05): the flag was cleared only by a bottom-tab tap, so
  // every later open of the Health area walked back into the live session.
  it("tells the shell the gym flag is spent, so a later visit lands on the page", async () => {
    const consumed = vi.fn();
    function Seeded() {
      const cats = useCategories();
      const [cid, setCid] = useState("");
      useEffect(() => {
        (async () => { setCid((await cats.create("Health", "blue"))!); })();
      }, [cats]);
      return cid ? <BrainFlow openKey={cid} autoOpenGym gymNonce={1} onGymConsumed={consumed} /> : null;
    }
    render(<NotesProvider userId="b-gym2"><Seeded /></NotesProvider>);
    await waitFor(() => expect(consumed).toHaveBeenCalled());
  });
});

// BRAIN-F-03 (2026-09-05): openKey was read once, in a useState initialiser,
// so a deep link that arrived while the Brain tab was ALREADY the active tab
// did nothing: capture a fact in Quick Add and tap it in Recent Captures, or
// search an area from the Brain hub, and the overlay closed onto the same
// screen. Every other tab worked because switching tabs remounts the flow.
import { fireEvent } from "@testing-library/react";

function Deep({ onKeyConsumed }: { onKeyConsumed?: () => void }) {
  const cats = useCategories();
  const [id, setId] = useState<string | undefined>(undefined);
  const [key, setKey] = useState<string | undefined>(undefined);
  const [nonce, setNonce] = useState(0);
  useEffect(() => { (async () => setId((await cats.create("Bridge", "blue"))!))(); }, [cats]);
  // Mounted only once the area exists, so the hub's own list is loaded: the
  // point under test is a key arriving LATER, at a flow already on screen.
  return id ? (
    <>
      <button onClick={() => { setKey(id); setNonce((n) => n + 1); }}>Link It</button>
      <BrainFlow openKey={key} openNonce={nonce} onKeyConsumed={() => { setKey(undefined); onKeyConsumed?.(); }} />
    </>
  ) : null;
}

describe("BrainFlow deep links while the tab is already open (BRAIN-F-03)", () => {
  it("opens on a key that arrives after mount, and says it consumed it", async () => {
    const consumed = vi.fn();
    render(<NotesProvider userId="deep1"><Deep onKeyConsumed={consumed} /></NotesProvider>);
    // The hub, with no detail open. "Link It" only renders once the area
    // exists (Deep's own mount gate), the same readiness "Bridge" as a row
    // used to prove before categories moved off Brain entirely.
    expect(await screen.findByText("Link It")).toBeInTheDocument();
    expect(screen.queryByText(AREA_OPEN)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Link It"));
    await waitFor(() => expect(screen.getByText(AREA_OPEN)).toBeInTheDocument());
    expect(consumed).toHaveBeenCalled();
  });

  it("the same key a second time still navigates, because the nonce moved", async () => {
    render(<NotesProvider userId="deep2"><Deep /></NotesProvider>);
    await screen.findByText("Link It");
    fireEvent.click(screen.getByText("Link It"));
    await waitFor(() => expect(screen.getByText(AREA_OPEN)).toBeInTheDocument());

    // Back to the hub, the way a person backs out of a detail.
    fireEvent.click(screen.getByLabelText("Back"));
    await waitFor(() => expect(screen.queryByText(AREA_OPEN)).not.toBeInTheDocument());

    fireEvent.click(screen.getByText("Link It"));
    await waitFor(() => expect(screen.getByText(AREA_OPEN)).toBeInTheDocument());
  });
});

// Slice 09 QA (2026-10-04): the AI Hub row set openKey "aihub", and the guard
// that closes an unknown key (a category deleted under a stale search result)
// did not know it, so the hub opened and closed within a frame: a dead button.
describe("BrainFlow: the AI Hub key opens the hub and stays open", () => {
  function HubLink() {
    const [key, setKey] = useState<string | undefined>(undefined);
    const [nonce, setNonce] = useState(0);
    return (
      <>
        <button onClick={() => { setKey("aihub"); setNonce((n) => n + 1); }}>Open Hub</button>
        <BrainFlow openKey={key} openNonce={nonce} onKeyConsumed={() => setKey(undefined)} />
      </>
    );
  }
  it("renders the AI Hub screen after the key arrives, and it is still there a few frames later", async () => {
    render(<NotesProvider userId="hub1"><HubLink /></NotesProvider>);
    expect(await screen.findByText("Contacts")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Open Hub"));
    await waitFor(() => expect(screen.getAllByText("AI Hub").length).toBeGreaterThan(0));
    // The bug closed it on the next effect pass; give it several.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getAllByText("AI Hub").length).toBeGreaterThan(0);
    expect(screen.queryByText("Contacts")).not.toBeInTheDocument();
  });
});

// BRAIN-F-04 (2026-09-05): the person, decision, fact and gym intents were
// consumed at a child's mount and cleared only by a bottom-tab tap, so
// following a link to a person and backing all the way out left the id sitting
// in the shell: tapping Contacts later jumped straight back to them.
import { usePeople } from "../data/NotesProvider";

function PersonLink() {
  const people = usePeople();
  const [id, setId] = useState<string | undefined>(undefined);
  // The shell's own one-shot, in miniature: fire bumps the nonce, the child
  // clears it when it opens the person.
  const [intent, setIntent] = useState<{ value?: string; nonce: number }>({ nonce: 0 });
  const [key, setKey] = useState<string | undefined>(undefined);
  const [keyNonce, setKeyNonce] = useState(0);
  useEffect(() => { (async () => setId((await people.create({ name: "Marco Vidal", group: "contacts" }))!))(); }, [people]);
  return id ? (
    <>
      <button onClick={() => { setIntent((i) => ({ value: id, nonce: i.nonce + 1 })); setKey("contacts"); setKeyNonce((n) => n + 1); }}>Link Marco</button>
      <BrainFlow
        openKey={key} openNonce={keyNonce} onKeyConsumed={() => setKey(undefined)}
        personOpenId={intent.value} personNonce={intent.nonce}
        onPersonConsumed={() => setIntent((i) => ({ nonce: i.nonce }))}
      />
    </>
  ) : null;
}

describe("BrainFlow person deep link (BRAIN-F-04)", () => {
  it("opens the person once, and a later visit to Contacts shows the list", async () => {
    render(<NotesProvider userId="deep3"><PersonLink /></NotesProvider>);
    await screen.findByText("Contacts");
    fireEvent.click(screen.getByText("Link Marco"));
    // The person's own card: Edit is on the card, never on the list.
    await waitFor(() => expect(screen.getByLabelText("Edit")).toBeInTheDocument());

    // Back out of the card (the same labelled back every Brain page wears, round 2: it says where it goes), then out of Contacts,
    // then open Contacts by hand.
    fireEvent.click(screen.getByRole("button", { name: "Contacts" }));
    await waitFor(() => expect(screen.getByText("Add Person")).toBeInTheDocument());
    // The list's own back is the large-title page's "‹ Brain" (the named back of PageHeader, never an icon-only "Back").
    fireEvent.click(screen.getByRole("button", { name: "Brain" }));
    await waitFor(() => expect(screen.getByText("Life Philosophy")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Contacts"));

    // The list, not Marco's card.
    await waitFor(() => expect(screen.getByText("Add Person")).toBeInTheDocument());
    expect(screen.queryByLabelText("Edit")).not.toBeInTheDocument();
  });
});

// ALFRED 2026-10-04: a stray floating "< Life" over "Your Routine" on the Brain hub. A cross-tab jump (Life > Areas >
// an area, a search hit, a notice's Open) makes the shell draw a return pill while the page it opened is up. The page's
// own back closed to the hub and the origin stayed live, so the pill hung over the hub's last row. The real shell, the
// real pill and the real flow, with an origin that is live the way a jump leaves it.
import { useCallback } from "react";
import { NavOriginProvider } from "../shell/navOrigin";
import ReturnPill from "../shell/ReturnPill";

function JumpShell({ openKey, onClear }: { openKey: string; onClear?: () => void }) {
  const [claims, setClaims] = useState(0);
  const claim = useCallback(() => { setClaims((n) => n + 1); return () => setClaims((n) => n - 1); }, []);
  // The shell's own wiring: the origin is state, and clear() ends it.
  const [origin, setOrigin] = useState<{ key: string; label: string } | null>({ key: "life", label: "Life" });
  const clear = useCallback(() => { onClear?.(); setOrigin(null); }, [onClear]);
  const [key, setKey] = useState<string | undefined>(openKey);
  return (
    <NavOriginProvider value={{ origin, back: () => true, claim, claimed: claims > 0, clear }}>
      <BrainFlow openKey={key} openNonce={1} onKeyConsumed={() => setKey(undefined)} />
      <ReturnPill />
    </NavOriginProvider>
  );
}

describe("BrainFlow: the return pill does not outlive the page a jump opened", () => {
  function Seeded() {
    const cats = useCategories();
    const [cid, setCid] = useState("");
    useEffect(() => { (async () => setCid((await cats.create("Bridge", "blue"))!))(); }, [cats]);
    return cid ? <JumpShell openKey={cid} /> : null;
  }

  it("shows the way home on the page the jump opened, and not on the hub after backing out of it", async () => {
    render(<NotesProvider userId="pill1"><Seeded /></NotesProvider>);
    await waitFor(() => expect(screen.getByText(AREA_OPEN)).toBeInTheDocument());
    // On the page the jump opened, the pill is the way home, as designed.
    expect(screen.getByRole("button", { name: "Life" })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Back"));
    await waitFor(() => expect(screen.getByText("Your Routine")).toBeInTheDocument());
    // The hub is not a page a jump opened: no "< Life" floating over its last row.
    expect(screen.queryByRole("button", { name: "Life" })).not.toBeInTheDocument();
  });

  // The ROOT of it: the page releases the origin when it closes, rather than the flow hiding a live one behind a claim.
  it("releases the origin itself when the page the jump opened closes (nothing is merely hidden)", async () => {
    const clear = vi.fn();
    function Seed() {
      const cats = useCategories();
      const [cid, setCid] = useState("");
      useEffect(() => { void (async () => setCid((await cats.create("Bridge", "blue"))!))(); }, [cats]);
      return cid ? <JumpShell openKey={cid} onClear={clear} /> : null;
    }
    render(<NotesProvider userId="pill3"><Seed /></NotesProvider>);
    await waitFor(() => expect(screen.getByText(AREA_OPEN)).toBeInTheDocument());
    expect(clear, "still open: still the way home").not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Back"));
    await waitFor(() => expect(screen.getByText("Your Routine")).toBeInTheDocument());
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("a page opened by a tap inside the hub never releases an origin it did not open", async () => {
    const clear = vi.fn();
    render(
      <NotesProvider userId="pill4">
        <NavOriginProvider value={{ origin: { key: "life", label: "Life" }, back: () => true, claim: () => () => {}, claimed: false, clear }}>
          <BrainFlow />
        </NavOriginProvider>
      </NotesProvider>,
    );
    fireEvent.click(await screen.findByText("Your Routine"));
    await waitFor(() => expect(screen.getByText("Protected Time")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Brain" }));
    await waitFor(() => expect(screen.getByText("Your Routine")).toBeInTheDocument());
    expect(clear).not.toHaveBeenCalled();
  });

  it("a page opened by a tap inside the hub never had a pill to begin with", async () => {
    function Plain() {
      const [claims, setClaims] = useState(0);
      const claim = useCallback(() => { setClaims((n) => n + 1); return () => setClaims((n) => n - 1); }, []);
      return (
        <NavOriginProvider value={{ origin: null, back: () => false, claim, claimed: claims > 0, clear: () => {} }}>
          <BrainFlow /><ReturnPill />
        </NavOriginProvider>
      );
    }
    render(<NotesProvider userId="pill2"><Plain /></NotesProvider>);
    fireEvent.click(await screen.findByText("Your Routine"));
    await waitFor(() => expect(screen.getByText("Protected Time")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Life" })).not.toBeInTheDocument();
  });
});

// ALFRED 2026-10-04: after a back from a page, the hub's EXPLORE list (and the band over it) was missing for as long as the
// reads took to come back, and for good when one failed. The real flow, in and back out, against the real services.
import { useStrands } from "../data/NotesProvider";

describe("BrainFlow: the hub is whole the moment a page closes over it", () => {
  function Seeded() {
    const strands = useStrands();
    const [ready, setReady] = useState(false);
    useEffect(() => { (async () => { await strands.add("Brainstorms best at night", "work_style", new Date().toISOString().slice(0, 10), "rule"); setReady(true); })(); }, [strands]);
    return ready ? <BrainFlow /> : null;
  }

  it("keeps the band and the Explore head over the nav list across What JARVIS Knows and back, with every row still there", async () => {
    render(<NotesProvider userId="back1"><Seeded /></NotesProvider>);
    await screen.findByText("Shaping JARVIS Now");
    const rows = () => [...document.querySelectorAll(".lib-row .lib-name")].map((e) => e.textContent);
    const before = rows();
    expect(before).toContain("What JARVIS Knows");
    expect(screen.getByText("Explore")).toBeInTheDocument();
    // Facts are drawn in Title Case (Alfred: "Brainstorms best at night").
    expect(screen.getByText("Brainstorms Best at Night")).toBeInTheDocument();

    fireEvent.click(screen.getByText("What JARVIS Knows", { selector: ".lib-name" }));
    await screen.findByText("What It Knows");
    fireEvent.click(screen.getByRole("button", { name: "Brain" }));

    // Synchronously after the back: no waiting on a read for the band, the head or any row.
    expect(screen.getByText("Shaping JARVIS Now")).toBeInTheDocument();
    expect(screen.getByText("Explore")).toBeInTheDocument();
    expect(rows()).toEqual(before);
  });
});

// THE SCROLL BOX IS SHARED BY THE HUB AND THE PAGES OVER IT (Alfred 2026-10-04: "a row disappeared after back navigation").
// .app-scroll is the one thing that scrolls; a page scrolled down and closed left the hub drawn already scrolled, its first
// rows behind the bar. A page opens at its top, and the hub comes back where it was.
describe("BrainFlow: scroll is per page, not per box", () => {
  it("opens a page at its top, and puts the hub back at the offset it was left at", async () => {
    const box = document.createElement("div");
    box.className = "app-scroll";
    document.body.appendChild(box);
    try {
      render(<NotesProvider userId="scroll1"><BrainFlow /></NotesProvider>, { container: box.appendChild(document.createElement("div")) });
      fireEvent.click(await screen.findByText("Your Routine"));
      await waitFor(() => expect(screen.getByText("Protected Time")).toBeInTheDocument());
      expect(box.scrollTop).toBe(0);
      box.scrollTop = 600; // the person scrolls the page down
      fireEvent.click(screen.getByRole("button", { name: "Brain" }));
      await screen.findByText("Your Routine");
      expect(box.scrollTop).toBe(0); // the hub was at the top when it was left, and is at the top again
    } finally { document.body.removeChild(box); }
  });

  it("remembers a scrolled hub across a page, so the rows the person was reading are the rows that come back", async () => {
    const box = document.createElement("div");
    box.className = "app-scroll";
    document.body.appendChild(box);
    try {
      render(<NotesProvider userId="scroll2"><BrainFlow /></NotesProvider>, { container: box.appendChild(document.createElement("div")) });
      const row = await screen.findByText("Your Routine");
      box.scrollTop = 140;
      fireEvent.click(row);
      await waitFor(() => expect(screen.getByText("Protected Time")).toBeInTheDocument());
      expect(box.scrollTop).toBe(0);
      box.scrollTop = 900;
      fireEvent.click(screen.getByRole("button", { name: "Brain" }));
      await screen.findByText("Your Routine");
      expect(box.scrollTop).toBe(140);
    } finally { document.body.removeChild(box); }
  });
});
