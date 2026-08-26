import { describe, it, expect } from "vitest";
import { isNoReply, isMachineAddress } from "./noReply";

describe("a mailbox nobody reads", () => {
  it("knows the address forms", () => {
    for (const a of [
      "no-reply@resolveclinic.com", "noreply@apple.com", "donotreply@bank.com",
      "notifications@vercel.com", "notification@x.io", "mailer-daemon@google.com",
      "bounces@sendgrid.net", "postmaster@x.com",
    ]) expect(isNoReply(a), a).toBe(true);
  });

  it("believes the message when it says so, whatever the address", () => {
    // Dave's screenshot: an ordinary-looking address, and the first line of
    // the body is "IMPORTANT: This is an automated message. Please do not
    // reply."
    expect(isNoReply("front@resolveclinic.com",
      "IMPORTANT: This is an automated message. Please do not reply. For any questions please contact your provider.")).toBe(true);
    expect(isNoReply("x@y.com", "This is an automated reminder that you have an appointment.")).toBe(true);
    expect(isNoReply("x@y.com", "You have reached an unmonitored mailbox.")).toBe(true);
  });

  it("treats a List-Unsubscribe header as the sender saying so", () => {
    // The app already read this header to draw an Unsubscribe button, and
    // offered quick replies beside it. The sender set the header; it is the
    // most reliable of the three signals.
    expect(isNoReply("sales@rushordertees.com", "Custom gear from Nike, all printed with your design.",
      "<https://rushordertees.com/unsub?x=1>, <mailto:unsub@rushordertees.com>")).toBe(true);
    // Absent or blank changes nothing.
    expect(isNoReply("marcus@northlake.org", "Need that waiver", "")).toBe(false);
    expect(isNoReply("marcus@northlake.org", "Need that waiver", "   ")).toBe(false);
  });

  it("leaves a real person alone", () => {
    expect(isNoReply("coach@northlake.org", "Dave, need the waiver back before Friday.")).toBe(false);
    expect(isNoReply("nadia@northlake.org", "Can you sign this and send it back?")).toBe(false);
    expect(isNoReply("", "")).toBe(false);
  });

  it("does not read a footer at the end of a long forwarded thread as the sender's voice", () => {
    // A newsletter's boilerplate quoted at the bottom of a genuine reply is
    // not that person saying they will not read you.
    const long = "Hi Dave, here's what I think about the plan. ".repeat(30)
      + "\n\n> This is an automated message. Please do not reply.";
    expect(isNoReply("marcus@northlake.org", long)).toBe(false);
  });
});

// 2026-08-26: the presentation net. Dave's inbox dressed Custom Ink, Crexi
// and Northlake as people because marketing@/alerts@/news@ say nothing about
// replies. The wide net is for how a row DRESSES; behavior keeps isNoReply.
describe("isMachineAddress", () => {
  it("catches the bulk trade's uniform locals", () => {
    for (const e of ["marketing@customink.com", "alerts@crexi.com", "news@northlake.org",
      "sales@rushordertees.com", "events@sarahco.com", "no-reply@geico.com"]) {
      expect(isMachineAddress(e), e).toBe(true);
    }
  });
  it("leaves the addresses small businesses actually write from", () => {
    for (const e of ["info@patelmed.com", "support@acme.com", "hello@studio.co",
      "team@startup.io", "office@school.org", "coach@northlake.org", "wei@bffsa.org"]) {
      expect(isMachineAddress(e), e).toBe(false);
    }
  });
});
