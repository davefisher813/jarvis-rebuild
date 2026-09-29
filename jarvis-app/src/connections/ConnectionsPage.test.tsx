// SPEC MOVED (Catalog V3.1, 2026-08-18): Title Case everywhere; copy assertions updated.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useProfile } from "../data/NotesProvider";
import { GoogleSessionProvider } from "./google/GoogleSession";
import { makeFakeGoogleApi } from "./google/fakeApi";
import ConnectionsPage, { SIGNED_OUT_HELP } from "./ConnectionsPage";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";

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
    await waitFor(() => expect(screen.getByText("me@example.com connected. Imported 1 event.")).toBeInTheDocument());
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
    fireEvent.click(screen.getByText("Tap again"));
    await waitFor(() => expect(screen.getByText("me@example.com disconnected.")).toBeInTheDocument());
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

  // GOOGLE DRIVE (Dave 2026-09-29): a third link beside Email and Calendar.
  it("every account row offers Drive, off until it is turned on", async () => {
    render(wrap(<ConnectionsPage configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("me@example.com");
    const drive = screen.getByText("Drive") as HTMLButtonElement;
    expect(drive.className).not.toContain("on");
    expect(drive.getAttribute("aria-pressed")).toBe("false");
    // Email and Calendar are unchanged: still on for a new account.
    expect((screen.getByText("Email") as HTMLButtonElement).className).toContain("on");
    expect((screen.getByText("Calendar") as HTMLButtonElement).className).toContain("on");
  });

  it("turning Drive on and off is saved, and touches nothing else", async () => {
    render(wrap(<ConnectionsPage configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("me@example.com");
    fireEvent.click(screen.getByText("Drive"));
    await waitFor(() => expect((screen.getByText("Drive") as HTMLButtonElement).className).toContain("on"));
    expect((screen.getByText("Drive") as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByText("Email") as HTMLButtonElement).className).toContain("on");
    expect((screen.getByText("Calendar") as HTMLButtonElement).className).toContain("on");
    fireEvent.click(screen.getByText("Drive"));
    await waitFor(() => expect((screen.getByText("Drive") as HTMLButtonElement).className).not.toContain("on"));
  });

  it("a Drive link that could not be saved goes back and says so", async () => {
    render(wrap(<><ConnectionsPage configured /><BreakSaves /></>));
    fireEvent.click(await screen.findByText("Connect Google"));
    await screen.findByText("me@example.com");
    fireEvent.click(screen.getByText("break-saves"));
    fireEvent.click(screen.getByText("Drive"));
    await waitFor(() => expect(screen.getByText(FAILED)).toBeInTheDocument());
    expect((screen.getByText("Drive") as HTMLButtonElement).className).not.toContain("on");
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
    await screen.findByText("Signed out");
    expect(screen.getByText(SIGNED_OUT_HELP)).toBeInTheDocument();
    expect(SIGNED_OUT_HELP).toMatch(/^Tap Reconnect to sign in again/);
    expect(screen.getByText("Reconnect")).toBeInTheDocument();
  });
});
