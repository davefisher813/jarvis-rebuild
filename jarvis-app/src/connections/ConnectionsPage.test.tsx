// SPEC MOVED (Catalog V3.1, 2026-08-18): Title Case everywhere; copy assertions updated.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useProfile } from "../data/NotesProvider";
import { GoogleSessionProvider } from "./google/GoogleSession";
import { makeFakeGoogleApi } from "./google/fakeApi";
import ConnectionsPage, { SIGNED_OUT_HELP } from "./ConnectionsPage";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";
import type { TokenOpts } from "./google/gis";

// The build flag is a module constant, so the unified-Email case is reached by
// answering for it here; every other flag keeps its real answer.
const flags = vi.hoisted(() => ({ intake: false }));
vi.mock("../substrate/flags", async (orig) => {
  const real = await orig<typeof import("../substrate/flags")>();
  return { ...real, flagOn: (f: Parameters<typeof real.flagOn>[0]) => (f === "email_intake_v1" ? flags.intake : real.flagOn(f)) };
});

const api = makeFakeGoogleApi({
  listUpcomingEvents: async () => [{ id: "g1", summary: "Standup", start: { dateTime: "2026-06-01T09:00:00Z" } }],
  listRecentMessages: async () => [
    { id: "m1", snippet: "hey", payload: { headers: [
      { name: "Subject", value: "Lunch?" }, { name: "From", value: "Sam <s@x.com>" },
    ] } },
  ],
});

function wrap(node: React.ReactNode) {
  return (
    <NotesProvider userId="u1">
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => api}>{node}</GoogleSessionProvider>
    </NotesProvider>
  );
}

