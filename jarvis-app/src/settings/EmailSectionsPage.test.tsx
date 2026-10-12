// @vitest-environment jsdom
// EMAIL SECTIONS SETTINGS (2026-10-12, Email v1 spec 2.7 and 3.2): the list of section moves made on the Email tab, each
// with Put Back, and no rules builder. Every case runs with fetch trapped: nothing here reaches a model or Gmail.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter } from "@core";
import { NotesProvider } from "../data/NotesProvider";
import { AppearanceProvider } from "../appearance/AppearanceProvider";
import { AuthProvider } from "../auth/AuthProvider";
import { ProfileService } from "../profile/ProfileService";
import MoreFlow from "../more/MoreFlow";
import SettingsPage from "../more/SettingsPage";
import { extrasFor } from "../shell/destinations";
import { newSectionId, type EmailSection } from "../messages/emailSections";
import { loadOverrides, moveToSection, recordMove } from "../email/sections";
import { saveSnapshot } from "../email/deviceCache";
import type { InboxRow } from "../email/emailClient";
import EmailSectionsPage, { MOVES_FOOT, NO_MOVES_SUB, NO_MOVES_TITLE, OPEN_EMAIL, PUT_BACK, putBackDone } from "./EmailSectionsPage";

const showToast = vi.fn();
vi.mock("../shared/toast", () => ({ showToast: (...a: unknown[]) => showToast(...a) }));
const fetchTrap = vi.fn();

beforeEach(() => { showToast.mockReset(); fetchTrap.mockReset(); vi.stubGlobal("fetch", fetchTrap); try { localStorage.clear(); } catch { /* ignore */ } });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const row = (o: Partial<InboxRow>): InboxRow => ({
  id: "m1", account_id: "a1", account: "dave@example.test", provider_id: "p1", thread_id: "t1", internal_date: "2026-10-03T14:00:00Z",
  from_address: "billing@conedison.test", from_name: "Con Edison", subject: "Your October Bill", snippet: "", has_body: false,
  attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "h", read: true, ...o,
});
const uid = () => "u-moves-" + Math.random().toString(36).slice(2);
const page = (userId: string, extra: Record<string, unknown> = {}) => render(<NotesProvider userId={userId}><EmailSectionsPage onBack={() => {}} userId={userId} {...extra} /></NotesProvider>);

describe("Email Sections: the moves, each with Put Back", () => {
  it("with no moves: a glyph, the words, and Open Email, the door to where a move is made; no rules builder anywhere", () => {
    const onOpenEmail = vi.fn();
    const { container } = page(uid(), { onOpenEmail });
    expect(screen.getByText(NO_MOVES_TITLE)).toBeInTheDocument();
    expect(screen.getByText(NO_MOVES_SUB)).toBeInTheDocument();
    expect(container.querySelector(".empty-state .empty-icon")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: OPEN_EMAIL }));
    expect(onOpenEmail).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Add Section" })).toBeNull();
    expect(screen.queryByLabelText("Section Name")).toBeNull();
  });

  it("lists every move, newest first: the subject, then the section it is in and the sender as facts", () => {
    const user = uid();
    recordMove(user, row({ id: "m1" }), "money", new Date("2026-10-10T09:00:00Z"));
    recordMove(user, row({ id: "m2", subject: "Team Lunch", from_name: "Ada", from_address: "ada@x.test" }), "conversations", new Date("2026-10-11T09:00:00Z"));
    const { container } = page(user);
    const rows = [...container.querySelectorAll(".set-row")];
    expect(rows.map((r) => r.querySelector(".conn-name")!.textContent)).toEqual(["Team Lunch", "Your October Bill"]);
    const facts = [...rows[1]!.querySelectorAll(".conn-meta .fact")];
    expect(facts.map((f) => f.textContent)).toEqual(["In Money", "Con Edison"]);
    expect(facts[0]).toHaveClass("date");
    // One grey per row: the sender. No typed dot.
    expect(rows[1]!.querySelectorAll(".conn-meta .fact:not(.date)")).toHaveLength(1);
    expect(rows[1]!.querySelector(".conn-meta")!.textContent).not.toContain("·");
    expect(screen.getByText(MOVES_FOOT)).toBeInTheDocument();
  });

  it("Put Back returns the message to its own section, says so, and Undo moves it again", () => {
    const user = uid();
    recordMove(user, row({ id: "m1" }), "money", new Date("2026-10-10T09:00:00Z"));
    page(user);
    fireEvent.click(screen.getByText("Your October Bill"));
    const sheet = document.querySelector(".sheet-scrim") as HTMLElement;
    fireEvent.click(within(sheet).getByRole("button", { name: PUT_BACK }));
    expect(loadOverrides(user)).toEqual({});
    expect(screen.getByText(NO_MOVES_TITLE)).toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ message: putBackDone("Your October Bill"), actionLabel: "Undo" }));
    act(() => { (showToast.mock.calls[0]![0] as { onAction: () => void }).onAction(); });
    expect(loadOverrides(user)).toEqual({ m1: "money" });
    expect(screen.getByText("Your October Bill")).toBeInTheDocument();
  });

  it("a move made before its words were kept is named from the saved inbox, or as a moved message", () => {
    const user = uid();
    moveToSection(user, "m1", "lists");
    moveToSection(user, "gone", "other");
    saveSnapshot(user, { accounts: [], rows: [row({ id: "m1", subject: "Weekly Digest", from_name: "News" })] });
    const { container } = page(user);
    const names = [...container.querySelectorAll(".set-row .conn-name")].map((n) => n.textContent);
    expect(names).toContain("Weekly Digest");
    expect(names).toContain("A Moved Message");
    expect(fetchTrap).not.toHaveBeenCalled();
  });
});

describe("Email Sections: the old filters' data stays for the Messages screen", () => {
  const sec = (name: string): EmailSection => ({ id: newSectionId(), name, matchers: [{ field: "sender", text: "marco" }] });
  it("belong to one user's profile and no other's", async () => {
    const store = new Store(new InMemoryAdapter());
    await new ProfileService(store, "u1").save({ name: "A", emailSections: [sec("Mine")] });
    expect(await new ProfileService(store, "u2").get()).toBeNull();
    await new ProfileService(store, "u2").save({ name: "B" });
    expect((await new ProfileService(store, "u2").get())?.emailSections).toBeUndefined();
    expect((await new ProfileService(store, "u1").get())?.emailSections).toHaveLength(1);
  });

  it("Settings lists Email Sections and it opens through More, to the moves", async () => {
    const onNavigate = vi.fn();
    const { unmount } = render(<SettingsPage onNavigate={onNavigate} onBack={() => {}} />);
    fireEvent.click(screen.getByText("Email Sections"));
    expect(onNavigate).toHaveBeenCalledWith("emailsections");
    unmount();
    const onOpenExtra = vi.fn();
    render(
      <AppearanceProvider><AuthProvider><NotesProvider userId="u-sections-route">
        <MoreFlow extras={extrasFor(["today", "tasks", "schedule", "brain"])} onOpenExtra={onOpenExtra} tabKeys={["today", "tasks", "schedule", "brain"]}
          onToggleTab={() => {}} openRoute="emailsections" />
      </NotesProvider></AuthProvider></AppearanceProvider>,
    );
    expect(await screen.findByText(NO_MOVES_TITLE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: OPEN_EMAIL }));
    await waitFor(() => expect(onOpenExtra).toHaveBeenCalledWith("messages"));
  });
});
