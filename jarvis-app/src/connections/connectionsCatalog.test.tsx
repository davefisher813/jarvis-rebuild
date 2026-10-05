// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { lineCase } from "../shared/casing";
import { GoogleSessionProvider } from "./google/GoogleSession";
import { makeFakeGoogleApi } from "./google/fakeApi";
import ConnectionsPage, { SIGNED_OUT_HELP } from "./ConnectionsPage";

// THE VISUAL CATALOG, HELD ON CONNECTIONS (Dave 2026-10-05, "I am sick of
// this"). The page is rendered through the real Google session, signed in and
// signed out, and read from the DOM.
//
// Drift this pins: the signed-out help was a string with a middle dot typed
// in it, drawn into the row's meta line (§AM F3), in sentence case, and half
// of it said what the Reconnect chip already is; a setup-required card said
// its own title twice; the connect receipts were sentences with full stops
// ("me@example.com connected. Imported 1 event."); the email account's tile
// wore Event's sky instead of Mail's teal.

const MIDDOT = "·";
const norm = (e: Element) => (e.textContent ?? "").replace(/\s+/g, " ").trim();
const flags = vi.hoisted(() => ({ intake: false }));
vi.mock("../substrate/flags", async (orig) => {
  const real = await orig<typeof import("../substrate/flags")>();
  return { ...real, flagOn: (f: Parameters<typeof real.flagOn>[0]) => (f === "email_intake_v1" ? flags.intake : real.flagOn(f)) };
});

const api = makeFakeGoogleApi({
  listUpcomingEvents: async () => [{ id: "g1", summary: "Standup", start: { dateTime: "2026-06-01T09:00:00Z" } }],
});

function Relaunchable() {
  const [n, setN] = useState(0);
  return (
    <NotesProvider userId="u-cat-conn">
      <button onClick={() => setN(n + 1)}>relaunch</button>
      <GoogleSessionProvider key={n} requestToken={async () => "tok"} makeApi={() => api}><ConnectionsPage configured /></GoogleSessionProvider>
    </NotesProvider>
  );
}

/** Every rule the catalog holds that a DOM can show, for one rendered page. */
function scan(root: ParentNode): string[] {
  const bad: string[] = [];
  for (const el of root.querySelectorAll(".conn-meta, .fact, .facts, .row-value")) {
    if (norm(el).includes(MIDDOT)) bad.push(`typed dot in ${el.className}: "${norm(el)}"`);
  }
  for (const line of root.querySelectorAll(".facts, .conn-meta")) {
    if (!norm(line)) bad.push(`an empty ${line.className} line`);
  }
  for (const el of root.querySelectorAll(".conn-name, .conn-meta, .empty-title, .empty-sub, .sh2 .t, .chip, .btn, .fact")) {
    const t = norm(el);
    if (!t || /@/.test(t)) continue;
    if (lineCase(t) !== t) bad.push(`not Title Case (${el.className}): "${t}" should be "${lineCase(t)}"`);
  }
  for (const row of root.querySelectorAll(".row")) {
    const name = norm(row.querySelector(".conn-name") ?? row);
    const metas = [...row.querySelectorAll(".conn-meta")].map(norm);
    for (const m of metas) if (m.toLowerCase() === name.toLowerCase()) bad.push(`the grey line repeats its row: "${name}"`);
  }
  return bad;
}

beforeEach(() => { localStorage.clear(); flags.intake = false; });

