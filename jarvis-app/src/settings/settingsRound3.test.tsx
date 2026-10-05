// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NotesProvider } from "../data/NotesProvider";
import BookingPage from "./BookingPage";
import TrainingPage from "./TrainingPage";
import LearnedRulesPage from "./LearnedRulesPage";
import CategoriesPage from "../categories/screens/CategoriesPage";
import SettingsPage from "../more/SettingsPage";
import { updateBookingSettings } from "../booking/settings";
import { DESTINATIONS } from "../shell/destinations";
import { Mail, MessageSquare, Sparkles } from "../shared/icons";

// SETTINGS, FIX ROUND 3 (the round 2 review, 2026-10-05, Dave: "Everything should look PERFECT"). Each test below fails without the change it names;
// the stylesheet ones read the CSS text, since jsdom draws none.

const CSS = (f: string) => readFileSync(join(process.cwd(), "src/styles", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
/** The body of the last rule whose selector list contains `sel` exactly. */
function rule(file: string, sel: string): string {
  let found = "";
  for (const m of CSS(file).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[1]!.split(",").some((s) => s.replace(/\s+/g, " ").trim() === sel)) found = m[2]!;
  }
  return found;
}
const norm = (e: Element | null) => (e?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("Booking: with Available off the week and the lengths are washed, and no two days share a letter", () => {
  const impls = { readLinkImpl: async () => null, readBookingsImpl: async () => [], readDaysOffImpl: async () => [] as string[], saveDaysOffImpl: async (d: string[]) => d };
  beforeEach(() => { localStorage.clear(); });

  it("the day and length groups carry the washed class exactly while the switch is off", async () => {
    updateBookingSettings({ available: false });
    const { container } = render(<BookingPage onBack={() => {}} {...impls} />);
    await screen.findByText("No Link Yet");
    const days = container.querySelector(".set-grid-days")!;
    const slots = container.querySelector(".set-grid-slots")!;
    expect(days).toHaveClass("set-grid-off");
    expect(slots).toHaveClass("set-grid-off");
    fireEvent.click(screen.getByRole("switch", { name: "Available for Booking" }));
    expect(days).not.toHaveClass("set-grid-off");
    expect(slots).not.toHaveClass("set-grid-off");
  });

  it("the washed state is drawn in the stylesheet, the same in both themes", () => {
    expect(rule("ruled.css", ".ruled .set-grid.set-grid-off > .chip")).toMatch(/opacity:\s*0?\.\d+/);
  });

  it("the days are two letters, so a T and an S are not each two different days", async () => {
    const { container } = render(<BookingPage onBack={() => {}} {...impls} />);
    await screen.findByText("No Link Yet");
    const labels = [...container.querySelectorAll(".set-grid-days > .chip")].map(norm);
    expect(labels).toEqual(["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]);
    expect(new Set(labels).size).toBe(7);
  });
});

describe("Training: the unit note sits under the unit, and the plates say what a tap does", () => {
  beforeEach(() => { localStorage.clear(); });

  it("the other-unit note is the block right under the card that holds Rack Unit and Bar Weight", () => {
    const { container } = render(<TrainingPage onBack={() => {}} />);
    const cards = [...container.querySelectorAll(".set-card")].map((c) => c.closest(".pad-x")!);
    expect(cards.length).toBe(2);
    const first = cards[0]!;
    expect(first.querySelector('[aria-label="Rack Unit"]'), "the first card holds the unit").not.toBeNull();
    expect(norm(first.nextElementSibling!.querySelector(".input-hint"))).toBe("A lift logged in the other unit is converted both ways");
    // And the plates card has its own line, not the unit's.
    expect(norm(cards[1]!.nextElementSibling!.querySelector(".input-hint"))).toBe("Tap a plate to turn it off or on");
  });

  it("the plate chips are inside an even-padded row (no extra bottom margin) in the stylesheet", () => {
    expect(rule("ruled.css", ".ruled .set-card .set-row > .chip-wrap-row")).toMatch(/margin-bottom:\s*0/);
  });
});

describe("Areas: reorder is a mode, and a row never carries a chevron and a grip together", () => {
  const cats = [
    { id: "a", data: { name: "Work", color: "blue", icon: "briefcase" } },
    { id: "b", data: { name: "Family", color: "pink", icon: "heart" } },
  ] as never;

  it("no grip at rest; the head's Reorder turns them on, takes the chevrons away, and Done restores", () => {
    const { container } = render(<CategoriesPage categories={cats} onEdit={() => {}} onAdd={() => {}} onBack={() => {}} onReorder={() => {}} />);
    expect(container.querySelectorAll(".drag-handle").length, "LOCKED: no always-visible grip").toBe(0);
    expect(container.querySelectorAll(".reorder-row .chev").length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Reorder" }));
    expect(container.querySelectorAll(".drag-handle").length).toBe(2);
    expect(container.querySelectorAll(".reorder-row .chev").length, "one trailing glyph per row").toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(container.querySelectorAll(".drag-handle").length).toBe(0);
    expect(container.querySelectorAll(".reorder-row .chev").length).toBe(2);
  });

  it("the head holds two capsules at most (D1): Reorder and Add Area", () => {
    const { container } = render(<CategoriesPage categories={cats} onEdit={() => {}} onAdd={() => {}} onBack={() => {}} onReorder={() => {}} />);
    expect(container.querySelectorAll(".sh2 .pill-action").length).toBe(2);
  });
});

describe("What JARVIS Learned: the same empty screen as Connections and Email Sections", () => {
  it("a head, then the one bare empty state, with the title in ink and no capsule", async () => {
    const { container } = render(<NotesProvider userId="u-r3-learned"><LearnedRulesPage onBack={() => {}} /></NotesProvider>);
    await screen.findByText("Nothing Learned Yet");
    expect([...container.querySelectorAll(".sh2 .t")].map(norm)).toEqual(["Rules"]);
    const box = container.querySelector(".empty-state")!;
    expect(box.closest(".card"), "bare, not boxed in a card").toBeNull();
    expect(box.previousElementSibling!.classList.contains("sh2"), "right under its head").toBe(true);
  });

  it("the shrunk title keeps the standard title's line box so its rule sits where every other page's does", () => {
    const body = rule("ruled.css", ".pagehead-title.pagehead-title-fit");
    expect(body).toMatch(/font-size:\s*calc\(30px/);
    expect(body).toMatch(/line-height:\s*calc\(44\.2px/);
  });
});

describe("Empty states lead with their title", () => {
  it(".empty-title is ink, and the line under it is the one grey", () => {
    expect(rule("jarvis-design-system.css", ".empty-title")).toMatch(/color:\s*var\(--tx-1\)/);
    expect(rule("components.css", ".empty-sub")).toMatch(/color:\s*var\(--tx-3\)/);
  });
});

describe("The Edit Tabs glyphs say what the tab is", () => {
  it("Email is the envelope and Chat is a bubble, so the dock's sparkle means Add Anything alone", () => {
    const by = Object.fromEntries(DESTINATIONS.map((d) => [d.key, d.Icon]));
    expect(by.messages).toBe(Mail);
    expect(by.chat).toBe(MessageSquare);
    for (const d of DESTINATIONS) expect(d.Icon, d.label + " does not wear the dock's sparkle").not.toBe(Sparkles);
  });
});

describe("The Settings hub: every row is one glyph on the same tile", () => {
  it("each row's glyph sits on .lib-ico-tile, drawn once in the stylesheet at one size", () => {
    const { container } = render(<NotesProvider userId="u-r3-hub"><SettingsPage onNavigate={() => {}} onBack={() => {}} /></NotesProvider>);
    const icons = [...container.querySelectorAll(".lib-row .lib-ico")];
    expect(icons.length).toBe(16);
    for (const i of icons) expect(i, norm(i.parentElement!.querySelector(".lib-name"))).toHaveClass("lib-ico-tile");
    const tile = rule("components.css", ".lib-row .lib-ico.lib-ico-tile");
    expect(tile).toMatch(/height:\s*30px/);
    expect(tile).toMatch(/border-radius:\s*var\(--r-sm\)/);
    expect(rule("components.css", ".lib-row .lib-ico.lib-ico-tile .ic")).toMatch(/width:\s*20px/);
  });
});

describe("Stylesheet: the small things that read as unfinished", () => {
  it("a locked switch is dimmed by a smaller step than before, and keeps a visible track in light", () => {
    expect(rule("components.css", ".switch-locked")).toMatch(/opacity:\s*0\.6/);
    expect(rule("components.css", '[data-theme="light"] .switch.off.switch-locked')).toMatch(/background:\s*color-mix/);
  });

  it("the quiet head's leader is the structure grey, so dark draws it as light does", () => {
    expect(rule("components.css", ".sh2.sh2-quiet::after")).toMatch(/border-top-color:\s*color-mix\(in srgb,\s*var\(--tx-4\)/);
  });

  it("Add in the Life header is a round capsule, like every other add", () => {
    expect(rule("components.css", ".hdr-add")).toMatch(/border-radius:\s*var\(--r-pill\)/);
  });

  it("a settings group takes the same air above its head after a card or after a note", () => {
    const sel = ".ruled:has(> .pad-x > .set-card) > .pad-x:has(> .input-hint) + .sh2";
    expect(rule("ruled.css", sel)).toMatch(/margin-top:\s*var\(--s-2\)/);
  });

  it("a popover's divider is inset on both sides", () => {
    expect(rule("components.css", ".hmenu-item + .hmenu-item::before")).toMatch(/right:\s*var\(--s-3\)/);
  });

  it("bullets and checklists start their text at one edge, and the fold chevron sits at the heading's right inside the gutter", () => {
    expect(rule("editor.css", ".doc-pm ul")).toMatch(/padding-left:\s*var\(--s-6h\)/);
    expect(rule("editor.css", '.doc-pm ul[data-type="taskList"] > li')).toMatch(/gap:\s*0/);
    const fold = rule("editor.css", ".doc-pm .doc-fold");
    expect(fold).toMatch(/right:\s*0/);
    expect(fold, "not hanging in the left margin").not.toMatch(/left:\s*-\d+px/);
  });

  it("the note footer breathes: a gap between lines and the 14 subtext rung on the caption", () => {
    expect(rule("components.css", ".note-conns")).toMatch(/gap:\s*var\(--s-2\)\s+var\(--s-2h\)/);
    expect(rule("components.css", ".note-conn-label")).toMatch(/font-size:\s*var\(--t-sub\)/);
  });
});

describe("Areas: a row still opens its sheet with the grips off", () => {
  it("a tap on the row opens Edit Area", async () => {
    const cats = [{ id: "a", data: { name: "Work", color: "blue", icon: "briefcase" } }, { id: "b", data: { name: "Home", color: "green", icon: "home" } }] as never;
    let opened = "";
    render(<CategoriesPage categories={cats} onEdit={(id) => { opened = id; }} onAdd={() => {}} onBack={() => {}} onReorder={() => {}} />);
    fireEvent.click(screen.getByText("Work"));
    await waitFor(() => expect(opened).toBe("a"));
  });
});
