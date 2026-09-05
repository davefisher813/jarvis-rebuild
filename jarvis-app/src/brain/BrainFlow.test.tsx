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
// category no longer renders as a row in Brain at all (BrainPage.tsx drops
// money-kind categories from Your Categories), so there is nothing to tap
// here to reach it. The one remaining path that can still land on a money
// category id is a deep-link (openKey, e.g. from search): that gets caught
// here and handed to onOpenMoney instead of opening a page.

describe("BrainFlow: the Money category is never a destination here", () => {
  it("a Money category renders no row at all, so an ordinary category is the only thing to tap", async () => {
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
    expect(await screen.findByText("Home")).toBeInTheDocument();
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
    expect(screen.queryByText("Up Next")).not.toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText("Up Next")).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByText("Up Next")).toBeInTheDocument());
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
    // mounted immediately -- the ordinary health page's "Log It" section
    // never gets a chance to render.
    await waitFor(() => expect(screen.getByText("No Program Yet")).toBeInTheDocument());
    expect(screen.queryByText("Log It")).not.toBeInTheDocument();
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
    // The hub, with no detail open.
    expect(await screen.findByText("Bridge")).toBeInTheDocument();
    expect(screen.queryByText("Up Next")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Link It"));
    await waitFor(() => expect(screen.getByText("Up Next")).toBeInTheDocument());
    expect(consumed).toHaveBeenCalled();
  });

  it("the same key a second time still navigates, because the nonce moved", async () => {
    render(<NotesProvider userId="deep2"><Deep /></NotesProvider>);
    await screen.findByText("Bridge");
    fireEvent.click(screen.getByText("Link It"));
    await waitFor(() => expect(screen.getByText("Up Next")).toBeInTheDocument());

    // Back to the hub, the way a person backs out of a detail.
    fireEvent.click(screen.getByLabelText("Back"));
    await waitFor(() => expect(screen.queryByText("Up Next")).not.toBeInTheDocument());

    fireEvent.click(screen.getByText("Link It"));
    await waitFor(() => expect(screen.getByText("Up Next")).toBeInTheDocument());
  });
});
