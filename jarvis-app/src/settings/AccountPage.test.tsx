// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useProfile } from "../data/NotesProvider";
import AccountPage from "./AccountPage";

// Redo Setup's window.confirm was replaced with an armed two-tap (audit
// 2026-08-07). What the confirm was protecting against is a stray tap; these
// tests pin that the protection survived the swap.

let profileSpy: { save: ReturnType<typeof vi.fn> } | null = null;
function SpyProfile() {
  const svc = useProfile();
  if (!profileSpy) {
    const save = vi.fn(svc.save.bind(svc));
    svc.save = save as typeof svc.save;
    profileSpy = { save };
  }
  return null;
}

const renderPage = () =>
  render(
    <NotesProvider userId="u-acct">
      <SpyProfile />
      <AccountPage onBack={() => {}} />
    </NotesProvider>,
  );

afterEach(() => { profileSpy = null; vi.useRealTimers(); });

describe("AccountPage Redo Setup (armed two-tap)", () => {
  it("one tap only arms: it says so, explains itself, and saves nothing", () => {
    renderPage();
    fireEvent.click(screen.getByText("Redo Setup"));
    expect(screen.getByText("Tap again to redo setup")).toBeInTheDocument();
    expect(screen.getByText(/Your data stays/)).toBeInTheDocument();
    expect(profileSpy!.save).not.toHaveBeenCalled();
  });

  it("disarms itself after a few seconds, so a stray tap never leaves a loaded button", () => {
    vi.useFakeTimers();
    renderPage();
    fireEvent.click(screen.getByText("Redo Setup"));
    expect(screen.getByText("Tap again to redo setup")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(4100); });
    expect(screen.getByText("Redo Setup")).toBeInTheDocument();
    expect(screen.queryByText("Tap again to redo setup")).not.toBeInTheDocument();
    expect(profileSpy!.save).not.toHaveBeenCalled();
  });
});
