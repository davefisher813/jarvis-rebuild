// SPEC MOVED (Catalog V3.1, 2026-08-18): Title Case everywhere; copy assertions updated.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useProfile } from "../data/NotesProvider";
import { GoogleSessionProvider } from "./google/GoogleSession";
import { makeFakeGoogleApi } from "./google/fakeApi";
import ConnectionsPage, { SIGNED_OUT_HELP } from "./ConnectionsPage";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";

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

  it("shows an honest setup-required state and disables connect when unconfigured", () => {
    render(wrap(<ConnectionsPage configured={false} />));
    expect(screen.getByText("Google Setup Required")).toBeInTheDocument();
    expect((screen.getByText("Connect Google") as HTMLButtonElement).disabled).toBe(true);
  });
  it("connects the first account, imports calendar, lists the account with its controls", async () => {
    render(wrap(<ConnectionsPage configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    await waitFor(() => expect(screen.getByText("me@example.com Connected · Imported 1 Event")).toBeInTheDocument());
    expect(screen.getByText("me@example.com")).toBeInTheDocument(); // account row
    expect(screen.getByText("Disconnect")).toBeInTheDocument();
    expect(screen.getByText("Add Google Account")).toBeInTheDocument(); // more can join
  });

  it("disconnecting one account removes only that account", async () => {
    render(wrap(<ConnectionsPage configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("me@example.com");
    fireEvent.click(screen.getByText("Disconnect"));
    // Armed two-tap (2026-08-09): first tap only arms.
    fireEvent.click(screen.getByText("Tap Again"));
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

  it("a feature chip that could not be saved goes back and says so", async () => {
    render(wrap(<><ConnectionsPage configured /><BreakSaves /></>));
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("me@example.com");
    const cal = screen.getByText("Calendar") as HTMLButtonElement;
    expect(cal.className).toContain("on");

    fireEvent.click(screen.getByText("break-saves"));
    fireEvent.click(cal);
    await waitFor(() => expect(screen.getByText(FAILED)).toBeInTheDocument());
    // The chip is back on, because Calendar is still on: nothing was written.
    expect((screen.getByText("Calendar") as HTMLButtonElement).className).toContain("on");
  });

  // NO DEAD DRIVE CHIP (2026-10-04). Dave asked for a Drive link on 2026-09-29
  // so Grant Access could be one tap; the chip stored a flag and nothing ever
  // read it, and Grant Access still only opens Google's own page. A chip that
  // changes nothing is not offered.
  it("offers Email and Calendar on an account row, and no Drive chip that changes nothing", async () => {
    render(wrap(<ConnectionsPage configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("me@example.com");
    expect((screen.getByText("Email") as HTMLButtonElement).className).toContain("on");
    expect((screen.getByText("Calendar") as HTMLButtonElement).className).toContain("on");
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
    expect(screen.getByText("Reconnect")).toBeInTheDocument();
  });
});
