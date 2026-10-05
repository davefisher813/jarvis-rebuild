// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import MailNotices from "./MailNotices";
import { saveMailSnapshot, type MailNotice, type MailSnapshot, type MailThread } from "../messages/home";
import { ACTION_LABEL } from "../messages/notificationActions";
import type { NotificationAction } from "../messages/mailContracts";
import type { MailActionResult } from "../messages/executeMailAction";
import { subscribeToast, hideToast, type ToastState } from "../shared/toast";

const TODAY = "2026-09-29";

const snap = (over: Partial<MailSnapshot> = {}): MailSnapshot => ({
  ts: Date.now(), owner: "u1", needsYou: 0, threads: [], waiting: [], promises: [], actionable: [], ...over,
});
const act1 = (kind: NotificationAction["kind"], url?: string, over: Partial<NotificationAction> = {}): NotificationAction => ({
  kind, evidence: { sourceMessageId: "m", sourceRevision: "m" }, ...(url ? { url } : {}), ...over,
});
const note = (id: string, action: NotificationAction | undefined, over: Partial<MailThread> = {}): MailThread => ({
  id, from: "Sender " + id, fromEmail: "no-reply@sender" + id + ".com", subject: "Subject " + id, gist: "Gist " + id,
  account: "me@x.com", lastMsgId: "m" + id, revision: "m" + id, noReply: true, ...(action ? { action } : {}), ...over,
});
const person = (id: string, over: Partial<MailThread> = {}): MailThread => ({
  id, from: "Nadia Brandt", fromEmail: "nadia@northlake.org", subject: "invoice attached", gist: "Wants the invoice signed",
  account: "me@x.com", lastMsgId: "m" + id, revision: "m" + id, snippet: "Can you sign it?", replies: ["Thanks", "Got it", "Will do"], ...over,
});

const URLS: Record<NotificationAction["kind"], string | undefined> = {
  grant_access: "https://docs.google.com/document/d/1/edit", open_share: "https://docs.google.com/document/d/2/edit",
  accept_invite: "https://calendar.google.com/calendar/event?action=VIEW&eid=1", sign: "https://na3.docusign.net/Signing/x",
  track: "https://ups.com/track?x=1", add_travel: undefined, fill_form: "https://docs.google.com/forms/d/e/1/viewform",
  fix_payment: "https://netflix.com/billing", copy_code: undefined, unsubscribe: undefined,
};

let toasts: ToastState[] = [];
let unsub: () => void;
beforeEach(() => { localStorage.clear(); hideToast(); toasts = []; unsub = subscribeToast((t) => { if (t) toasts.push(t); }); });
afterEach(() => { unsub(); vi.restoreAllMocks(); });

const done = (over: Partial<MailActionResult> = {}): MailActionResult => ({ status: "opened", message: "Opened.", settled: false, ...over });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("MailNotices: the labels", () => {
  it("shows the exact label for every kind, and View Email for a notice with no action", () => {
    const actionable = (Object.keys(ACTION_LABEL) as NotificationAction["kind"][]).map((k, i) =>
      note(String(i), act1(k, URLS[k], k === "unsubscribe" ? { unsubscribe: { kind: "mailto", target: "unsub@sender.com" } } : {})));
    saveMailSnapshot(snap({ actionable: [...actionable, note("v", undefined, { viewUntil: Date.now() + 60_000 })] }));
    render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} max={20} />);
    for (const label of Object.values(ACTION_LABEL)) expect(screen.getAllByText(label).length, label).toBeGreaterThan(0);
    expect(screen.getByText("View Email")).toBeInTheDocument();
  });

  it("offers no Write Back and no reply chip on a no-reply or specialised notice, even with writing wired up", () => {
    saveMailSnapshot(snap({
      needsYou: 2,
      threads: [person("1", { fromEmail: "no-reply@acme.com", from: "Acme", subject: "Your statement", gist: "Statement ready" }), person("2", { fromEmail: "dse@docusign.net", from: "DocuSign", subject: "Please sign", gist: "Lease", action: act1("sign", URLS.sign) })],
      actionable: [note("3", act1("track", URLS.track))],
    }));
    render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} onDraft={async () => "Yes"} onSend={async () => "id"} onNotificationAction={async () => done()} max={10} />);
    expect(screen.queryByText("Write Back")).toBeNull();
    expect(screen.queryByText("Reply")).toBeNull();
    for (const chip of ["Thanks", "Got it", "Will do"]) expect(screen.queryByText(chip)).toBeNull();
    expect(screen.getByText("View Email")).toBeInTheDocument();
    expect(screen.getByText("Sign")).toBeInTheDocument();
    expect(screen.getByText("Track")).toBeInTheDocument();
  });

  it("a person still gets Write Back and their quick replies", () => {
    saveMailSnapshot(snap({ needsYou: 1, threads: [person("1")] }));
    render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} onDraft={async () => "Yes"} onSend={async () => "id"} />);
    expect(screen.getByText("Write Back")).toBeInTheDocument();
    expect(screen.getByText("Thanks")).toBeInTheDocument();
  });

  it("shows the destination host for Sign, Fix and Track", () => {
    saveMailSnapshot(snap({ actionable: [note("1", act1("sign", URLS.sign)), note("2", act1("track", URLS.track))] }));
    render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} max={10} />);
    expect(screen.getByText("na3.docusign.net")).toBeInTheDocument();
    expect(screen.getByText("ups.com")).toBeInTheDocument();
  });

  it("says how many notifications did not fit", () => {
    saveMailSnapshot(snap({ actionable: [1, 2, 3, 4, 5].map((i) => note(String(i), act1("track", `https://ups.com/track?x=${i}`))) }));
    render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} />);
    expect(screen.getByText("2 More Emails in Your Inbox")).toBeInTheDocument();
  });
});

