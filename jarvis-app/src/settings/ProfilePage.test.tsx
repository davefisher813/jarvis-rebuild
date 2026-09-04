// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useCategories, useProfile } from "../data/NotesProvider";
import ProfilePage from "./ProfilePage";

// S3-Q20 (2026-09-04): "Changing template means redoing intake." Template
// used to be a dead read-only row here; the only path to change it was Redo
// Setup, the full ~15-tap onboarding walk, just to flip one choice.
// ProfilePage had no test file before this one.

const showToast = vi.fn();
vi.mock("../shared/toast", () => ({ showToast: (...a: unknown[]) => showToast(...a) }));

let categoriesRef: ReturnType<typeof useCategories> | null = null;
let profileRef: ReturnType<typeof useProfile> | null = null;
function Capture() {
  categoriesRef = useCategories();
  profileRef = useProfile();
  return null;
}

const renderPage = (userId: string) =>
  render(
    <NotesProvider userId={userId}>
      <Capture />
      <ProfilePage onBack={() => {}} />
    </NotesProvider>,
  );

beforeEach(() => { showToast.mockReset(); categoriesRef = null; profileRef = null; });
afterEach(() => { vi.restoreAllMocks(); });

describe("ProfilePage Template picker (S3-Q20)", () => {
  it("a fresh account has no starter areas yet, so picking a template seeds them and says so", async () => {
    renderPage("u-profile-fresh");
    fireEvent.click(screen.getByRole("button", { name: "Template" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Student" }));

    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    const msg = (showToast.mock.calls[0]![0] as { message: string }).message;
    expect(msg).toMatch(/^Switched to Student · Added \d+ starter areas?$/);

    // The change is real, not just the toast talking: the profile record
    // itself now carries the new template.
    await waitFor(async () => expect((await profileRef!.get())?.template).toBe("student"));
  });

  it("saves the template on its own, without touching the Name field or its Save button", async () => {
    renderPage("u-profile-independent");
    fireEvent.change(screen.getByPlaceholderText("Your Name"), { target: { value: "Dave" } });
    fireEvent.click(screen.getByRole("button", { name: "Template" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Business" }));

    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    // Name Save is still lit (unsaved), proving the template write went
    // through its own path, not gated behind that button.
    expect(screen.getByText("Save")).not.toBeDisabled();
    await waitFor(async () => expect((await profileRef!.get())?.template).toBe("business"));
    // Nothing named "Dave" was ever saved by the template pick alone.
    expect((await profileRef!.get())?.name ?? "").not.toBe("Dave");
  });

  it("an account with its own areas already keeps them: nothing is added, and the toast says so honestly", async () => {
    renderPage("u-profile-existing");
    await act(async () => { await categoriesRef!.create("My Own Area", "graphite"); });

    fireEvent.click(screen.getByRole("button", { name: "Template" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Student" }));

    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    expect((showToast.mock.calls[0]![0] as { message: string }).message).toBe("Switched to Student");
    // The existing area survives untouched -- seedDefaults only ever adds
    // when the account starts with none.
    const cats = await categoriesRef!.list();
    expect(cats.some((c) => c.data.name === "My Own Area")).toBe(true);
  });

  it("picking the template already selected does nothing", () => {
    renderPage("u-profile-noop");
    fireEvent.click(screen.getByRole("button", { name: "Template" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Personal" }));
    expect(showToast).not.toHaveBeenCalled();
  });
});
