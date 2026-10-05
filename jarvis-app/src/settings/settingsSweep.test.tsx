// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Capacitor } from "@capacitor/core";
import { NotesProvider, useCategories } from "../data/NotesProvider";
import { AuthProvider } from "../auth/AuthProvider";
import { AppearanceProvider } from "../appearance/AppearanceProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import SettingsPage from "../more/SettingsPage";
import EditTabsPage from "../more/EditTabsPage";
import AccountPage from "./AccountPage";
import AppearancePage from "./AppearancePage";
import BookingPage from "./BookingPage";
import BrainSettingsPage from "./BrainSettingsPage";
import AIControlPage from "./AIControlPage";
import EmailSectionsPage from "./EmailSectionsPage";
import LearnedRulesPage from "./LearnedRulesPage";
import NotificationsPage, { webNote } from "./NotificationsPage";
import { Head, DangerRow } from "./kit";
import ConnectionsPage from "../connections/ConnectionsPage";
import CategoriesPage from "../categories/screens/CategoriesPage";
import CategorySheet from "../categories/screens/CategorySheet";
import { DESTINATIONS, MAX_TABS } from "../shell/destinations";
import { filledSettingsIcon, FILLED_FALLBACK } from "../shared/filledIcons";
import * as toast from "../shared/toast";

// THE SETTINGS SWEEP, ROUND 1B (Dave 2026-10-05: "Everything should look PERFECT. I want the most aesthetically pleasing app ever. He opens the
// app and finds nothing."). Each test below fails without the change it names; the stylesheet ones read the CSS text, since jsdom draws none.

const CSS = ["jarvis-design-system.css", "components.css", "ruled.css", "editor.css"]
  .map((f) => readFileSync(join(process.cwd(), "src/styles", f), "utf8")).join("\n");
