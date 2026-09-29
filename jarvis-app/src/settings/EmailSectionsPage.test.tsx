// @vitest-environment jsdom
// EMAIL SECTIONS SETTINGS (2026-09-29): a plain editable list of local filters.
// Every case runs with fetch trapped: making or changing a section never
// reaches a model or Gmail.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter } from "@core";
import { NotesProvider, useProfile } from "../data/NotesProvider";
import { AppearanceProvider } from "../appearance/AppearanceProvider";
import { AuthProvider } from "../auth/AuthProvider";
import { ProfileService } from "../profile/ProfileService";
import MoreFlow from "../more/MoreFlow";
import SettingsPage from "../more/SettingsPage";
import { extrasFor } from "../shell/destinations";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";
import { SECTION_ERRORS, newSectionId, type EmailSection } from "../messages/emailSections";
import EmailSectionsPage from "./EmailSectionsPage";

const showToast = vi.fn();
vi.mock("../shared/toast", () => ({ showToast: (...a: unknown[]) => showToast(...a) }));

let profileRef: ProfileService | null = null;
function Grab() { profileRef = useProfile(); return null; }
const fetchTrap = vi.fn();

beforeEach(() => { showToast.mockReset(); fetchTrap.mockReset(); vi.stubGlobal("fetch", fetchTrap); profileRef = null; });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const sec = (name: string, text = "marco", field: "sender" | "subject" = "sender"): EmailSection => ({ id: newSectionId(), name, matchers: [{ field, text }] });

async function openPage(seed: EmailSection[] = [], extra: Record<string, unknown> = {}) {
  const user = "u-sections-" + Math.random().toString(36).slice(2);
  const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
  await waitFor(() => expect(profileRef).toBeTruthy());
  await profileRef!.save({ name: "Alex", ...(seed.length ? { emailSections: seed } : {}), ...extra });
  view.rerender(<NotesProvider userId={user}><Grab /><EmailSectionsPage onBack={() => {}} /></NotesProvider>);
  await screen.findByRole("heading", { name: /Email Sections/i, level: 1 }).catch(() => screen.findAllByText("Email Sections"));
  return { user, view };
}
const saved = async () => (await profileRef!.get())?.emailSections;
const nameBox = () => screen.getByLabelText("Section Name") as HTMLInputElement;
const textBox = (n = 1) => screen.getByLabelText(`Text to Match ${n}`) as HTMLInputElement;
const type = (el: HTMLElement, v: string) => fireEvent.change(el, { target: { value: v } });
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