describe("ConnectionsPage", () => {
  // The import's cold-read guard mark persists in jsdom localStorage across
  // tests and stalls the next import 2.4s (buttons stay busy). Isolate.
  beforeEach(() => localStorage.clear());

  // Amended again 2026-10-05 (the ship-blocker review: "a dead-end empty state with no action"). The setup state shows the head's one capsule
  // too: with no client id its tap says so in one warm line and opens nothing, so the screen always has its verb and never a blank.
  it("shows an honest setup state with the head's Connect Google capsule, which answers instead of opening a dead sign-in", () => {
    render(wrap(<ConnectionsPage configured={false} />));
    expect(screen.getByText("Google Is Not Connected Yet")).toBeInTheDocument();
    const head = screen.getByText("Google Accounts").closest(".sh2") as HTMLElement;
    const cap = within(head).getByRole("button", { name: "Connect Google" });
    expect(cap).toHaveClass("pill-action");
    expect(screen.queryByText("Google Sign-In Opens Soon")).toBeNull();
    fireEvent.click(cap);
    expect(screen.getByText("Google Sign-In Opens Soon")).toBeInTheDocument();
    expect(screen.queryByText("Connecting")).toBeNull();
  });
  // THE ONE CAPSULE OF AN EMPTY SCREEN IS THE HEAD'S (D9, round 2 review): Connect Google was a filled block under the words; it is the head's
  // capsule now, like Add Section on Email Sections, and the empty state is bare (no card around it).
  it("with no account yet, Connect Google is the Google Accounts head's capsule and the empty state is bare", async () => {
    const { container } = render(wrap(<ConnectionsPage configured />));
    const head = screen.getByText("Google Accounts").closest(".sh2") as HTMLElement;
    expect(within(head).getByText("Connect Google")).toHaveClass("pill-action");
    expect(container.querySelector(".btn-primary"), "no filled block under the words").toBeNull();
    expect(container.querySelector(".card .empty-state"), "no card around the empty state").toBeNull();
    expect(screen.getByText("No Accounts Yet").closest(".empty-state")!.querySelectorAll(".empty-sub")).toHaveLength(1);
  });
  it("connects the first account, imports calendar, lists the account with its controls", async () => {
    render(wrap(<ConnectionsPage configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    await waitFor(() => expect(screen.getByText("me@example.com Connected · Imported 1 Event")).toBeInTheDocument());
    const row = screen.getByText("me@example.com").closest(".row") as HTMLElement; // account row
    // THE ROW IS CLEAN (Dave 2026-10-05, locked: no chip or pill on a row): its tap is its sheet, which holds every control.
    expect(row.querySelector(".chip, .pill-act, .row-act, .btn-sm, .quiet-action")).toBeNull();
    expect(screen.queryByText("Disconnect")).toBeNull();
    fireEvent.click(row);
    expect(await screen.findByText("Disconnect")).toBeInTheDocument();
    // More can join: Add Account is the Google Accounts head's capsule, not a button at the foot of the list.
    const head = screen.getByText("Google Accounts").closest(".sh2") as HTMLElement;
    expect(within(head).getByText("Add Account")).toBeInTheDocument();
    expect(screen.queryByText("Add Google Account")).toBeNull();
  });

  it("disconnecting one account removes only that account", async () => {
    render(wrap(<ConnectionsPage configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText("me@example.com"));
    fireEvent.click(await screen.findByText("Disconnect"));
    // Armed two-tap (2026-08-09): first tap only arms.
    fireEvent.click(screen.getByText("Tap Again to Disconnect"));
    await waitFor(() => expect(screen.getByText("me@example.com Disconnected")).toBeInTheDocument());
    expect(screen.getByText("No Accounts Yet")).toBeInTheDocument();
  });
});

// PLUMB-F-16 (2026-09-05): the toggles were the only controls on this page
// that skipped run(). They flipped, the write failed, nothing said so, and
// the old setting was back on the next open. The tracking switch is the one
// that matters most: a pixel he believed he had turned off kept riding.
describe("ConnectionsPage toggles when the save fails", () => {
  beforeEach(() => localStorage.clear());

  // The page and GoogleSession share one ProfileService instance from the
  // provider, so breaking its save is the honest stand-in for offline, a
  // captive portal, or a token blip mid-write.
  function BreakSaves() {
    const profile = useProfile();
    return <button onClick={() => { profile.save = async () => { throw new Error("network"); }; }}>break-saves</button>;
  }

  const FAILED = WRITE_FAILED_MESSAGE;

  it("a feature switch that could not be saved goes back and says so", async () => {
    render(wrap(<><ConnectionsPage configured /><BreakSaves /></>));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText("me@example.com"));
    const cal = await screen.findByLabelText("Calendar for me@example.com");
    expect(cal).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByText("break-saves"));
    fireEvent.click(cal);
    await waitFor(() => expect(screen.getByText(FAILED)).toBeInTheDocument());
    // The switch is back on, because Calendar is still on: nothing was written.
    expect(screen.getByLabelText("Calendar for me@example.com")).toHaveAttribute("aria-checked", "true");
  });

  // NO DEAD DRIVE CHIP (2026-10-04). Dave asked for a Drive link on 2026-09-29
  // so Grant Access could be one tap; the chip stored a flag and nothing ever
  // read it, and Grant Access still only opens Google's own page. A chip that
  // changes nothing is not offered.
  it("offers Email and Calendar in the account's sheet, and no Drive switch that changes nothing", async () => {
    render(wrap(<ConnectionsPage configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    fireEvent.click(await screen.findByText("me@example.com"));
    expect(await screen.findByLabelText("Email for me@example.com")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Calendar for me@example.com")).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText("Drive")).toBeNull();
  });

  // READ RECEIPTS ONLY WHERE THEY EXIST (2026-10-04). The pixel is added by the
  // legacy mail pump. The unified Email tab sends with no tracking code at all,
  // so under email_intake_v1 the switch would be on or off over nothing.
  it("shows the open-tracking switch on the legacy mail path", async () => {
    flags.intake = false;
    render(wrap(<ConnectionsPage configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("me@example.com");
    expect(await screen.findByLabelText("Know When Your Email Is Opened")).toBeInTheDocument();
  });

  it("does not show a read-receipt switch the unified Email send cannot honour", async () => {
    flags.intake = true;
    try {
      render(wrap(<ConnectionsPage configured />));
      fireEvent.click(await screen.findByText("Connect Google"));
      await screen.findByText("me@example.com");
      expect(screen.queryByLabelText("Know When Your Email Is Opened")).toBeNull();
      expect(screen.queryByText("Know When Your Email Is Opened")).toBeNull();
      // Calendar is on for a new account, so its own line is still there.
      expect(screen.getByText("Calendar Import")).toBeInTheDocument();
    } finally { flags.intake = false; }
  });

  it("the open-tracking switch that could not be saved goes back and says so", async () => {
    render(wrap(<><ConnectionsPage configured /><BreakSaves /></>));
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("me@example.com");
    const sw = await screen.findByLabelText("Know When Your Email Is Opened");
    expect(sw).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByText("break-saves"));
    fireEvent.click(sw);
    await waitFor(() => expect(screen.getByText(FAILED)).toBeInTheDocument());
    expect(screen.getByLabelText("Know When Your Email Is Opened")).toHaveAttribute("aria-checked", "true");
  });
});

// AUDIT 2026-09-29: both Google accounts said "Signed out" and nothing else.
// A signed-out account is one the profile remembers and this launch holds no
// token for, so a fresh mount over the same stored profile is that state.
describe("ConnectionsPage, a signed-out account", () => {
  beforeEach(() => localStorage.clear());

  it("says what to do next, next to the Reconnect it points at", async () => {
    // One profile, and a session that can be thrown away and started again:
    // the account is remembered, this launch holds no token for it.
    function Relaunch() {
      const [n, setN] = useState(0);
      return (
        <NotesProvider userId="u1">
          <button onClick={() => setN(n + 1)}>relaunch</button>
          <GoogleSessionProvider key={n} requestToken={async () => "tok"} makeApi={() => api}><ConnectionsPage configured /></GoogleSessionProvider>
        </NotesProvider>
      );
    }
    render(<Relaunch />);
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("me@example.com");
    expect(screen.queryByText(SIGNED_OUT_HELP)).toBeNull(); // signed in: no nagging

    fireEvent.click(screen.getByText("relaunch"));
    await screen.findByText("Signed Out");
    expect(screen.getByText(SIGNED_OUT_HELP)).toBeInTheDocument();
    expect(SIGNED_OUT_HELP).toMatch(/^Google Asks Once for Access/);
    // Its moment has come, so the row quietly shows its one verb as text (Dave 2026-10-05), never a chip or a capsule.
    const verb = screen.getByText("Reconnect");
    expect(verb).toHaveClass("row-ctx");
    expect(verb.closest(".row")!.querySelector(".chip, .pill-act, .row-act, .btn-sm, .quiet-action")).toBeNull();
    // Reconnect All is the head's, never at the foot of the list.
    const head = screen.getByText("Google Accounts").closest(".sh2") as HTMLElement;
    expect(within(head).getByText("Reconnect All")).toBeInTheDocument();
  });
});

// THE RECONNECT THAT DID NOTHING (2026-10-10, live on build 93175ec). Sign In Again was a silent no-op whenever an earlier sign-in
// had left the page busy, and a Google window that never answered left Add Account on "Connecting" forever.
describe("ConnectionsPage sign-ins never stick", () => {
  beforeEach(() => localStorage.clear());

  function hanging() {
    const calls: TokenOpts[] = [];
    let answer: "hang" | "tok" = "hang";
    const requestToken = (opts?: TokenOpts) => {
      calls.push(opts ?? {});
      return answer === "hang" ? new Promise<string>(() => {}) : Promise.resolve("tok");
    };
    return { calls, requestToken, answer: (a: "hang" | "tok") => { answer = a; } };
  }
  function wrapWith(requestToken: (o?: TokenOpts) => Promise<string>, node: React.ReactNode) {
    return (
      <NotesProvider userId="u1">
        <GoogleSessionProvider requestToken={requestToken} makeApi={() => api}>{node}</GoogleSessionProvider>
      </NotesProvider>
    );
  }

  it("a Google window that never answers shows Cancel, and Cancel releases Connecting at once", async () => {
    const h = hanging();
    render(wrapWith(h.requestToken, <ConnectionsPage configured />));
    const head = screen.getByText("Google Accounts").closest(".sh2") as HTMLElement;
    fireEvent.click(within(head).getByRole("button", { name: "Connect Google" }));
    expect(within(head).getByRole("button", { name: "Connecting" })).toBeDisabled();
    fireEvent.click(within(head).getByRole("button", { name: "Cancel" }));
    expect(within(head).getByRole("button", { name: "Connect Google" })).toBeEnabled();
    expect(within(head).queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("Sign In Again goes straight to Google for that account, and works even while an earlier sign-in hangs", async () => {
    const h = hanging();
    h.answer("tok");
    render(wrapWith(h.requestToken, <ConnectionsPage configured />));
    const head = screen.getByText("Google Accounts").closest(".sh2") as HTMLElement;
    fireEvent.click(within(head).getByRole("button", { name: "Connect Google" }));
    await waitFor(() => expect(screen.getByText("me@example.com")).toBeInTheDocument());
    await waitFor(() => expect(within(head).getByRole("button", { name: "Add Account" })).toBeEnabled());

    // The first Sign In Again hangs in Google's window.
    h.answer("hang");
    fireEvent.click(screen.getByText("me@example.com"));
    fireEvent.click(await screen.findByText("Sign In Again"));
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]).toMatchObject({ loginHint: "me@example.com" });
    expect(within(head).getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    // Tapping Sign In Again again is never a silent no-op: the hung one is released and Google is asked again.
    fireEvent.click(screen.getByText("me@example.com"));
    fireEvent.click(await screen.findByText("Sign In Again"));
    expect(h.calls).toHaveLength(3);
    expect(h.calls[2]).toMatchObject({ loginHint: "me@example.com" });
  });
});