/** The body of the last rule whose selector list contains `sel` (later rules win, so the last is the live one). */
function rule(sel: string): string {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  let found = "";
  for (const m of bare.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[1]!.split(",").some((s) => s.trim() === sel)) found = m[2]!;
  }
  return found;
}
const norm = (e: Element | null) => (e?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("Settings hub: every row wears its own type's colour, one glyph style, no placeholder disc", () => {
  const view = () => render(<AuthProvider><NotesProvider userId="u-sweep-hub"><SettingsPage onNavigate={() => {}} onBack={() => {}} /></NotesProvider></AuthProvider>);
  const tone = (el: Element) => [...el.classList].find((c) => c.startsWith("cat-fg-") || c === "lib-ico-brand");

  it("no row is the flat brand red, and the colours are the types' own", () => {
    const { container } = view();
    const rows = [...container.querySelectorAll(".lib-row")];
    expect(rows.length).toBe(16);
    expect(container.querySelector(".lib-ico-brand"), "the 2026-08-18 all-red wash is superseded").toBeNull();
    const by = Object.fromEntries(rows.map((r) => [norm(r.querySelector(".lib-name")), tone(r.querySelector(".lib-ico")!)]));
    expect(by).toMatchObject({
      Notifications: "cat-fg-orange", Booking: "cat-fg-sky", "Email Sections": "cat-fg-teal", Brain: "cat-fg-purple", Connections: "cat-fg-blue",
      Backup: "cat-fg-graphite", About: "cat-fg-graphite",
    });
    expect(new Set(Object.values(by)).size).toBeGreaterThan(6);
  });

  it("Booking has its own calendar glyph and no destination falls back to the placeholder disc", () => {
    expect(filledSettingsIcon("booking")).not.toBe(FILLED_FALLBACK);
    const { container } = view();
    for (const r of container.querySelectorAll(".lib-row")) expect(r.querySelector(".lib-ico svg"), norm(r.querySelector(".lib-name"))).not.toBeNull();
    for (const route of ["account", "notifsettings", "appearance", "feedbackstyle", "categories", "training", "booking", "edittabs", "connections", "emailsections", "aicontrol", "learned", "brainsettings", "backup", "advanced", "about"]) {
      expect(filledSettingsIcon(route), route + " has a drawn glyph").not.toBe(FILLED_FALLBACK);
    }
  });

  it("the long list is four cards, so the groups read apart", () => {
    const { container } = view();
    expect(container.querySelectorAll(".nav-card").length).toBe(4);
    expect(container.querySelectorAll(".nav-card")[1]!.querySelectorAll(".lib-row").length).toBe(7);
  });
});

describe("Account: no red question mark, and the armed step looks armed", () => {
  const view = (extra = {}) => render(<AuthProvider><NotesProvider userId="u-sweep-acct"><AccountPage onBack={() => {}} onEditProfile={() => {}} onSignOut={() => {}} {...extra} /></NotesProvider></AuthProvider>);

  it("drops the head that repeated the page title", () => {
    const { container } = view();
    expect([...container.querySelectorAll(".sh2 .t")].map(norm)).not.toContain("Account");
  });

  it("the Redo Setup row keeps one height and takes the confirm amber once armed", () => {
    const { container } = view();
    const row = () => screen.getByText(/Redo Setup/).closest(".row")!;
    expect(row()).toHaveClass("set-armable");
    expect(row()).not.toHaveClass("set-armed");
    fireEvent.click(screen.getByText("Redo Setup"));
    expect(row()).toHaveClass("set-armed");
    expect(container.querySelector(".set-armed .conn-name")!.textContent).toBe("Tap Again to Redo Setup");
    expect(rule(".ruled .set-card > .set-row.set-armed .conn-name")).toMatch(/color:\s*var\(--warn\)/);
    expect(rule(".ruled .set-card > .set-row.set-armable")).toMatch(/min-height:\s*\d+px/);
  });

  it("Sign Out arms into the solid destructive slab, not the row it was", () => {
    view();
    const btn = () => screen.getByRole("button", { name: /Sign Out/ });
    expect(btn()).not.toHaveClass("armed");
    fireEvent.click(btn());
    expect(btn()).toHaveClass("armed");
    expect(rule(".row-signout.armed")).toMatch(/background-color:\s*var\(--sys-red\)/);
  });
});

describe("Head and DangerRow: a destructive capsule and its armed step", () => {
  it("a head with two actions draws them as one pair of capsules, with the destructive tones as classes", () => {
    const { container } = render(<Head label="Danger Zone" actions={[{ label: "Cancel", onClick: () => {} }, { label: "Erase Now", tone: "armed", onClick: () => {} }]} />);
    const caps = [...container.querySelectorAll(".sh2 .pill-action")];
    expect(caps.map(norm)).toEqual(["Cancel", "Erase Now"]);
    expect(caps[1]).toHaveClass("pill-armed");
    expect(caps[0]!.parentElement).toHaveClass("sec-left");
  });

  it("a count is a stateless number in ink, and a labelled one is allowed", () => {
    const { container } = render(<Head label="In the Tab Bar" count="3 of 5 Tabs" />);
    expect(container.querySelector(".n")).toHaveClass("set-n");
    expect(rule(".sh2 .n.set-n")).toMatch(/color:\s*var\(--tx-1\)/);
  });

  it("DangerRow takes the armed class", () => {
    render(<DangerRow label="Tap Again" onClick={() => {}} armed />);
    expect(screen.getByRole("button", { name: "Tap Again" })).toHaveClass("armed");
  });
});

describe("Brain: the Danger Zone is the head's capsule, the confirm is solid red with a Cancel, and it relaxes by itself", () => {
  beforeEach(() => { vi.useFakeTimers(); toast.resetToasts(); });
  afterEach(() => { vi.useRealTimers(); });
  const view = () => render(<NotesProvider userId="u-sweep-brain"><BrainSettingsPage onBack={() => {}} /></NotesProvider>);

  it("arms into Cancel and Erase Now, clears a stale receipt, and auto-disarms after four seconds", () => {
    const { container } = view();
    toast.showToast({ message: "Brain Exported" });
    const seen: (toast.ToastState | null)[] = [];
    const stop = toast.subscribeToast((t) => seen.push(t));
    fireEvent.click(screen.getByRole("button", { name: "Erase Brain Data" }));
    expect(seen.at(-1), "the stale Brain Exported toast is gone").toBeNull();
    stop();
    const confirm = screen.getByRole("button", { name: "Erase Now" });
    expect(confirm).toHaveClass("pill-armed");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    // never a second row under the head: both capsules ride the head's own line
    expect(confirm.closest(".sh2")).toBe(screen.getByRole("button", { name: "Cancel" }).closest(".sh2"));
    expect(container.querySelectorAll(".sh2 .pill-action").length).toBeLessThanOrEqual(2);
    act(() => { vi.advanceTimersByTime(4100); });
    expect(screen.queryByRole("button", { name: "Erase Now" })).toBeNull();
    expect(screen.getByRole("button", { name: "Erase Brain Data" })).toBeInTheDocument();
  });

  it("Cancel puts it back", () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: "Erase Brain Data" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Erase Brain Data" })).toBeInTheDocument();
  });

  it("its messages carry no typed check mark", () => {
    const src = readFileSync(join(process.cwd(), "src/settings/BrainSettingsPage.tsx"), "utf8");
    expect(src).not.toMatch(/✓/);
  });
});

