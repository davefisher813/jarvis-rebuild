// @vitest-environment jsdom
// THE GEICO INBOX LINE, ON THE DOM (Dave 2026-10-13, issue 103). The row's
// snippet is the message preview only: no invisible padding, no entity text,
// no tracking line. A snippet that is nothing but plumbing draws NO line, not
// an empty one holding the account label's room (a row with nothing to say
// shows nothing).
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import MailRow from "./MailRow";
import type { InboxRow } from "./emailClient";

const NOW = new Date("2026-10-13T15:00:00Z");
const PAD = "&#847;&zwnj;&nbsp;&#8203;&nbsp;\u034f\u200c \u034f\u200c &#847; ";
const row = (snippet: string): InboxRow => ({
  id: "m1", account_id: "acct-1", account: "dave@example.test", provider_id: "p1", thread_id: "t1",
  internal_date: "2026-10-13T14:00:00Z", from_address: "service@geico.test", from_name: "GEICO",
  subject: "Your policy renews soon", snippet, has_body: false, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "h1", read: true,
});
const draw = (snippet: string) =>
  render(<MailRow row={row(snippet)} accountLabel="" now={NOW} onOpen={vi.fn()} />).container;

describe("MailRow snippet", () => {
  it("shows the preview words only, with the padding and the tracking line gone", () => {
    const c = draw("View in browser ( https://click.geico.com/ls/click?upn=abc123 ) Your GEICO bill is ready, Dave&#39;s policy &amp; more " + PAD + PAD);
    const text = c.querySelector(".msnip")?.textContent ?? "";
    expect(text).toBe("Your GEICO bill is ready, Dave's policy & more");
    expect(text).not.toMatch(/[\u034f\u200b\u200c\u00a0]/);
  });

  it("draws no third line when the snippet is only padding and a tracking link", () => {
    const c = draw("View in browser ( https://click.geico.com/ls/click?upn=abc123 ) " + PAD + PAD);
    expect(c.querySelector(".msnip")).toBeNull();
    expect(c.querySelector(".mline3")).toBeNull();
  });

  it("leaves an ordinary snippet exactly as it was", () => {
    const c = draw("Amount due");
    expect(c.querySelector(".msnip")?.textContent).toBe("Amount due");
  });
});
