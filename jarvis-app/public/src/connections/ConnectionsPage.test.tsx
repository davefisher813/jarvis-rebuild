// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
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
  it("shows an honest setup-required state and disables connect when unconfigured", () => {
    render(wrap(<ConnectionsPage configured={false} />));
    expect(screen.getByText("Google setup required")).toBeInTheDocument();
    expect((screen.getByText("Connect Google") as HTMLButtonElement).disabled).toBe(true);
  });
  it("connects, imports calendar, and shows mail when configured", async () => {
    render(wrap(<ConnectionsPage configured />));
    fireEvent.click(await screen.findByText("Connect Google"));
    await waitFor(() => expect(screen.getByText("Connected. Imported 1 event.")).toBeInTheDocument());
    expect(screen.getByText("Lunch?")).toBeInTheDocument();
    expect(screen.getByText("Disconnect")).toBeInTheDocument();
  });
});