describe("Notifications: the way to turn the dead-looking Alerts switch on sits right under it, in short lines", () => {
  afterEach(() => vi.restoreAllMocks());

  it("the how-to is the note under the This Phone card, before the next head", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    const { container } = render(<NotesProvider userId="u-sweep-notif"><NotificationsPage onBack={() => {}} /></NotesProvider>);
    const heads = [...container.querySelectorAll(".sh2 .t")].map(norm);
    expect(heads[0]).toBe("This Phone");
    const phoneCard = container.querySelector(".set-card")!.closest(".pad-x")!;
    const note = phoneCard.nextElementSibling!;
    expect(note.querySelector(".input-hint"), "the note is the very next block").not.toBeNull();
    expect(note.nextElementSibling!.classList.contains("sh2"), "and the next block is the next head").toBe(true);
  });

  it("no switch line wraps a sentence: each is a short fragment", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    const { container } = render(<NotesProvider userId="u-sweep-notif2"><NotificationsPage onBack={() => {}} /></NotesProvider>);
    await screen.findByText("Today's Events");
    for (const m of container.querySelectorAll(".set-row .conn-meta")) {
      const t = norm(m);
      if (t.startsWith("Add JARVIS")) continue; // the locked reason, with the how-to right under it
      expect(t.length, t).toBeLessThanOrEqual(36);
    }
    expect(container.textContent).not.toContain("What Tomorrow Morning Means");
  });

  it("webNote carries no dot typed in it, for any state", () => {
    for (const s of ["no-sw", "not-standalone", "no-push", "denied", "no-key", "off", "on"] as const) expect(webNote(s), s).not.toContain("·");
    expect(webNote(null)).toBe("Checking whether this phone can get alerts");
  });
});

describe("Appearance: the choice is shown, and the note belongs to the row it is about", () => {
  it("draws a Preview of a real row and puts the text note on Text Size", () => {
    const { container } = render(<AppearanceProvider><AppearancePage onBack={() => {}} /></AppearanceProvider>);
    expect([...container.querySelectorAll(".sh2 .t")].map(norm)).toEqual(["Display", "Preview"]);
    const size = screen.getByText("Text Size").closest(".row")!;
    expect(norm(size.querySelector(".conn-meta"))).toBe("Larger Text Everywhere");
    expect(container.querySelector(".input-hint"), "no ambiguous note hanging under both rows").toBeNull();
    const preview = container.querySelector(".set-preview .row")!;
    expect(preview.getAttribute("aria-hidden")).toBe("true");
    expect(preview.querySelector(".fact.warn")).not.toBeNull();
  });
});

describe("Edit Tabs: a tab is the same mark in both lists, and the count says what it counts", () => {
  it("every toggle row carries its tab's glyph tile, and the head says N of the cap", () => {
    const { container } = render(<EditTabsPage tabKeys={["today", "life", "schedule"]} onToggle={() => {}} onBack={() => {}} />);
    const rows = [...container.querySelectorAll(".set-card .set-row")];
    expect(rows.length).toBe(DESTINATIONS.length);
    for (const r of rows) expect(r.querySelector(".sec-ico svg"), norm(r.querySelector(".conn-name"))).not.toBeNull();
    expect(norm(container.querySelector(".sh2 .n"))).toBe(`3 of ${MAX_TABS} Tabs`);
  });

  it("the cap note is one sentence with no typed dot", () => {
    const { container } = render(<EditTabsPage tabKeys={["today", "life", "schedule", "brain", "notes"]} onToggle={() => {}} onBack={() => {}} />);
    expect(norm(container.querySelector(".input-hint"))).toBe(`The tab bar holds ${MAX_TABS}, so turn another off first`);
  });
});

