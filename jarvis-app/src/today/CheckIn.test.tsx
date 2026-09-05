// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useProfile } from "../data/NotesProvider";
import type { ProfileService } from "../profile/ProfileService";
import { subscribeToast } from "../shared/toast";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";
import CheckIn from "./CheckIn";

// TODAY-F-13 (2026-09-05): the evening check-in was the one component on
// Today whose writes did not go through the guard, so a mood answered on a
// dead connection vanished with no toast, no "Noted" line, and the card still
// standing. Tomorrow's plan is sized from that answer, so a save that fails
// quietly is a day that never gets lighter and never says why.

let profRef: ProfileService | null = null;
function Seed() {
  profRef = useProfile();
  return <CheckIn />;
}

const evening = () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 5, 19, 30));
};

describe("CheckIn write guard", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("a mood that failed to save says so, and the card stays", async () => {
    evening();
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    try {
      render(<NotesProvider userId="u-checkin-f13a"><Seed /></NotesProvider>);
      const chip = await screen.findByText("Underwater");
      profRef!.save = () => Promise.reject(new Error("offline"));
      fireEvent.click(chip);
      await waitFor(() => expect(seen).toContain(WRITE_FAILED_MESSAGE));
      expect(screen.queryByText(/^Noted/)).not.toBeInTheDocument();
      expect(screen.getByText("Underwater")).toBeInTheDocument();
    } finally {
      stop();
    }
  });

  it("a mood that saved is confirmed and the card stands down", async () => {
    evening();
    render(<NotesProvider userId="u-checkin-f13b"><Seed /></NotesProvider>);
    fireEvent.click(await screen.findByText("Underwater"));
    await waitFor(() => expect(screen.getByText(/^Noted/)).toBeInTheDocument());
    expect((await profRef!.get())?.checkin?.["2026-09-05"]?.mood).toBe("under");
  });
});