describe("Email Sections page: add, edit, delete", () => {
  it("starts empty with an Add Section door, and offers no example sections", async () => {
    await openPage();
    expect(await screen.findByText("No Sections Yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Section" })).toBeInTheDocument();
    expect(await saved()).toBeUndefined();
  });

  it("adds a section, saves it on the profile as a field patch, and lists it", async () => {
    await openPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add Section" }));
    type(nameBox(), "  Team Mail  ");
    type(textBox(), "  marco  ");
    const spy = vi.spyOn(profileRef!, "save");
    press("Save Section");
    await waitFor(async () => expect(await saved()).toHaveLength(1));
    const got = (await saved())![0]!;
    expect(got).toMatchObject({ name: "Team Mail", matchers: [{ field: "sender", text: "marco" }] });
    expect(got.id).toMatch(/^sec_/);
    // A field patch: only emailSections rides the write, nothing else, and the
    // profile it merged into is intact. The legacy mail object is untouched.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(Object.keys(spy.mock.calls[0]![0])).toEqual(["emailSections"]);
    const p = await profileRef!.get();
    expect(p?.name).toBe("Alex");
    expect(p?.mail).toBeUndefined();
    expect(await screen.findByText("Team Mail")).toBeInTheDocument();
    expect(screen.queryByLabelText("Section Name")).toBeNull();
    expect(fetchTrap).not.toHaveBeenCalled();
  });

  it("sets a matcher's kind from the menu and can hold several matchers", async () => {
    await openPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add Section" }));
    type(nameBox(), "Forms");
    fireEvent.click(screen.getByLabelText("Match Type 1"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Subject or Preview Contains" }));
    type(textBox(), "waiver");
    press("Add Matcher");
    type(textBox(2), "permission slip");
    press("Save Section");
    await waitFor(async () => expect(await saved()).toHaveLength(1));
    expect((await saved())![0]!.matchers).toEqual([
      { field: "subject", text: "waiver" },
      { field: "sender", text: "permission slip" },
    ]);
  });

  it("edits a section in place and keeps its id", async () => {
    const s = sec("Team Mail");
    await openPage([s]);
    fireEvent.click(await screen.findByText("Team Mail"));
    expect(nameBox().value).toBe("Team Mail");
    type(nameBox(), "Crew");
    type(textBox(), "rossi");
    press("Save Section");
    await waitFor(async () => expect((await saved())![0]!.name).toBe("Crew"));
    expect(await saved()).toEqual([{ id: s.id, name: "Crew", matchers: [{ field: "sender", text: "rossi" }] }]);
  });

  it("deletes with an Undo that puts it back in the same place, same id", async () => {
    const [a, b, c] = [sec("Alpha", "a"), sec("Beta", "b"), sec("Gamma", "c")];
    await openPage([a, b, c]);
    fireEvent.click(await screen.findByText("Beta"));
    press("Delete Section");
    await waitFor(async () => expect((await saved())!.map((s) => s.name)).toEqual(["Alpha", "Gamma"]));
    expect(screen.queryByText("Beta")).toBeNull();
    const toast = showToast.mock.calls.map((c) => c[0] as { message: string; actionLabel?: string; onAction?: () => void }).find((t) => t.actionLabel === "Undo")!;
    expect(toast.message).toMatch(/^Section Deleted/);
    await act(async () => { toast.onAction!(); await new Promise((r) => setTimeout(r, 30)); });
    expect(await saved()).toEqual([a, b, c]);
    expect(await screen.findByText("Beta")).toBeInTheDocument();
    expect(fetchTrap).not.toHaveBeenCalled();
  });

  it("Cancel leaves the list and the profile as they were", async () => {
    await openPage([sec("Team Mail")]);
    fireEvent.click(await screen.findByText("Team Mail"));
    type(nameBox(), "Something Else");
    press("Cancel");
    expect(screen.queryByLabelText("Section Name")).toBeNull();
    expect(screen.getByText("Team Mail")).toBeInTheDocument();
    expect((await saved())![0]!.name).toBe("Team Mail");
  });
});

describe("Email Sections page: errors are shown, never fixed silently", () => {
  const openNew = async (seed: EmailSection[] = []) => {
    await openPage(seed);
    fireEvent.click(await screen.findByRole("button", { name: "Add Section" }));
  };
  it("waits to call an empty field wrong until the first Save, then says which", async () => {
    await openNew();
    expect(screen.queryByText(SECTION_ERRORS.nameEmpty)).toBeNull();
    press("Save Section");
    expect(await screen.findByText(SECTION_ERRORS.nameEmpty)).toBeInTheDocument();
    expect(screen.getByText(SECTION_ERRORS.matcherEmpty)).toBeInTheDocument();
    expect(await saved()).toBeUndefined();
  });
  it("a name over 60 characters is an error at once, and nothing is cut", async () => {
    await openNew();
    const long = "n".repeat(61);
    type(nameBox(), long);
    expect(screen.getByText(SECTION_ERRORS.nameLong)).toBeInTheDocument();
    expect(nameBox().value).toBe(long);
    type(textBox(), "marco");
    press("Save Section");
    await waitFor(() => expect(screen.getByText(SECTION_ERRORS.nameLong)).toBeInTheDocument());
    expect(await saved()).toBeUndefined();
    type(nameBox(), "n".repeat(60));
    expect(screen.queryByText(SECTION_ERRORS.nameLong)).toBeNull();
  });
  it("a matcher over 200 characters is an error at once, and nothing is cut", async () => {
    await openNew();
    const long = "m".repeat(201);
    type(nameBox(), "Long");
    type(textBox(), long);
    expect(screen.getByText(SECTION_ERRORS.matcherLong)).toBeInTheDocument();
    expect(textBox().value).toBe(long);
    press("Save Section");
    expect(await saved()).toBeUndefined();
  });
  it("names are unique after case folding", async () => {
    await openNew([sec("Team Mail")]);
    type(nameBox(), "  TEAM mail ");
    type(textBox(), "x");
    press("Save Section");
    expect(await screen.findByText(SECTION_ERRORS.nameTaken)).toBeInTheDocument();
    expect(await saved()).toHaveLength(1);
  });
  it("removing every matcher is an error, not a section that matches nothing", async () => {
    await openNew();
    type(nameBox(), "Empty");
    press("Remove Matcher 1");
    press("Save Section");
    expect(await screen.findByText(SECTION_ERRORS.noMatchers)).toBeInTheDocument();
    expect(await saved()).toBeUndefined();
  });
  it("more than 50 matchers is an error", async () => {
    await openNew();
    type(nameBox(), "Many");
    type(textBox(), "m0");
    for (let i = 1; i < 51; i++) { press("Add Matcher"); type(textBox(i + 1), "m" + i); }
    expect(screen.getByText(SECTION_ERRORS.tooManyMatchers)).toBeInTheDocument();
    press("Save Section");
    expect(await saved()).toBeUndefined();
  });
  it("at 50 sections a new one is refused with a visible error", async () => {
    const fifty = Array.from({ length: 50 }, (_, i) => sec("S" + i, "t" + i));
    await openPage(fifty);
    fireEvent.click(await screen.findByRole("button", { name: "Add Section" }));
    expect(await screen.findByText(SECTION_ERRORS.tooManySections)).toBeInTheDocument();
    expect(screen.queryByLabelText("Section Name")).toBeNull();
  });
});

describe("Email Sections page: the write is the truth", () => {
  it("a failed save keeps the editor open with every edit, changes no list, and a retry lands", async () => {
    await openPage([sec("Team Mail")]);
    fireEvent.click(await screen.findByText("Team Mail"));
    type(nameBox(), "Crew");
    type(textBox(), "rossi");
    vi.spyOn(profileRef!, "save").mockRejectedValueOnce(new Error("offline"));
    press("Save Section");
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ message: WRITE_FAILED_MESSAGE }));
    expect(nameBox().value).toBe("Crew");
    expect(textBox().value).toBe("rossi");
    expect((await saved())![0]!.name).toBe("Team Mail");
    press("Save Section");
    await waitFor(async () => expect((await saved())![0]!.name).toBe("Crew"));
  });
  it("a failed delete leaves the section in the list and offers no Undo", async () => {
    await openPage([sec("Team Mail")]);
    fireEvent.click(await screen.findByText("Team Mail"));
    vi.spyOn(profileRef!, "save").mockRejectedValueOnce(new Error("offline"));
    press("Delete Section");
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ message: WRITE_FAILED_MESSAGE }));
    expect(showToast.mock.calls.some((c) => (c[0] as { actionLabel?: string }).actionLabel === "Undo")).toBe(false);
    expect((await saved())).toHaveLength(1);
  });
  it("says so when the write is queued on this phone and not yet on the server", async () => {
    await openPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add Section" }));
    vi.spyOn(profileRef!, "pending").mockReturnValue(true);
    type(nameBox(), "Team");
    type(textBox(), "marco");
    press("Save Section");
    expect(await screen.findByText("Saved on This Phone · Will Sync")).toBeInTheDocument();
  });
});

