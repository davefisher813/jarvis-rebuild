// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useCategories, useProfile } from "../data/NotesProvider";
import { ProfileService } from "../profile/ProfileService";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";
import ProfilePage from "./ProfilePage";
import AccountPage from "./AccountPage";
import { onProfileName } from "../profile/profileName";
import { AuthProvider } from "../auth/AuthProvider";

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

  // SHELL-F-14 (2026-09-05): Save latched to "Saved" whether or not the
  // write landed, so a failed rename read as a successful one.
  it("a name that could not be saved does not read as saved, and says so", async () => {
    renderPage("u-profile-failsave");
    vi.spyOn(ProfileService.prototype, "save").mockRejectedValue(new Error("network"));
    fireEvent.change(screen.getByPlaceholderText("Your Name"), { target: { value: "Dave" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ message: WRITE_FAILED_MESSAGE }));
    expect(screen.getByText("Save")).toBeInTheDocument();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("picking the template already selected does nothing", () => {
    renderPage("u-profile-noop");
    fireEvent.click(screen.getByRole("button", { name: "Template" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Personal" }));
    expect(showToast).not.toHaveBeenCalled();
  });
});

// EDIT PROFILE CHANGES THE NAME, AND THE NAME FOLLOWS (2026-10-04, Dave: "verify
// username change persists and shows everywhere the name appears"). The name is
// the profile's one display name: this page writes it, the Account card and
// Today's disc and greeting read it, so each is checked against the same saved
// record, and the mounted screens are told without a reload.
describe("ProfilePage Name (Edit Profile)", () => {
  it("saves the trimmed name on the profile record and says it is saved", async () => {
    renderPage("u-name-save");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Dave Fisher  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Saved" })).toBeInTheDocument());
    expect((await profileRef!.get())?.name).toBe("Dave Fisher");
  });

  it("tells every mounted screen the new name, once, and only when the write landed", async () => {
    const heard: string[] = [];
    const stop = onProfileName((n) => heard.push(n));
    renderPage("u-name-announce");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Dave F" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(heard).toEqual(["Dave F"]));
    stop();
  });

  it("a write that fails announces nothing and does not latch Saved", async () => {
    const heard: string[] = [];
    const stop = onProfileName((n) => heard.push(n));
    renderPage("u-name-fail");
    vi.spyOn(ProfileService.prototype, "save").mockRejectedValue(new Error("offline"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Dave F" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(heard).toEqual([]);
    expect(screen.queryByRole("button", { name: "Saved" })).not.toBeInTheDocument();
    stop();
  });

  it("persists: a later screen reads the saved name, and the Account card shows it with its initial", async () => {
    // One provider, two pages, the way More does it: Account opens Profile,
    // Profile goes back to Account, which reads the record afresh.
    function Route() {
      const [page, setPage] = useState<"profile" | "account">("profile");
      return page === "profile"
        ? <ProfilePage onBack={() => setPage("account")} />
        : <AccountPage onBack={() => {}} />;
    }
    render(
      <AuthProvider>
        <NotesProvider userId="u-name-persist">
          <Route />
        </NotesProvider>
      </AuthProvider>,
    );
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Mara Lin" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Saved" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(await screen.findByText("Mara Lin")).toBeInTheDocument();
    expect(document.querySelector(".account-av .av")?.textContent).toBe("M");
  });
});