describe("ConnectionsPage follows the catalog", () => {
  it("setup required says why once, in one line that is not the title again, with a glyph in its type's colour", () => {
    const { container } = render(
      <NotesProvider userId="u-cat-conn-setup"><GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => api}><ConnectionsPage configured={false} /></GoogleSessionProvider></NotesProvider>,
    );
    expect(screen.getByText("Google Setup Required")).toBeInTheDocument();
    const card = screen.getByText("Google Setup Required").closest(".empty-state")!;
    const sub = card.querySelector(".empty-sub")!;
    expect(sub, "the one line that says why, so the card is a calm note and not a dead end").not.toBeNull();
    expect(sub.textContent!.toLowerCase(), "not the title again").not.toContain("setup required");
    expect(card.querySelectorAll(".empty-sub")).toHaveLength(1);
    expect(card.querySelector(".empty-icon")!.className).toMatch(/cat-fg-/);
    expect(scan(container)).toEqual([]);
  });

  // Dave 2026-10-05: the Google Setup Required card stretched the height of the phone inside the Settings stack. The
  // bare .empty-state is the whole-screen empty page (min-height 65vh); a card on a screen with other sections is
  // .empty-compact. And it says it once: "No Accounts Yet" under it was the same fact in a second card.
  it("the setup card sizes to its words (compact, not the 65vh page) and is not doubled by No Accounts Yet", () => {
    render(
      <NotesProvider userId="u-cat-conn-compact"><GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => api}><ConnectionsPage configured={false} /></GoogleSessionProvider></NotesProvider>,
    );
    const empties = document.querySelectorAll(".empty-state");
    expect(empties.length, "one empty card, saying it once").toBe(1);
    expect(empties[0]).toHaveClass("empty-compact");
    expect(screen.queryByText("No Accounts Yet")).toBeNull();
    // Under the head it explains, not above the screen.
    const head = screen.getByText("Google Accounts").closest(".sh2")!;
    expect(head.compareDocumentPosition(empties[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("every empty card on the page is compact, set up or not", async () => {
    const { container } = render(<Relaunchable />);
    await screen.findByText("No Accounts Yet");
    for (const e of container.querySelectorAll(".empty-state")) expect(e, "a card on a screen with other sections").toHaveClass("empty-compact");
  });

  it("a signed-in account, with its rows and its heads, is Title Case and carries no typed dot", async () => {
    const { container } = render(<Relaunchable />);
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("me@example.com", { selector: ".conn-name" });
    await screen.findByText("Calendar Import");
    expect(scan(container)).toEqual([]);
    expect(norm(screen.getByText("Calendar Import").closest(".row")!.querySelector(".conn-meta")!)).toBe("Events Flow Into Schedule");
  });

  it("the signed-out help has no typed dot and does not say what the Reconnect chip already is", async () => {
    expect(SIGNED_OUT_HELP).not.toContain(MIDDOT);
    expect(SIGNED_OUT_HELP).not.toMatch(/^Tap Reconnect/);
    expect(lineCase(SIGNED_OUT_HELP)).toBe(SIGNED_OUT_HELP);
    const { container } = render(<Relaunchable />);
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("me@example.com", { selector: ".conn-name" });
    fireEvent.click(screen.getByText("relaunch"));
    await screen.findByText("Signed Out");
    const row = screen.getByText("Signed Out").closest(".row")!;
    // One toned fact (amber, needs you) and one grey line: one grey per row.
    expect(screen.getByText("Signed Out")).toHaveClass("fact", "warn");
    expect(norm(row.querySelector(".conn-meta")!)).toBe(SIGNED_OUT_HELP);
    expect(scan(container)).toEqual([]);
  });

  it("the account's mail tile is Mail's teal, not Event's sky", async () => {
    const { container } = render(<Relaunchable />);
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("me@example.com", { selector: ".conn-name" });
    const tile = screen.getByText("me@example.com", { selector: ".conn-name" }).closest(".row")!.querySelector(".proj-icon")!;
    expect(tile).toHaveClass("cat-bg-teal");
    expect(tile).not.toHaveClass("cat-bg-sky");
    // Calendar Import is an Event thing, and stays sky.
    expect(screen.getByText("Calendar Import").closest(".row")!.querySelector(".proj-icon")).toHaveClass("cat-bg-sky");
    expect(container.querySelectorAll(".proj-icon").length).toBeGreaterThan(1);
  });

  it("the receipts are fragments joined by a dot, Title Case, with no full stops", async () => {
    render(<Relaunchable />);
    fireEvent.click(await screen.findByText("Connect Google"));
    const receipt = await waitFor(() => {
      const el = document.querySelector(".conn-status");
      if (!el) throw new Error("no receipt yet");
      return el;
    });
    expect(norm(receipt)).toBe("me@example.com Connected " + MIDDOT + " Imported 1 Event");
    expect(norm(receipt)).not.toMatch(/\.\s|\.$/);
    // Disconnect arms with Title Case words, then reports in the same shape.
    fireEvent.click(screen.getByText("me@example.com"));
    fireEvent.click(await screen.findByText("Disconnect"));
    fireEvent.click(screen.getByText("Tap Again to Disconnect"));
    await waitFor(() => expect(screen.getByText("me@example.com Disconnected")).toBeInTheDocument());
  });
});
