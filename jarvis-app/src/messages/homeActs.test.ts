import { describe, it, expect } from "vitest";
import { mailNotices, EMPTY, type MailSnapshot, type MailThread } from "./home";

const TODAY = "2026-08-25";
const NOON = new Date("2026-08-25T12:55:00");

const thread = (id: string, over: Partial<MailThread> = {}): MailThread => ({
  id, from: "Riverside Dental", fromEmail: "front@riverside.com",
  subject: "Appointment reminder", gist: "Cleaning, 2 PM", ...over,
});

const snap = (threads: MailThread[]): MailSnapshot => ({ ...EMPTY, ts: Date.now(), needsYou: threads.length, threads });

describe("an email that states a commitment offers the commitment", () => {
  it("makes a Schedule It card out of an appointment, not a Reply card", () => {
    const n = mailNotices(snap([thread("t1", { act: { kind: "appointment", title: "Dental cleaning", date: "2026-08-27", start: "14:00" } })]), TODAY, NOON);
    expect(n).toHaveLength(1);
    expect(n[0]!.kind).toBe("act");
    expect(n[0]!.action).toBe("Schedule It");
    // The sub states what the button will WRITE. This card changes his
    // schedule without opening anything, so it has to show the event first.
    expect(n[0]!.sub).toContain("2:00");
    expect(n[0]!.act).toBeTruthy();
  });

  it("does not ALSO offer the same thread as a reply", () => {
    // An appointment reminder that ends "let us know if this doesn't work"
    // would otherwise take two of the three slots to say one thing.
    const n = mailNotices(snap([thread("t1", { act: { kind: "appointment", title: "Cleaning", date: "2026-08-27", start: "14:00" } })]), TODAY, NOON, 3);
    expect(n.filter((x) => x.threadId === "t1")).toHaveLength(1);
  });

  it("falls back to the ordinary reply card when the act cannot be trusted", () => {
    // Same email, a date the model wrote in prose. The card must not vanish
    // and must not invent: it goes back to being an email.
    const n = mailNotices(snap([thread("t1", { act: { kind: "appointment", title: "Cleaning", date: "Thursday", start: "14:00" } })]), TODAY, NOON);
    expect(n[0]!.kind).toBe("reply");
  });

  it("a bill says Add Bill and names the amount", () => {
    const n = mailNotices(snap([thread("t1", { act: { kind: "bill", title: "Internet", date: "2026-09-01", amount: 74.99 } })]), TODAY, NOON);
    expect(n[0]!.action).toBe("Add Bill");
    expect(n[0]!.sub).toContain("74.99");
  });

  it("outranks a plain reply, because a date someone else set is not optional", () => {
    const n = mailNotices(snap([
      thread("t1", { from: "Marcus", gist: "Wants the deck" }),
      thread("t2", { act: { kind: "appointment", title: "Cleaning", date: "2026-08-27", start: "14:00" } }),
    ]), TODAY, NOON, 2);
    expect(n[0]!.threadId).toBe("t2");
  });
});

describe("two cards that read the same are one card said twice", () => {
  it("collapses notices a person cannot tell apart", () => {
    // Dave 2026-08-25: his screenshot showed "Resolve Psychiatric Services
    // Client Portal / Draft It" stacked on an identical copy of itself. Two
    // REAL threads from one portal that sends the same notice twice, so every
    // per-kind rule in mailNotices was watching the wrong thing.
    const n = mailNotices(snap([
      thread("t1", { from: "Resolve Psychiatric Services", gist: "Video appt Thursday" }),
      thread("t2", { from: "Resolve Psychiatric Services", gist: "Video appt Thursday" }),
    ]), TODAY, NOON, 3);
    expect(n).toHaveLength(1);
  });

  it("keeps two cards that differ, even from the same sender", () => {
    const n = mailNotices(snap([
      thread("t1", { from: "Resolve Psychiatric Services", gist: "Video appt Thursday" }),
      thread("t2", { from: "Resolve Psychiatric Services", gist: "Intake form needed" }),
    ]), TODAY, NOON, 3);
    expect(n).toHaveLength(2);
  });

  it("does not let a collapsed duplicate eat the slot it would have taken", () => {
    // The dedupe skips, it does not consume: three distinct emails behind two
    // identical ones must still fill the page.
    const n = mailNotices(snap([
      thread("t1", { from: "Portal", gist: "Same line" }),
      thread("t2", { from: "Portal", gist: "Same line" }),
      thread("t3", { from: "Nadia", gist: "Invoice needs a signature" }),
      thread("t4", { from: "Marcus", gist: "Harper filing Friday" }),
    ]), TODAY, NOON, 3);
    expect(n).toHaveLength(3);
    expect(new Set(n.map((x) => x.title + x.sub)).size).toBe(3);
  });
});
