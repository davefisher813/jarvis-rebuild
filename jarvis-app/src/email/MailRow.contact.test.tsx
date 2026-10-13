// @vitest-environment jsdom
// THE SENDER'S CIRCLE IS A DOOR (issue 112, item 14; Email v1 spec 2.3: "Each source row has one tap target for detail plus an
// avatar target for contact"). The circle is a real button inside a row that is itself the message's door, so the two taps
// must never mix: the circle opens the contact and never the message, the words open the message and never the contact, and a
// key pressed on the circle is the circle's. Where the screen offers no contact sheet, or the list is selecting, the circle is
// the plain mark it always was: no dead control. The 44px reach is CSS's, so it is held here at the source; the browser
// measurement is the bench's (jsdom has no layout).
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import MailRow from "./MailRow";
import type { InboxRow } from "./emailClient";

afterEach(cleanup);

const NOW = new Date("2026-10-13T15:00:00");
const row = (o: Partial<InboxRow> = {}): InboxRow => ({
  id: "m1", account_id: "acct-1", account: "dave@example.test", provider_id: "p1", thread_id: "t1", internal_date: "2026-10-13T09:12:00",
  from_address: "maya@example.test", from_name: "Maya Chen", subject: "Lunch on Friday", snippet: "Can we meet at noon?", has_body: false,
  attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "h1", read: false, ...o,
});

function draw(o: Partial<Parameters<typeof MailRow>[0]> = {}, r: InboxRow = row()) {
  const fns = { onOpen: vi.fn(), onContact: vi.fn(), onPick: vi.fn() };
  const parentClick = vi.fn();
  const ui = render(<div onClick={parentClick}><MailRow row={r} accountLabel="" now={NOW} {...fns} {...o} /></div>);
  const rowEl = ui.container.querySelector(".mrow") as HTMLElement;
  return { ...fns, parentClick, rowEl, avatar: rowEl.querySelector(".mav") as HTMLElement };
}