describe("MailNotices: the tap", () => {
  it("calls the action in the same tick as the tap, with the notice, and an opened page does not clear it", async () => {
    saveMailSnapshot(snap({ actionable: [note("1", act1("sign", URLS.sign))] }));
    const onNotificationAction = vi.fn(async (_n: MailNotice) => done({ message: "Opened the signing page." }));
    render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} onNotificationAction={onNotificationAction} />);
    fireEvent.click(screen.getByText("Sign"));
    expect(onNotificationAction).toHaveBeenCalledTimes(1); // synchronously: inside the gesture
    const n = onNotificationAction.mock.calls[0]![0];
    expect(n.notification!.url).toBe(URLS.sign);
    expect(n.account).toBe("me@x.com");
    expect(n.revision).toBe("m1");
    await flush();
    expect(toasts.at(-1)!.message).toBe("Opened the signing page.");
    expect(screen.getByText("Sign")).toBeInTheDocument(); // opened is not signed
  });

  it("a finished job clears the notice and says so", async () => {
    const future = new Date(Date.now() + 600_000).toISOString();
    saveMailSnapshot(snap({ actionable: [note("1", act1("copy_code", undefined, { expiresAt: future }))] }));
    render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} onNotificationAction={async () => done({ status: "completed", message: "Code copied", settled: true })} />);
    fireEvent.click(screen.getByText("Copy Code"));
    await flush();
    expect(toasts.at(-1)!.message).toBe("Code copied");
    expect(screen.queryByText("Copy Code")).toBeNull();
  });

  it("a failed copy leaves the notice and never says Code copied", async () => {
    const future = new Date(Date.now() + 600_000).toISOString();
    const onOpenThread = vi.fn();
    saveMailSnapshot(snap({ actionable: [note("1", act1("copy_code", undefined, { expiresAt: future }))] }));
    render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} onOpenThread={onOpenThread}
      onNotificationAction={async () => done({ status: "failed", message: "Couldn't Copy · Opening the Email", openThread: true })} />);
    fireEvent.click(screen.getByText("Copy Code"));
    await flush();
    expect(toasts.every((t) => !/Code copied/i.test(t.message))).toBe(true);
    expect(screen.getByText("Copy Code")).toBeInTheDocument();
    expect(onOpenThread).toHaveBeenCalledWith("1");
  });

  it("wears the action's own busy label, and a second tap while it works is not a second action", async () => {
    saveMailSnapshot(snap({ actionable: [note("1", act1("track", URLS.track))] }));
    let release!: (r: MailActionResult) => void;
    const onNotificationAction = vi.fn(() => new Promise<MailActionResult>((r) => { release = r; }));
    render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} onNotificationAction={onNotificationAction} />);
    fireEvent.click(screen.getByText("Track"));
    expect(await screen.findByText("Opening…")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Opening…"));
    expect(onNotificationAction).toHaveBeenCalledTimes(1);
    release(done({ message: "Opened tracking." }));
    await flush();
    expect(screen.getByText("Track")).toBeInTheDocument();
  });

  it("Add to Schedule: the receipt carries an Undo that brings the notice back only when the delete was confirmed", async () => {
    saveMailSnapshot(snap({ actionable: [note("1", act1("add_travel"))] }));
    const undo = vi.fn(async () => true);
    render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true}
      onNotificationAction={async () => done({ status: "completed", message: "Added to your schedule", settled: true, undo })} />);
    fireEvent.click(screen.getByText("Add to Schedule"));
    await flush();
    expect(screen.queryByText("Add to Schedule")).toBeNull();
    const t = toasts.at(-1)!;
    expect(t.message).toBe("Added to your schedule");
    expect(t.actionLabel).toBe("Undo");
    t.onAction!();
    await flush();
    expect(undo).toHaveBeenCalled();
    expect(screen.getByText("Add to Schedule")).toBeInTheDocument();
  });

  it("an Undo that did not take leaves the notice gone and says so", async () => {
    saveMailSnapshot(snap({ actionable: [note("1", act1("add_travel"))] }));
    render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true}
      onNotificationAction={async () => done({ status: "completed", message: "Added to your schedule", settled: true, undo: async () => false })} />);
    fireEvent.click(screen.getByText("Add to Schedule"));
    await flush();
    // The toast host takes the toast down when its action is tapped.
    toasts.at(-1)!.onAction!();
    hideToast();
    await flush();
    expect(screen.queryByText("Add to Schedule")).toBeNull();
    expect(toasts.at(-1)!.message).toBe("Couldn't Take It Back");
  });

  it("a page that would not open offers the exact link to copy, and says Link Copied only after it was", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    saveMailSnapshot(snap({ actionable: [note("1", act1("sign", URLS.sign))] }));
    render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true}
      onNotificationAction={async () => done({ status: "failed", message: "Your Browser Blocked That Tab", fallbackUrl: URLS.sign })} />);
    fireEvent.click(screen.getByText("Sign"));
    fireEvent.click(await screen.findByText("Copy Link"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URLS.sign));
    await flush();
    expect(toasts.at(-1)!.message).toBe("Link Copied");
  });

  it("a link copy the clipboard refused does not say Link Copied", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("NotAllowed"); } }, configurable: true });
    saveMailSnapshot(snap({ actionable: [note("1", act1("sign", URLS.sign))] }));
    render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true}
      onNotificationAction={async () => done({ status: "failed", message: "Your Browser Blocked That Tab", fallbackUrl: URLS.sign })} />);
    fireEvent.click(screen.getByText("Sign"));
    fireEvent.click(await screen.findByText("Copy Link"));
    await flush();
    expect(toasts.every((t) => t.message !== "Link Copied")).toBe(true);
  });

  it("with no handler wired, the tap opens the thread", () => {
    const onOpenThread = vi.fn();
    saveMailSnapshot(snap({ actionable: [note("1", act1("sign", URLS.sign))] }));
    render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} onOpenThread={onOpenThread} />);
    fireEvent.click(screen.getByText("Sign"));
    expect(onOpenThread).toHaveBeenCalledWith("1");
  });

  it("View Email opens the thread", () => {
    const onOpenThread = vi.fn();
    saveMailSnapshot(snap({ needsYou: 1, threads: [person("9", { fromEmail: "no-reply@acme.com", from: "Acme" })] }));
    render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} onOpenThread={onOpenThread} onNotificationAction={async () => done()} />);
    fireEvent.click(screen.getByText("View Email"));
    expect(onOpenThread).toHaveBeenCalledWith("9");
  });

  it("a dismissed notification stays dismissed for its message, and the next message is a new one", async () => {
    const future = new Date(Date.now() + 600_000).toISOString();
    saveMailSnapshot(snap({ actionable: [note("1", act1("copy_code", undefined, { expiresAt: future }), { revision: "m1", lastMsgId: "m1" })] }));
    const { container, unmount } = render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} onNotificationAction={async () => done({ status: "completed", message: "Code copied", settled: true })} />);
    fireEvent.click(screen.getByText("Copy Code"));
    await flush();
    expect(container.querySelectorAll(".pad-x")).toHaveLength(0);
    unmount();
    // Same thread, a newer message with a new code: shown again.
    saveMailSnapshot(snap({ actionable: [note("1", act1("copy_code", undefined, { expiresAt: future }), { revision: "m2", lastMsgId: "m2" })] }));
    render(<MailNotices today={TODAY} nowHHMM="09:00" onAddTask={async () => true} />);
    expect(screen.getByText("Copy Code")).toBeInTheDocument();
  });
});
