// @vitest-environment jsdom
// SHELL-F-13 (2026-09-05): a failed profile read at launch was a blank
// screen with no way out. AppGate's isOnboarded() had no catch, so the state
// stayed "loading" (null), and the splash's own safety net faded into black.
// These prove the failure lands on a card with a working Try Again, and that
// the splash is dismissed so the card can be seen.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "./data/NotesProvider";
import { ProfileService } from "./profile/ProfileService";
import { AppGate } from "./App";

vi.mock("./onboarding/OnboardingFlow", () => ({ default: () => <div>Onboarding Here</div> }));
vi.mock("./shell/AppShell", () => ({ default: () => <div>App Shell Here</div> }));
const captureError = vi.fn();
vi.mock("./monitoring/monitor", () => ({ captureError: (...a: unknown[]) => captureError(...a) }));

beforeEach(() => {
  captureError.mockReset();
  const splash = document.createElement("div");
  splash.id = "splash";
  document.body.appendChild(splash);
});
afterEach(() => {
  vi.restoreAllMocks();
  document.getElementById("splash")?.remove();
});

describe("AppGate when the profile read fails (SHELL-F-13)", () => {
  it("shows the recoverable card, dismisses the splash, and Try Again re-runs the read", async () => {
    vi.spyOn(ProfileService.prototype, "isOnboarded").mockRejectedValueOnce(new Error("no signal"));
    render(
      <NotesProvider userId="u-gate-fail">
        <AppGate />
      </NotesProvider>,
    );
    await waitFor(() => expect(screen.getByText("Something Went Wrong")).toBeInTheDocument());
    expect(screen.getByText("Couldn't reach your profile · Check your connection")).toBeInTheDocument();
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(document.getElementById("splash")!.style.opacity).toBe("0");

    // Signal is back: the same read now answers, and the gate moves on.
    fireEvent.click(screen.getByText("Try Again"));
    await waitFor(() => expect(screen.getByText("Onboarding Here")).toBeInTheDocument());
    expect(screen.queryByText("Something Went Wrong")).not.toBeInTheDocument();
  });

  it("a read that answers goes straight to onboarding or the app, no card", async () => {
    render(
      <NotesProvider userId="u-gate-ok">
        <AppGate />
      </NotesProvider>,
    );
    await waitFor(() => expect(screen.getByText("Onboarding Here")).toBeInTheDocument());
    expect(screen.queryByText("Something Went Wrong")).not.toBeInTheDocument();
    expect(captureError).not.toHaveBeenCalled();
  });
});
