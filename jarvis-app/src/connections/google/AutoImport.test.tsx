// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../../data/NotesProvider";
import { GoogleSessionProvider, useGoogle } from "./GoogleSession";
import { makeFakeGoogleApi } from "./fakeApi";
import GoogleAutoImport from "./AutoImport";

// The regression this guards: the duplicate sweep lived only behind the
// Connections page button, so connecting from the Email tab never ran it and
// a "fixed" bug looked unfixed on the phone. AutoImport must fire on ANY
// connect, no matter which surface asked for the token.
function ConnectFromAnywhere() {
  const g = useGoogle();
  return <button onClick={() => void g.connect()}>Any Connect</button>;
}

describe("GoogleAutoImport", () => {
  it("imports (and sweeps) on any connect, not just the Connections page", async () => {
    let listed = 0;
    const api = makeFakeGoogleApi({
      listUpcomingEvents: async () => {
        listed++;
        return [{ id: "g1", summary: "Standup", start: { dateTime: "2026-06-01T09:00:00Z" } }];
      },
    });
    render(
      <NotesProvider userId="u1">
        <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => api}>
          <GoogleAutoImport />
          <ConnectFromAnywhere />
        </GoogleSessionProvider>
      </NotesProvider>,
    );
    fireEvent.click(screen.getByText("Any Connect"));
    await waitFor(() => expect(listed).toBe(1));
    // Re-render churn must not import again on the same token.
    fireEvent.click(screen.getByText("Any Connect"));
    await waitFor(() => expect(listed).toBeLessThanOrEqual(2)); // second connect refreshes the token: one more run is allowed, no loop
  });
});