describe("with a contact sheet to open", () => {
  it("the circle is exactly one real button, named for whom it opens, and the row stays the door it was", () => {
    const { rowEl, avatar } = draw();
    expect(rowEl.querySelectorAll("button")).toHaveLength(1);
    expect(avatar.tagName).toBe("BUTTON");
    expect(avatar).toHaveAttribute("type", "button");
    expect(avatar).toHaveAccessibleName("Contact Details for Maya Chen");
    expect(avatar).not.toHaveAttribute("aria-hidden");
    expect(avatar).toHaveClass("mav");
    expect(avatar.className).toMatch(/\bcat-fg-[a-z]+\b/);
    // The tests and the tab find a row by its class and its role: the circle must not look like one.
    expect(rowEl.className).toContain("mrow");
    expect(avatar.className).not.toContain("mrow");
    expect(rowEl).toHaveAttribute("role", "button");
    expect(rowEl).toHaveAttribute("tabindex", "0");
    expect(rowEl).toHaveAttribute("aria-label", "Maya Chen · Lunch on Friday · Unread");
    expect(avatar).toHaveTextContent("MC");
  });

  it("tapping the circle opens the contact and never the message, and the tap goes no further", () => {
    const { avatar, onOpen, onContact, parentClick } = draw();
    fireEvent.click(avatar);
    expect(onContact).toHaveBeenCalledTimes(1);
    expect(onContact.mock.calls[0]![0]).toMatchObject({ id: "m1", from_address: "maya@example.test" });
    expect(onOpen).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("tapping the unread dot, which sits on the circle, is the circle's tap", () => {
    const { rowEl, onOpen, onContact } = draw();
    fireEvent.click(rowEl.querySelector(".munread")!);
    expect(onContact).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("tapping the words opens the message and never the contact; so does the chevron end of the row, and the row itself", () => {
    const { rowEl, onOpen, onContact } = draw();
    fireEvent.click(within(rowEl).getByText("Lunch on Friday"));
    fireEvent.click(within(rowEl).getByText("Maya Chen"));
    fireEvent.click(rowEl.querySelector(".mchev")!);
    fireEvent.click(rowEl);
    expect(onOpen).toHaveBeenCalledTimes(4);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
    expect(onContact).not.toHaveBeenCalled();
  });

  it("Enter and Space on the circle are the circle's: they open the contact (the button's own click) and never the message", async () => {
    const user = userEvent.setup();
    const { avatar, onOpen, onContact } = draw();
    avatar.focus();
    await user.keyboard("{Enter}");
    expect(onContact).toHaveBeenCalledTimes(1);
    await user.keyboard(" ");
    expect(onContact).toHaveBeenCalledTimes(2);
    expect(onOpen).not.toHaveBeenCalled();
    // The row's own key handling is untouched: Enter or Space on the ROW opens the message.
    fireEvent.keyDown(avatar.closest(".mrow")!, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("a raw keydown on the circle never reaches the row, whatever the key", () => {
    const { avatar, onOpen, parentClick } = draw();
    const down = vi.fn();
    avatar.parentElement!.addEventListener("keydown", down);
    fireEvent.keyDown(avatar, { key: "Enter" });
    fireEvent.keyDown(avatar, { key: " " });
    expect(onOpen).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("a read message draws the circle without the unread dot, and the circle still opens the contact", () => {
    const { rowEl, avatar, onContact } = draw({}, row({ read: true }));
    expect(rowEl.querySelector(".munread")).toBeNull();
    expect(avatar).toHaveAccessibleName("Contact Details for Maya Chen");
    fireEvent.click(avatar);
    expect(onContact).toHaveBeenCalledTimes(1);
  });

  it("a sender with no name is named by the address, in the circle's name and in its letters", () => {
    const { avatar } = draw({}, row({ from_name: "", from_address: "jo.park@example.test" }));
    expect(avatar).toHaveAccessibleName("Contact Details for jo.park@example.test");
    expect(avatar).toHaveTextContent("JO");
  });

  it("a message with no sender address has no one to open: the circle stays a plain mark", () => {
    const { rowEl, avatar } = draw({}, row({ from_address: "", from_name: "Unknown" }));
    expect(rowEl.querySelectorAll("button")).toHaveLength(0);
    expect(avatar.tagName).toBe("SPAN");
    expect(avatar).toHaveAttribute("aria-hidden", "true");
  });
});

describe("without a contact sheet to open, and while selecting", () => {
  it("with no onContact the circle is the plain, hidden mark it was and the row holds no button", () => {
    const { rowEl, avatar, onOpen } = draw({ onContact: undefined });
    expect(avatar.tagName).toBe("SPAN");
    expect(avatar).toHaveAttribute("aria-hidden", "true");
    expect(avatar).toHaveClass("mav");
    expect(rowEl.querySelectorAll("button")).toHaveLength(0);
    // A tap on it is the row's tap, as it always was.
    fireEvent.click(avatar);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("while selecting the circle is a plain mark and the whole row is the selection's door", () => {
    const { rowEl, avatar, onOpen, onContact, onPick } = draw({ selecting: true, picked: false });
    expect(rowEl.querySelectorAll("button")).toHaveLength(0);
    expect(avatar.tagName).toBe("SPAN");
    expect(rowEl).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(avatar);
    fireEvent.click(rowEl);
    expect(onPick).toHaveBeenCalledTimes(2);
    expect(onContact).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("the reach: 44 pixels around a 40 pixel circle, drawn without moving anything", () => {
  const CSS = readFileSync(join(process.cwd(), "src/styles/mail-rows.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (sel: string) => new RegExp("(?:^|\\n)\\s*" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}").exec(CSS)?.[1] ?? "";

  it("button.mav::after is the shared expander at the shared minimum: centred, at least --tap-min each way, painting nothing", () => {
    const body = rule("button.mav::after");
    expect(body, "the circle's button form needs its reach").not.toBe("");
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/top:\s*50%/);
    expect(body).toMatch(/left:\s*50%/);
    expect(body).toMatch(/translate\(-50%,\s*-50%\)/);
    expect(body).toMatch(/min-width:\s*var\(--tap-min\)/);
    expect(body).toMatch(/min-height:\s*var\(--tap-min\)/);
    // It paints nothing and changes no type: no colour, no font, no size of its own beyond the reach.
    expect(body).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(|background|color|font|opacity|border|padding|margin/i);
  });

  it(".mav keeps its 40 pixel size and stays the positioned box the reach hangs from", () => {
    const body = rule(".mav");
    expect(body).toMatch(/position:\s*relative/);
    expect(body).toMatch(/width:\s*40px/);
    expect(body).toMatch(/height:\s*40px/);
    expect(body).not.toMatch(/overflow\s*:\s*hidden/);
  });

  it("the reach is the button's alone: the plain span the circle is in select mode gets none", () => {
    expect(CSS).not.toMatch(/(^|[\s,}])\.mav::after/);
  });

  // The browser measured a button's initials a fraction of a pixel off the span's (a button's line height is "normal", the span's is
  // inherited), so the button forms are told to inherit. Row and head, measured identical to the pixel against the span.
  it("the button forms inherit their line height, so the initials sit where the span's did, and change no other type", () => {
    const body = rule("button.mav, button.mface");
    expect(body.replace(/\s+/g, " ").trim()).toBe("line-height: inherit;");
  });
});
