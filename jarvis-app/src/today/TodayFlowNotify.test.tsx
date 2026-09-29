// @vitest-environment jsdom
// Notification actions on Today, through the real TodayFlow: the labels, the
// tap, the receipt, and what each one actually did.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useSchedule } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { setCategoryRegistry } from "../shared/categories";
import type { AIService } from "../ai/AIService";
import type { ScheduleService } from "../schedule/ScheduleService";
import type { NotificationAction } from "../messages/mailContracts";
import { saveMailSnapshot, type MailSnapshot, type MailThread } from "../messages/home";
import { forgetAllCodes, rememberCode } from "../messages/notificationActions";
import { meetingFromCalendar } from "../messages/notificationActions";
import { bundleFor, calendarInvite, otp, CODE } from "../messages/notificationFixtures";
import TodayFlow from "./TodayFlow";

const showToast = vi.fn();
vi.mock("../shared/toast", () => ({ showToast: (...a: unknown[]) => showToast(...a), hideToast: () => {} }));
vi.mock("../ai/useAI", () => ({ useAI: () => ({ available: false } as unknown as AIService) }));
vi.mock("../people/MessageDraftSheet", () => ({ default: () => null }));

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const USER = "today-notify-user";
const ACCOUNT = "me@x.com";
let sched: ScheduleService | null = null;
function Grab() { sched = useSchedule(); return null; }

function mount() {
  return render(
    <NotesProvider userId={USER}>
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
        <Grab />
        <TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} onGoEmail={onGoEmail} />
      </GoogleSessionProvider>
    </NotesProvider>,
  );
}
const onGoEmail = vi.fn();

const action = (kind: NotificationAction["kind"], over: Partial<NotificationAction> = {}): NotificationAction => ({
  kind, evidence: { sourceMessageId: "m", sourceRevision: "m" }, ...over,
});
const note = (id: string, a: NotificationAction | undefined, over: Partial<MailThread> = {}): MailThread => ({
  id, from: "Sender " + id, fromEmail: "no-reply@sender" + id + ".com", subject: "Subject " + id, gist: "Gist " + id,
  account: ACCOUNT, lastMsgId: "m" + id, revision: "m" + id, noReply: true, ...(a ? { action: a } : {}), ...over,
});
const save = (over: Partial<MailSnapshot>) =>
  saveMailSnapshot({ ts: Date.now(), owner: USER, needsYou: 0, threads: [], waiting: [], promises: [], actionable: [], ...over });

const SIGN_URL = "https://na3.docusign.net/Signing/EmailStart.aspx?a=abc&er=def";
const receipts = () => showToast.mock.calls.map((c) => (c[0] as { message: string }).message);

beforeEach(() => {
  showToast.mockReset(); onGoEmail.mockReset(); localStorage.clear(); forgetAllCodes(); sched = null;
  setCategoryRegistry([]);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => {}) }, configurable: true });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("Today: notification labels and no Write Back", () => {
  it("shows the action's own button, View Email for a no-reply thread, and never Write Back", async () => {
    save({
      needsYou: 1,
      threads: [{ id: "t1", from: "Acme", fromEmail: "no-reply@acme.com", subject: "Your statement is ready", gist: "Statement ready", account: ACCOUNT, lastMsgId: "m1", revision: "m1", noReply: true }],
      actionable: [note("s", action("sign", { url: SIGN_URL })), note("c", action("copy_code", { expiresAt: new Date(Date.now() + 600_000).toISOString() }), { from: "Acme Login" })],
    });
    mount();
    expect(await screen.findByText("Sign")).toBeInTheDocument();
    expect(screen.getByText("Copy Code")).toBeInTheDocument();
    expect(screen.getByText("View Email")).toBeInTheDocument();
    expect(screen.queryByText("Write Back")).toBeNull();
    expect(screen.queryByText("Reply")).toBeNull();
  });
});

