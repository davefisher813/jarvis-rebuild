// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useProfile } from "../data/NotesProvider";
import { AuthProvider } from "../auth/AuthProvider";
import AccountPage from "./AccountPage";

// Redo Setup's window.confirm was replaced with an armed two-tap (audit
// 2026-08-07). What the confirm was protecting against is a stray tap; these
// tests pin that the protection survived the swap.
//
// S3-Q18 (2026-09-04) added two more destructive rows to this same screen --
// Sign Out (armed the same way Redo Setup already was) and Delete Account
// (new) -- so this file now wraps with the real AuthProvider (useAuth is
// called unconditionally by the component) and tests both.

// AccountPage's Delete Account row is gated on backendConfigured from
// data/store.ts, which is false in every test run (no Supabase env set).
// Spread the real module so NotesProvider's own imports from it (makeStore
// and friends) keep working, and only flip the one flag this page reads.
vi.mock("../data/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/store")>();
  return { ...actual, backendConfigured: true };
});

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

const renderPage = (onSignOut = () => {}) =>
  render(
    <AuthProvider>
      <NotesProvider userId="u-acct">
        <SpyProfile />
        <AccountPage onBack={() => {}} onSignOut={onSignOut} />
      </NotesProvider>
    </AuthProvider>,
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

describe("AccountPage Sign Out (S3-Q18: armed two-tap, same as Redo Setup)", () => {
  it("one tap only arms, and calls nothing", () => {
    const onSignOut = vi.fn();
    renderPage(onSignOut);
    fireEvent.click(screen.getByText("Sign Out"));
    expect(screen.getByText("Tap Again to Sign Out")).toBeInTheDocument();
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it("the second tap actually signs out", () => {
    const onSignOut = vi.fn();
    renderPage(onSignOut);
    fireEvent.click(screen.getByText("Sign Out"));
    fireEvent.click(screen.getByText("Tap Again to Sign Out"));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("disarms after a few seconds, so a stray second tap does nothing", () => {
    vi.useFakeTimers();
    const onSignOut = vi.fn();
    renderPage(onSignOut);
    fireEvent.click(screen.getByText("Sign Out"));
    act(() => { vi.advanceTimersByTime(4100); });
    expect(screen.getByText("Sign Out")).toBeInTheDocument();
    expect(onSignOut).not.toHaveBeenCalled();
  });
});

describe("AccountPage Delete Account (S3-Q18)", () => {
  it("renders when there is a real account, and warns of permanence once armed", () => {
    renderPage();
    expect(screen.getByText("Delete Account")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Delete Account"));
    expect(screen.getByText("Tap Again to Delete Account")).toBeInTheDocument();
    expect(screen.getByText(/Permanent/)).toBeInTheDocument();
  });

  // No Supabase env is set in tests, so the real AuthProvider's deleteAccount
  // throws "Auth backend not configured" -- exactly the honest-failure path
  // this item exists to add. It must surface as a real message, never a
  // silent success and never a hang.
  it("a real failure surfaces as a real message, never a silent success", async () => {
    renderPage();
    fireEvent.click(screen.getByText("Delete Account"));
    fireEvent.click(screen.getByText("Tap Again to Delete Account"));
    await waitFor(() => expect(screen.getByText(/Auth backend not configured/)).toBeInTheDocument());
    // Back to the unarmed label, not stuck on "Deleting...".
    expect(screen.getByText("Delete Account")).toBeInTheDocument();
  });

  it("disarms after a few seconds without a second tap", () => {
    vi.useFakeTimers();
    renderPage();
    fireEvent.click(screen.getByText("Delete Account"));
    act(() => { vi.advanceTimersByTime(4100); });
    expect(screen.getByText("Delete Account")).toBeInTheDocument();
    expect(screen.queryByText("Tap Again to Delete Account")).not.toBeInTheDocument();
  });
});