describe("AI Control: short lines, a visible radio, no placeholder section, no jargon", () => {
  const view = () => render(<NotesProvider userId="u-sweep-ai"><AIControlPage onBack={() => {}} /></NotesProvider>);

  it("every level's line fits one short line, and 'Everything' no longer strands 'Send'", () => {
    const { container } = view();
    const metas = [...container.querySelectorAll('[role="radio"] .conn-meta')].map(norm);
    expect(metas.length).toBe(4);
    expect(metas[0]).toBe("Acts with Undo, You Still Send");
    for (const m of metas) expect(m.length, m).toBeLessThanOrEqual(32);
  });

  it("the per-feature default says what it means, not the build's own word", () => {
    const { container } = view();
    expect(container.textContent).not.toContain("Match Master");
    expect(container.textContent).toContain("Same as AI Level");
  });

  it("What Ran is not drawn while nothing has been counted (no 'Not Tracked' placeholder)", () => {
    const { container } = view();
    expect([...container.querySelectorAll(".sh2 .t")].map(norm)).not.toContain("What Ran");
    expect(container.textContent).not.toContain("Not Tracked");
  });

  it("the selected radio is the tap red and the unselected ring is the visible grey", () => {
    expect(rule(".ruled .set-card .radio.on")).toMatch(/border-color:\s*var\(--tint\)/);
    expect(rule(".ruled .set-card .radio.on::after")).toMatch(/background:\s*var\(--tint\)/);
    expect(rule(".ruled .set-card .radio")).toMatch(/border-color:\s*var\(--tx-4\)/);
  });
});

describe("Empty states are crafted (D9): a glyph in its type's colour, a title, one warm line", () => {
  const glyphed = (box: Element | null) => {
    expect(box, "the empty state is drawn").not.toBeNull();
    expect(box!.querySelector(".empty-icon svg")).not.toBeNull();
    expect(box!.querySelector(".empty-icon")!.className).toMatch(/cat-fg-/);
    expect(box!.querySelectorAll(".empty-sub")).toHaveLength(1);
    expect(box!.querySelector(".empty-title")!.textContent!.length).toBeGreaterThan(0);
  };

  it("What JARVIS Learned", async () => {
    const { container } = render(<NotesProvider userId="u-sweep-learned"><LearnedRulesPage onBack={() => {}} /></NotesProvider>);
    await waitFor(() => expect(container.querySelector(".empty-state")).not.toBeNull());
    glyphed(container.querySelector(".empty-state"));
    expect(norm(container.querySelector(".empty-title"))).toBe("Nothing Learned Yet");
    expect(norm(container.querySelector(".empty-sub"))).toBe("A Rule Lands Here After You Correct JARVIS Twice");
  });

  it("What JARVIS Learned: the long page title steps down to fit one line, and breaks evenly if it still wraps", () => {
    const { container } = render(<NotesProvider userId="u-sweep-learned2"><LearnedRulesPage onBack={() => {}} /></NotesProvider>);
    expect(container.querySelector(".pagehead-title")).toHaveClass("pagehead-title-fit");
    expect(rule(".pagehead-title.pagehead-title-fit")).toMatch(/font-size:\s*calc\(30px/);
    expect(rule(".pagehead-title")).toMatch(/text-wrap:\s*balance/);
  });

  it("Email Sections", async () => {
    const { container } = render(<NotesProvider userId="u-sweep-sections"><EmailSectionsPage onBack={() => {}} /></NotesProvider>);
    await waitFor(() => expect(container.querySelector(".empty-state")).not.toBeNull());
    glyphed(container.querySelector(".empty-state"));
    expect(norm(container.querySelector(".empty-sub"))).toBe("Filters Appear as Chips on Email");
    // the one capsule that fills it is on the head directly above
    expect(screen.getByRole("button", { name: "Add Section" }).closest(".sh2")).not.toBeNull();
  });

  it("Booking: the two empty states and the head capsules that fill them", async () => {
    const { container } = render(<BookingPage onBack={() => {}} readLinkImpl={async () => null} readBookingsImpl={async () => []} readDaysOffImpl={async () => []} saveDaysOffImpl={async (d: string[]) => d} />);
    await screen.findByText("No Link Yet");
    const boxes = [...container.querySelectorAll(".empty-state")];
    expect(boxes.map((b) => norm(b.querySelector(".empty-title")))).toEqual(["No Link Yet", "No Days Off"]);
    for (const b of boxes) glyphed(b);
    expect(screen.getByRole("button", { name: "Add a Day Off" }).closest(".sh2")).not.toBeNull();
  });

  it("Connections: Google Setup Required says why, in one line", () => {
    const { container } = render(
      <NotesProvider userId="u-sweep-conn"><GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => ({}) as never}><ConnectionsPage configured={false} /></GoogleSessionProvider></NotesProvider>,
    );
    glyphed(container.querySelector(".empty-state"));
    expect(norm(container.querySelector(".empty-sub"))).toBe("Google Sign-In Is Not Switched On for This Build");
  });

  it("Connections wears the one Settings header: the shared page header, not its own taller bar and title", () => {
    const { container } = render(
      <NotesProvider userId="u-sweep-conn2"><GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => ({}) as never}><ConnectionsPage configured={false} /></GoogleSessionProvider></NotesProvider>,
    );
    expect(container.querySelector(".pagebar")).not.toBeNull();
    expect(container.querySelector(".pagehead-title")!.textContent).toBe("Connections");
    expect(container.querySelector(".nav-bar, .nav-large"), "the page's own header is gone").toBeNull();
  });
});

