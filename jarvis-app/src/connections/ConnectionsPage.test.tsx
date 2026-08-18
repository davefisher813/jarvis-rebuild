// SPEC MOVED (Catalog V3.1, 2026-08-18): Title Case everywhere; copy assertions updated.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { GoogleSessionProvider } from "./google/GoogleSession";
import { makeFakeGoogleApi } from "./google/fakeApi";
import ConnectionsPage from "./ConnectionsPage";

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