describe("Today: the taps", () => {
  it("Sign opens the exact signing URL and says only that the page opened", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    save({ actionable: [note("s", action("sign", { url: SIGN_URL }))] });
    mount();
    fireEvent.click(await screen.findByText("Sign"));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0]).toBe(SIGN_URL);
    await waitFor(() => expect(receipts()).toContain("Opened the signing page."));
    expect(screen.getByText("Sign")).toBeInTheDocument();
  });

  it("a blocked tab says so and offers the exact link", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    save({ actionable: [note("s", action("sign", { url: SIGN_URL }))] });
    mount();
    fireEvent.click(await screen.findByText("Sign"));
    await waitFor(() => expect(receipts()).toContain("Your Browser Blocked That Tab"));
    const write = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
    fireEvent.click(await screen.findByText("Copy Link"));
    await waitFor(() => expect(write).toHaveBeenCalledWith(SIGN_URL));
  });

  it("Copy Code copies the code with its leading zeroes and says Code copied only after the clipboard accepted it", async () => {
    const b = bundleFor(otp);
    rememberCode({ userId: USER, account: ACCOUNT, messageId: "m" }, b.codes[0]!);
    const write = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
    let accepted = false;
    write.mockImplementation(async () => { await Promise.resolve(); accepted = true; });
    save({ actionable: [note("c", action("copy_code", { expiresAt: new Date(Date.now() + 600_000).toISOString() }))] });
    mount();
    fireEvent.click(await screen.findByText("Copy Code"));
    expect(write).toHaveBeenCalledWith("004291");
    expect(receipts()).not.toContain("Code copied"); // not before the write resolved
    await waitFor(() => expect(receipts()).toContain("Code copied"));
    expect(accepted).toBe(true);
    await waitFor(() => expect(screen.queryByText("Copy Code")).toBeNull());
  });

  it("a clipboard that refuses never says Code copied, and the notice stays", async () => {
    rememberCode({ userId: USER, account: ACCOUNT, messageId: "m" }, CODE);
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("NotAllowedError"));
    save({ actionable: [note("c", action("copy_code", { expiresAt: new Date(Date.now() + 600_000).toISOString() }))] });
    mount();
    fireEvent.click(await screen.findByText("Copy Code"));
    await waitFor(() => expect(receipts().some((m) => /Couldn't Copy/.test(m))).toBe(true));
    expect(receipts()).not.toContain("Code copied");
    expect(screen.getByText("Copy Code")).toBeInTheDocument();
    expect(onGoEmail).toHaveBeenCalledWith("c");
  });

  it("Accept opens the invitation and adds the event once, however many times it is tapped or seen", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    const meeting = meetingFromCalendar(bundleFor(calendarInvite))!;
    const inviteUrl = "https://calendar.google.com/calendar/event?action=RESPOND&eid=EID1&rst=1&tok=T";
    save({ actionable: [note("i", action("accept_invite", { url: inviteUrl, meeting }), { from: "Coach Ana", account: ACCOUNT })] });
    mount();
    fireEvent.click(await screen.findByText("Accept"));
    await waitFor(() => expect(receipts()).toContain("Opened · Added to Jarvis · RSVP not confirmed"));
    expect(open.mock.calls[0]![0]).toBe(inviteUrl);
    await waitFor(async () => expect((await sched!.listEvents()).filter((e) => e.data.title === "Practice Plan")).toHaveLength(1));
    // Tapped again (the notice stays: an opened page is not an accepted invitation).
    fireEvent.click(screen.getByText("Accept"));
    await waitFor(() => expect(receipts()).toContain("Opened · Already on Jarvis · RSVP not confirmed"));
    expect((await sched!.listEvents()).filter((e) => e.data.title === "Practice Plan")).toHaveLength(1);
    expect(receipts().some((m) => /accepted/i.test(m))).toBe(false);
  });

  it("an invite's Accept and a sender's proposed time are two different buttons", async () => {
    vi.spyOn(window, "open").mockReturnValue({} as Window);
    const meeting = meetingFromCalendar(bundleFor(calendarInvite))!;
    save({
      actionable: [note("i", action("accept_invite", { url: "https://calendar.google.com/calendar/event?action=VIEW&eid=1", meeting }), { from: "Coach Ana" })],
      meetings: [{ threadId: "mt", from: "Sam", label: "3pm Friday", date: "2026-10-09", start: "15:00", end: "15:30", line: "Sam offered Friday at 3 PM" }],
    });
    mount();
    expect(await screen.findByText("Take 3:00 PM")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Accept"));
    await waitFor(() => expect(receipts()).toContain("Opened · Added to Jarvis · RSVP not confirmed"));
    const titles = (await sched!.listEvents()).map((e) => e.data.title);
    expect(titles).toContain("Practice Plan");
    expect(titles.some((t) => t.startsWith("Call With"))).toBe(false);
  });

  it("Add to Schedule with two legs opens the thread and writes nothing", async () => {
    save({ actionable: [note("f", action("add_travel"), { from: "Delta" })] });
    mount();
    fireEvent.click(await screen.findByText("Add to Schedule"));
    await waitFor(() => expect(onGoEmail).toHaveBeenCalledWith("f"));
    expect(await sched!.listEvents()).toHaveLength(0);
  });

  it("Unsubscribe by web opens the page and never says unsubscribed", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    save({ actionable: [note("n", action("unsubscribe", { unsubscribe: { kind: "http", target: "https://trailweekly.com/u/123" } }), { from: "Trail Weekly", fromEmail: "news@trailweekly.com" })] });
    mount();
    fireEvent.click(await screen.findByText("Unsubscribe"));
    await waitFor(() => expect(receipts()).toContain("Opened unsubscribe page"));
    expect(open.mock.calls[0]![0]).toBe("https://trailweekly.com/u/123");
    expect(receipts().some((m) => /unsubscribed/i.test(m))).toBe(false);
    expect(JSON.parse(localStorage.getItem("jarvis.mail.unsub.v2") ?? "[]")).toEqual([
      expect.objectContaining({ sender: "news@trailweekly.com", via: "link", state: "opened", account: ACCOUNT }),
    ]);
  });

  it("Grant Access, Open, Track, Fill Out and Fix each open their own exact link", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    const links: [string, NotificationAction["kind"], string, string][] = [
      ["Grant Access", "grant_access", "https://docs.google.com/document/d/1/edit?usp=access_request", "Opened Google's access request."],
      ["Open", "open_share", "https://docs.google.com/spreadsheets/d/2/edit", "Opened."],
      ["Track", "track", "https://ups.com/track?x=1", "Opened tracking."],
      ["Fill Out", "fill_form", "https://docs.google.com/forms/d/e/3/viewform", "Opened the form."],
      ["Fix", "fix_payment", "https://netflix.com/billing", "Opened the payment page."],
    ];
    for (const [label, kind, url, receipt] of links) {
      open.mockClear();
      showToast.mockClear();
      save({ actionable: [note("1", action(kind, { url }), { from: "From " + kind })] });
      const { unmount } = mount();
      fireEvent.click(await screen.findByText(label));
      expect(open, label).toHaveBeenCalledTimes(1);
      expect(open.mock.calls[0]![0], label).toBe(url);
      await waitFor(() => expect(receipts()).toContain(receipt));
      unmount();
    }
  });
});