describe("Booking: seven days in one row and four lengths in one row, whole", () => {
  const view = () => render(<BookingPage onBack={() => {}} readLinkImpl={async () => null} readBookingsImpl={async () => []} readDaysOffImpl={async () => []} saveDaysOffImpl={async (d: string[]) => d} />);

  it("the days are seven equal cells in a grid, not a scrolling chip strip that fades the seventh", () => {
    const { container } = view();
    const days = screen.getByRole("group", { name: "Days you take bookings" });
    expect(days).toHaveClass("set-grid", "set-grid-days");
    expect(days.classList.contains("chip-row")).toBe(false);
    expect(days.querySelectorAll(".chip").length).toBe(7);
    expect(rule(".ruled .set-grid-days")).toMatch(/repeat\(7,/);
    expect(container.querySelectorAll(".chip-row").length, "no scroller left on this page").toBe(0);
  });

  it("the four slot lengths are four equal columns, none orphaned on a second line", () => {
    view();
    const slots = screen.getByRole("group", { name: "Slot length" });
    expect(slots).toHaveClass("set-grid-slots");
    expect([...slots.querySelectorAll(".chip")].map(norm)).toEqual(["15 Min", "30 Min", "45 Min", "60 Min"]);
    expect(rule(".ruled .set-grid-slots")).toMatch(/repeat\(4,/);
  });

  it("the off track of a switch is a visible warm grey in light", () => {
    expect(CSS).toMatch(/--switch-off:\s*#[0-9A-Fa-f]{6}/);
    expect(rule(".switch.off")).toMatch(/var\(--switch-off/);
  });
});

describe("Feedback Style: one note per card, no typed dots, and Accountability says it once", () => {
  it("the source carries no dot typed into a note", () => {
    const src = readFileSync(join(process.cwd(), "src/settings/FeedbackStylePage.tsx"), "utf8");
    expect(src).not.toMatch(/<Foot>[^<]*\\u00b7/);
    expect(src).not.toMatch(/value="Private"/);
  });
});

describe("Areas: the tile is inside the row's own padding, the sheet says Area, and the picked colour is ringed in ink with a check", () => {
  const cats = [
    { id: "a", data: { name: "Work", color: "blue", icon: "briefcase" } },
    { id: "b", data: { name: "Family", color: "pink", icon: "heart" } },
  ] as never;

  it("each reorder row holds its tile, its name and a chevron in the press wrapper, which carries the padding", () => {
    const { container } = render(<CategoriesPage categories={cats} onEdit={() => {}} onAdd={() => {}} onBack={() => {}} onReorder={() => {}} />);
    const rows = [...container.querySelectorAll(".reorder-row")];
    expect(rows.length).toBe(2);
    for (const r of rows) {
      const press = r.querySelector(":scope > .row-press")!;
      expect(press, "the wrapper").not.toBeNull();
      expect(press.querySelector(".sec-ico"), "the tile is inside the padded wrapper, not beside it").not.toBeNull();
      expect(press.querySelector(".chev"), "a tap cue before the handle").not.toBeNull();
      expect(r.querySelector(":scope > .sec-ico"), "no tile left outside the padding").toBeNull();
    }
    expect(norm(container.querySelector(".sh2 .n"))).toBe("2");
    expect(container.querySelector(".sh2 .n")).toHaveClass("set-n");
  });

  it("the sheet speaks of areas throughout, and the kind is spelled out", () => {
    render(<CategorySheet mode="edit" initial={{ name: "Work", kind: "org" }} onSave={() => {}} onDelete={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Delete Area")).toBeInTheDocument();
    expect(screen.queryByText("Delete Category")).toBeNull();
    expect(screen.getByLabelText("Kind")).toHaveTextContent("Organization");
    expect(screen.getByText("Pause This Area")).toBeInTheDocument();
    expect(screen.getByText("Follow My Work Hours")).toBeInTheDocument();
    // the two season tiles are the one neutral colour, and each line is always the same sentence
    const tiles = [...document.querySelectorAll(".xs-row .row-ico")].filter((t) => /nav-tile-graphite/.test(t.className));
    expect(tiles.length, "Kind and both season rows share the one neutral tile").toBeGreaterThanOrEqual(3);
    expect(document.querySelector(".nav-tile-sand, .nav-tile-blue"), "no unrelated tile colours").toBeNull();
    expect(screen.queryByText("In Season")).toBeNull();
    expect(screen.queryByText("Any Hour")).toBeNull();
  });

  it("the picked swatch carries a drawn check, and its ring is ink, never the brand red", () => {
    render(<CategorySheet mode="new" initial={{ color: "green" }} onSave={() => {}} onCancel={() => {}} />);
    const picked = screen.getByRole("button", { name: "green" });
    expect(picked).toHaveClass("sel");
    expect(picked.querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("button", { name: "blue" }).querySelector("svg")).toBeNull();
    expect(rule(".swatch.sel")).toMatch(/outline-color:\s*var\(--tx-1\)/);
  });

  it("the area's name is ink at the name weight", () => {
    render(<CategorySheet mode="new" onSave={() => {}} onCancel={() => {}} />);
    expect(document.querySelector(".xs-row-name .xs-input")).not.toBeNull();
    expect(rule(".form-sheet .xs-row-name .xs-input")).toMatch(/color:\s*var\(--tx-1\)/);
  });
});

describe("The sheet's Save is the one filled primary, the same in both themes", () => {
  it("a filled action-red pill with white ink, and the dark-only white override is gone", () => {
    const save = rule(".form-sheet .sheet-bar-save");
    expect(save).toMatch(/background-color:\s*var\(--accent-fill\)/);
    expect(save).toMatch(/color:\s*#fff/);
    expect(save).toMatch(/border-radius:\s*var\(--r-pill\)/);
  });

  it("Cancel and Save take the same width, so the title stays centred", () => {
    expect(rule(".sheet-bar-cancel")).toMatch(/min-width/);
    expect(rule(".sheet-bar-save")).toMatch(/min-width/);
  });
});

describe("Notes editor: the title is the large title, the next-event line has its glyph, and the footer anchors", () => {
  it("the note title takes the page-title scale and breaks evenly", () => {
    const body = rule(".doc-write .doc-title");
    expect(body).toMatch(/font-size:\s*var\(--t-h1\)/);
    expect(body).toMatch(/text-wrap:\s*balance/);
  });

  it("the word count pins to the foot and the writing area no longer pushes the footer a third of a screen away", () => {
    expect(rule(".screen-editor .doc-count")).toMatch(/margin-top:\s*auto/);
    expect(rule(".screen-editor .doc-write .doc-pm")).toMatch(/min-height:\s*12em/);
  });

  it("the fold chevron has a 44px target and a readable ink", () => {
    expect(rule(".doc-pm .doc-fold")).toMatch(/height:\s*44px/);
    expect(rule(".doc-pm .doc-fold::before")).toMatch(/var\(--tx-3\)/);
  });
});

describe("Onboarding's intro: one wordmark, one edge, one card surface", () => {
  it("the J is the brand red in both themes, the eyebrow loses its second indent, the privacy card wears the card's surface", () => {
    expect(rule(".ob-brand .jr")).toMatch(/color:\s*var\(--accent-glyph\)/);
    expect(rule(".ob-body > .grp")).toMatch(/padding-left:\s*0/);
    expect(rule(".ob-screen .ob-privacy")).toMatch(/var\(--surface-1\)/);
  });
});

describe("Profile: a typed name looks typed", () => {
  it("fields are ink with the readable grey for their hint, and the Name sits in a quiet well", () => {
    expect(rule(".ruled .set-field")).toMatch(/color:\s*var\(--tx-1\)/);
    expect(rule(".ruled .set-field::placeholder")).toMatch(/color:\s*var\(--tx-3\)/);
    expect(rule(".ruled .set-field.set-field-well")).toMatch(/background-color:\s*var\(--press-3\)/);
  });
});