describe("Email Sections: where they live", () => {
  it("belong to one user's profile and no other's", async () => {
    const store = new Store(new InMemoryAdapter());
    await new ProfileService(store, "u1").save({ name: "A", emailSections: [sec("Mine")] });
    expect(await new ProfileService(store, "u2").get()).toBeNull();
    await new ProfileService(store, "u2").save({ name: "B" });
    expect((await new ProfileService(store, "u2").get())?.emailSections).toBeUndefined();
    expect((await new ProfileService(store, "u1").get())?.emailSections).toHaveLength(1);
  });
  it("saving sections sends only that field and leaves a stale cached read of the rest alone", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new ProfileService(store, "u1");
    await svc.save({ name: "Alex", template: "student" });
    const spy = vi.spyOn(store, "update");
    const list = [sec("Mine")];
    await svc.save({ emailSections: list });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![2]).toEqual({ emailSections: list });
    expect(await svc.get()).toMatchObject({ name: "Alex", template: "student", emailSections: list });
  });
  it("Settings lists Email Sections and it opens through More", async () => {
    const onNavigate = vi.fn();
    const { unmount } = render(<SettingsPage onNavigate={onNavigate} onBack={() => {}} />);
    fireEvent.click(screen.getByText("Email Sections"));
    expect(onNavigate).toHaveBeenCalledWith("emailsections");
    unmount();
    render(
      <AppearanceProvider><AuthProvider><NotesProvider userId="u-sections-route">
        <MoreFlow extras={extrasFor(["today", "tasks", "schedule", "brain"])} onOpenExtra={() => {}} tabKeys={["today", "tasks", "schedule", "brain"]}
          onToggleTab={() => {}} openRoute="emailsections" />
      </NotesProvider></AuthProvider></AppearanceProvider>,
    );
    expect(await screen.findByText("No Sections Yet")).toBeInTheDocument();
  });
});
