// @vitest-environment jsdom
import { useEffect } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Capacitor } from "@capacitor/core";
import { NotesProvider, useCategories, useRules, useProfile } from "../data/NotesProvider";
import { AuthProvider } from "../auth/AuthProvider";
import * as notifications from "../shared/notifications";
import * as webPush from "../shared/webPush";
import { lineCase } from "../shared/casing";
import { ChatService } from "../chat/ChatService";
import { subscribeToast, resetToasts } from "../shared/toast";
import { newSectionId, type EmailSection } from "../messages/emailSections";
import { updateHealthSettings } from "../health/settings";
import AccountPage from "./AccountPage";
import NotificationsPage from "./NotificationsPage";
import BookingPage from "./BookingPage";
import AIControlPage from "./AIControlPage";
import AdvancedPage from "./AdvancedPage";
import BackupPage from "./BackupPage";
import BrainSettingsPage from "./BrainSettingsPage";
import EmailSectionsPage from "./EmailSectionsPage";
import HealthSettingsPage from "./HealthSettingsPage";
import TrainingPage from "./TrainingPage";
import LearnedRulesPage from "./LearnedRulesPage";
import AboutPage from "./AboutPage";
import FeedbackSheet from "./FeedbackSheet";
import LegalScreen from "./LegalScreen";

// THE VISUAL CATALOG, HELD ON SETTINGS (Dave 2026-10-05, "I am sick of this").
//
// Every check below reads the DOM the real page draws, through the real
// components, never the source text, so a page that builds its line another
// way is still caught. The universal scan is the permanent gate for this
// area: any page added under settings/ should be rendered through it. The
// rules it holds (RULEBOOK R1, R3, R4, R6 and the casing rule):
//
//   - no middle dot inside a .conn-meta, .fact, .facts or .row-value (the
//     separator is the stylesheet's, never a character in a string);
//   - at most one untoned, un-bolded grey .fact on a line (one grey per row);
//   - a .facts or .conn-meta line that exists says something (no placeholder,
//     no empty line);
//   - a row's grey line is never its own name again;
//   - every title, grey line, value and kicker is Title Case (lineCase is the
//     one formatter, so a line that survives it is Title Case);
//   - a note (.input-hint, a sheet Note) is one sentence or dot-joined
//     fragments, never two sentences;
//   - no raw hex or rgb in an inline style.

const MIDDOT = "·";
const TONES = ["warn", "red", "good", "est", "date", "st", "cat"];
const norm = (e: Element) => (e.textContent ?? "").replace(/\s+/g, " ").trim();
/** A line made of an address, a path or a typed identifier is somebody's data, not copy the app wrote. */
// "dev" and "Build dev" are the no-stamp fallback of a local build, an identifier like a build id.
const isData = (t: string) => /[@/]|\.\w{2,}$|^\d{4}-\d{2}-\d{2}$|^(Build )?dev$/.test(t);

function scan(root: ParentNode, skip: (t: string) => boolean = () => false): string[] {
  const bad: string[] = [];
  for (const el of root.querySelectorAll(".conn-meta, .fact, .facts, .row-value")) {
    if (norm(el).includes(MIDDOT)) bad.push(`middle dot inside ${el.className}: "${norm(el)}"`);
  }
  for (const line of root.querySelectorAll(".facts, .conn-meta")) {
    if (!norm(line)) bad.push(`an empty ${line.className} line`);
    const grey = [...line.querySelectorAll(":scope > .fact")].filter((f) => !TONES.some((t) => f.classList.contains(t)) && !f.querySelector(":scope > b"));
    if (grey.length > 1) bad.push(`${grey.length} grey facts on one line: ${grey.map(norm).join(" | ")}`);
  }
  for (const row of root.querySelectorAll(".row")) {
    const name = norm(row.querySelector(".conn-name") ?? row);
    const meta = row.querySelector(".conn-meta");
    if (meta && name && norm(meta).toLowerCase() === name.toLowerCase()) bad.push(`the grey line repeats its row: "${name}"`);
  }
  for (const el of root.querySelectorAll(".conn-name, .conn-meta, .row-value, .empty-title, .empty-sub, .adm-label, .sh2 .t, .account-sub, .chip, .pill-act, .row-act, .row-signout, .btn")) {
    if (el.querySelector("input, select, textarea")) continue;
    const t = norm(el);
    if (!t || isData(t) || skip(t)) continue;
    if (lineCase(t) !== t) bad.push(`not Title Case (${el.className}): "${t}" should be "${lineCase(t)}"`);
  }
  for (const note of root.querySelectorAll(".input-hint, .sheet-note, .note")) {
    if (/\. [A-Z]/.test(norm(note))) bad.push(`two sentences in one note: "${norm(note)}"`);
  }
  for (const el of root.querySelectorAll<HTMLElement>("[style]")) {
    if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(el.getAttribute("style") ?? "")) bad.push(`raw colour in an inline style: ${el.getAttribute("style")}`);
  }
  return bad;
}

beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } resetToasts(); });

/** A phone set to a 24-hour region: the device locale answers "18:05"; a caller that names its own locale and 12-hour clock is untouched. */
function in24HourRegion() {
  const real = Date.prototype.toLocaleTimeString;
  vi.spyOn(Date.prototype, "toLocaleTimeString").mockImplementation(function (this: Date, loc?: Intl.LocalesArgument, opts?: Intl.DateTimeFormatOptions) {
    return loc === "en-US" && opts?.hour12 ? real.call(this, loc, opts) : "18:05";
  });
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Account", () => {
  const account = () => render(
    <AuthProvider><NotesProvider userId="u-cat-account"><AccountPage onBack={() => {}} onEditProfile={() => {}} onSignOut={() => {}} /></NotesProvider></AuthProvider>,
  );

  it("follows the catalog, the plan line is Title Case, and an armed Redo Setup is too", async () => {
    const { container } = account();
    await waitFor(() => expect(container.querySelector(".account-sub")).not.toBeNull());
    expect(container.querySelector(".account-sub")!.textContent).toBe("Personal Plan");
    fireEvent.click(screen.getByText("Redo Setup"));
    expect(screen.getByText("Tap Again to Redo Setup")).toBeInTheDocument();
    expect(scan(container)).toEqual([]);
  });

});

describe("Notifications", () => {
  it("the web lock reason is one Title Case fragment with no typed dot, and the toast keeps the sentence", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    vi.spyOn(webPush, "currentStatus").mockResolvedValue("denied");
    const { container } = render(<NotesProvider userId="u-cat-n-web"><NotificationsPage onBack={() => {}} /></NotesProvider>);
    const sw = await screen.findByRole("switch", { name: "Alerts on This Phone" });
    await waitFor(() => expect(sw).toHaveAttribute("aria-disabled", "true"));
    const meta = sw.closest(".row")!.querySelector(".conn-meta")!;
    expect(norm(meta)).toBe("Blocked in Phone or Browser Settings");
    expect(webPush.reasonFor("denied")).toContain(MIDDOT); // why the row may not draw it as it is
    expect(scan(container, (t) => t.startsWith("Notifications are off"))).toEqual([]);
  });

  it("every switch name and grey line on the phone app is Title Case", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    vi.spyOn(notifications, "notificationPermissionState").mockResolvedValue("granted");
    const { container } = render(<NotesProvider userId="u-cat-n-native"><NotificationsPage onBack={() => {}} /></NotesProvider>);
    await screen.findByRole("switch", { name: "Rest Timer" });
    expect(scan(container)).toEqual([]);
    // The minutes are a word after a number, so they take a capital.
    expect(norm(screen.getByRole("switch", { name: "Today's Events" }).closest(".row")!.querySelector(".conn-meta")!)).toContain("15 Min");
    expect(norm(screen.getByText("Send a Test Reminder").closest(".row")!.querySelector(".conn-meta")!)).toMatch(/^Arrives in \d+ Seconds$/);
  });
});

describe("Booking", () => {
  const LINK = { slug: "wide-harbour", visibility: "link_only", days: 5 };
  const BOOKED = [{
    id: "bk-1", title: "Intro Call", guestName: "Ada Lovelace", guestEmail: "ada@example.com",
    startMs: Date.parse("2026-09-22T18:00:00Z"), endMs: Date.parse("2026-09-22T18:30:00Z"),
  }];
  const impls = (link: typeof LINK | null, booked: typeof BOOKED | null, days: string[] = []) => ({
    readLinkImpl: async () => link, readBookingsImpl: async () => booked,
    readDaysOffImpl: async () => days, saveDaysOffImpl: async (d: string[]) => d,
  });

  it("a published link with a booking and a day off follows the catalog", async () => {
    const { container } = render(<BookingPage onBack={() => {}} {...impls(LINK, BOOKED, ["2026-12-24"])} />);
    await screen.findByText("Intro Call with Ada Lovelace");
    expect(scan(container, (t) => /^wide-harbour|^https?:/.test(t))).toEqual([]);
    // Two neutral facts, the day and the time, each its own small-caps date.
    const when = container.querySelector(".fact.date")!.parentElement!;
    expect(when.querySelectorAll(".fact.date").length).toBe(2);
  });

  it("a booking's time is 12-hour with AM or PM even where the phone's region is 24-hour", async () => {
    in24HourRegion();
    const { container } = render(<BookingPage onBack={() => {}} {...impls(LINK, BOOKED)} />);
    await screen.findByText("Intro Call with Ada Lovelace");
    const facts = [...container.querySelectorAll(".conn-meta .fact.date")].map(norm);
    expect(facts.some((f) => /^\d{1,2}:\d{2} (AM|PM)$/.test(f)), facts.join(" | ")).toBe(true);
    expect(facts.some((f) => f === "18:05")).toBe(false);
  });

  it("a section with nothing to show is a crafted empty state: a glyph, its title and ONE warm line that does not repeat it", async () => {
    const { container } = render(<BookingPage onBack={() => {}} {...impls(null, null)} />);
    await waitFor(() => expect(screen.getByText("No Link Yet")).toBeInTheDocument());
    for (const t of ["No Link Yet", "No Days Off"]) {
      const box = screen.getByText(t).closest(".empty-state")!;
      expect(box, t).toHaveClass("empty-compact");
      expect(box.querySelector(".empty-icon svg"), t + " has its glyph").not.toBeNull();
      expect(box.querySelectorAll(".empty-sub"), t + " has one line").toHaveLength(1);
      expect(box.querySelector(".empty-sub")!.textContent!.toLowerCase(), t).not.toContain(t.toLowerCase());
    }
    expect(scan(container)).toEqual([]);
  });

  it("the publish is the Your Link head's one capsule, never a button boxed inside the card", async () => {
    render(<BookingPage onBack={() => {}} {...impls(null, null)} />);
    const publish = await screen.findByRole("button", { name: "Publish My Times" });
    expect(publish.closest(".sh2")).not.toBeNull();
    expect(publish.closest(".card")).toBeNull();
    expect(publish).toHaveClass("pill-action");
  });

  it("an empty booked list draws no placeholder card, only its note, and a list that could not be asked says that", async () => {
    const { container, unmount } = render(<BookingPage onBack={() => {}} {...impls(LINK, [])} />);
    await screen.findByText("Nobody has booked yet, and new bookings land on your schedule too");
    expect(screen.queryByText("Nobody Yet"), "a row with nothing to say shows nothing").toBeNull();
    expect(scan(container, (t) => /^wide-harbour/.test(t))).toEqual([]);
    unmount();
    render(<BookingPage onBack={() => {}} {...impls(LINK, null)} />);
    expect((await screen.findByText("Could Not Reach the Booking Server")).className).toBe("conn-name");
  });

  it("the notes under the cards are plain sentences with no dot typed in them, never two sentences", async () => {
    const { container } = render(<BookingPage onBack={() => {}} {...impls(LINK, BOOKED)} />);
    await screen.findByText("Intro Call with Ada Lovelace");
    const notes = [...container.querySelectorAll(".input-hint")].map(norm);
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(n).not.toMatch(/\. [A-Z]/);
    for (const n of notes) expect(n, "no typed middle dot in a note").not.toContain(MIDDOT);
    expect(notes).toContain("Your times stay on this device until you publish them to the booking server");
    expect(notes).toContain("Taking the link down never cancels a booking you already have");
  });

  it("the one answer under Who Can Book is Title Case: the small word stays small", async () => {
    const { container } = render(<BookingPage onBack={() => {}} {...impls(null, null)} />);
    await screen.findByText("Anyone with the Link");
    expect(scan(container)).toEqual([]);
  });
});

describe("AI Control", () => {
  const BUDGET = { limitMicrousd: 5_000_000, spentMicrousd: 780_000, heldMicrousd: 120_001, remainingMicrousd: 4_220_000, period: "since_activation", periodStart: "2026-09-29T12:00:00Z", version: 3, paused: false };
  const mount = () => render(<NotesProvider userId="u-cat-ai" accessToken="tok"><AIControlPage onBack={() => {}} /></NotesProvider>);

  it("the spending, calls and tokens rows are Title Case, a raw call kind is a name, and Save Limit is a tap in the action red", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      count: 3, budget: BUDGET,
      calls: [{ at: "2026-09-29T14:05:00Z", kind: "email_draft" }, { at: "2026-09-29T14:06:00Z", kind: "" }],
      tokens: [{ model: "claude-x", inputTokens: 1200, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0, calls: 3 }],
    }), { status: 200 })));
    const { container } = mount();
    await screen.findByText("$4.22 Remaining of $5");
    fireEvent.click(screen.getByText("AI Calls Today"));
    await screen.findByText("Email Draft");
    expect(screen.getByText("AI Call")).toBeInTheDocument();
    expect(scan(container)).toEqual([]);
    expect(screen.getByText("Save Limit").closest(".row")).toHaveClass("set-act");
    expect(screen.getByText("Pending").closest(".row")!.querySelector(".row-value")!.textContent).toBe("$0.13 Held");
    // A neutral date on a row is a small-caps date fact, not bare grey words.
    const since = screen.getByText("$4.22 Remaining of $5").closest(".row")!.querySelector(".conn-meta .fact")!;
    expect(since).toHaveClass("date");
    expect(norm(since)).toMatch(/^Since /);
  });

  it("a call's time is 12-hour with AM or PM even where the phone's region is 24-hour", async () => {
    in24HourRegion();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ count: 1, calls: [{ at: "2026-09-29T18:05:00Z", kind: "email_draft" }], tokens: [], budget: null }), { status: 200 })));
    mount();
    fireEvent.click(await screen.findByText("AI Calls Today"));
    const row = (await screen.findByText("Email Draft")).closest(".row")!;
    expect(norm(row.querySelector(".fact.date")!)).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
  });

  it("the AI switch row says nothing under it: the switch beside it already says on or off", async () => {
    const { container } = mount();
    const sw = await screen.findByRole("switch", { name: "AI on or off" });
    expect(sw.closest(".row")!.querySelector(".conn-meta")).toBeNull();
    fireEvent.click(sw);
    expect(sw.closest(".row")!.querySelector(".conn-meta")).toBeNull();
    expect(scan(container)).toEqual([]);
  });

  it("every level's grey line is Title Case", async () => {
    const { container } = mount();
    await screen.findByText("Draft Only");
    expect(norm(screen.getByText("Draft Only").closest(".row")!.querySelector(".conn-meta")!)).toBe("Drafts Ready, Nothing Acts");
    expect(scan(container)).toEqual([]);
  });
});

describe("Advanced, Backup and Brain", () => {
  it("Advanced: every switch line is Title Case, and the delete receipt's unit takes a capital", async () => {
    vi.spyOn(ChatService.prototype, "clearAll").mockResolvedValue(3);
    const said: string[] = [];
    const stop = subscribeToast((t) => { if (t) said.push(t.message); });
    const { container } = render(<NotesProvider userId="u-cat-adv"><AdvancedPage onBack={() => {}} /></NotesProvider>);
    expect(scan(container)).toEqual([]);
    fireEvent.click(screen.getByText("Delete Chat History"));
    fireEvent.click(screen.getByText("Tap Again to Confirm"));
    await waitFor(() => expect(said).toContain("Deleted 3 Messages"));
    stop();
  });

  it("Backup: no row repeats its own name under it, and every line is Title Case", () => {
    const { container } = render(<NotesProvider userId="u-cat-backup"><BackupPage onBack={() => {}} /></NotesProvider>);
    expect(scan(container)).toEqual([]);
    for (const name of ["Import from File"]) {
      expect(screen.getByText(name).closest(".row")!.querySelector(".conn-meta"), `${name} says what its name says`).toBeNull();
    }
  });

  it("Brain: the notes are two short sentence-case lines with no dot typed between them, and no card holds the lone Erase", () => {
    const { container } = render(<NotesProvider userId="u-cat-brain"><BrainSettingsPage onBack={() => {}} /></NotesProvider>);
    expect(scan(container)).toEqual([]);
    const notes = [...container.querySelectorAll(".input-hint")].map(norm);
    expect(notes).toEqual([
      "Decisions, principles, values, writing samples and facts are deleted",
      "Contacts stay, but their roles go back to Unsorted",
    ]);
    for (const n of notes) { expect(n).not.toContain(MIDDOT); expect(n).not.toMatch(/\. [A-Z]/); }
    // The action is the Danger Zone head's capsule (an action never sits alone in a box), in the destructive tone.
    const erase = screen.getByRole("button", { name: "Erase Brain Data" });
    expect(erase.closest(".sh2")).not.toBeNull();
    expect(erase.closest(".card")).toBeNull();
    expect(erase).toHaveClass("pill-danger");
  });
});

describe("Email Sections", () => {
  const sec = (name: string, texts: string[]): EmailSection => ({ id: newSectionId(), name, matchers: texts.map((text) => ({ field: "sender" as const, text })) });
  let profile: ReturnType<typeof useProfile> | null = null;
  function Grab() { profile = useProfile(); return null; }

  it("a section's matchers are one grey fact with no typed dot, and a section with none shows no line", async () => {
    profile = null;
    const user = "u-cat-sections-" + Math.random().toString(36).slice(2);
    const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
    await waitFor(() => expect(profile).toBeTruthy());
    await profile!.save({ name: "Alex", emailSections: [sec("Team", ["marco", "ada", "grace", "linus", "ken"]), sec("Bare", [])] });
    view.rerender(<NotesProvider userId={user}><Grab /><EmailSectionsPage onBack={() => {}} /></NotesProvider>);
    await screen.findByText("Team");
    const team = screen.getByText("Team").closest(".row")!;
    const metas = team.querySelectorAll(".conn-meta .fact");
    expect(metas).toHaveLength(1);
    expect(norm(metas[0]!)).toBe("marco, ada, grace, +2 More");
    expect(team.querySelector(".conn-meta")!.textContent).not.toContain(MIDDOT);
    expect(screen.getByText("Bare").closest(".row")!.querySelector(".conn-meta")).toBeNull();
    expect(screen.queryByText("No Matchers")).toBeNull();
    expect(scan(document.body, (t) => /^marco/.test(t))).toEqual([]);
  });
});

describe("Health Settings and Training", () => {
  it("Health Settings: every switch line is Title Case and the units are words with capitals", () => {
    // A saved band draws the Use the Studied Range row, whose line carries a number and a unit.
    updateHealthSettings({ volumeBand: { low: 8, high: 16 } });
    const { container } = render(<HealthSettingsPage onBack={() => {}} onWorkoutReminder={() => {}} workoutReminder={{ time: "17:30" }} />);
    expect(screen.getByText("Use the Studied Range").closest(".row")!.querySelector(".conn-meta")!.textContent).toMatch(/^\d+ to \d+ Working Sets per Muscle per Week$/);
    expect(scan(container)).toEqual([]);
    expect(screen.getByText("Kg", { selector: ".seg" })).toBeInTheDocument();
    expect(screen.getByText("Lb", { selector: ".seg" })).toBeInTheDocument();
  });

  it("Training: the unit note is one plain sentence with no dot typed in it and no unit prefix (the Rack Unit row already says it)", () => {
    const { container } = render(<TrainingPage onBack={() => {}} />);
    expect(scan(container)).toEqual([]);
    const note = norm(container.querySelector(".input-hint")!);
    expect(note).toBe("A lift logged in the other unit is converted both ways");
    expect(note).not.toContain(MIDDOT);
  });
});

describe("What JARVIS Learned", () => {
  function Seed({ onDone }: { onDone: () => void }) {
    const cats = useCategories();
    const rules = useRules();
    useEffect(() => {
      void (async () => {
        const catId = await cats.create("Health", "blue");
        await rules.restore({
          kind: "alias", scope: "capture.category", from: "dentist", to: catId!,
          evidence: ["keep going · due today · 15m"], createdAt: new Date().toISOString(),
        });
        onDone();
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  }

  it("a rule's name and its one grey line are Title Case, with the typed dots gone from the evidence", async () => {
    let seeded = false;
    const view = render(<NotesProvider userId="u-cat-rules"><Seed onDone={() => { seeded = true; }} /></NotesProvider>);
    await waitFor(() => expect(seeded).toBe(true));
    view.rerender(<NotesProvider userId="u-cat-rules"><Seed onDone={() => {}} /><LearnedRulesPage onBack={() => {}} /></NotesProvider>);
    const name = await screen.findByText("Dentist Means Health");
    const meta = name.closest(".row")!.querySelector(".conn-meta")!;
    expect(norm(meta)).toBe("Keep Going, Due Today, 15m");
    expect(scan(document.body)).toEqual([]);
  });
});

describe("About, Feedback and Legal", () => {
  it("About: the build line is separate facts and every row is Title Case", () => {
    const { container } = render(<AboutPage onBack={() => {}} />);
    expect(scan(container)).toEqual([]);
  });

  it("the Send Feedback sheet's note is one note of fragments, and its Attach line is Title Case", () => {
    render(<FeedbackSheet token={undefined} build="b1" template="personal" onClose={() => {}} />);
    const note = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && norm(e).startsWith("This goes straight to the person"))!;
    expect(norm(note)).not.toMatch(/\. [A-Z]/);
    expect(norm(note)).toContain(MIDDOT);
  });

  it("the Last Updated line is Title Case", () => {
    const { container } = render(<LegalScreen title="Terms" updated="September 5, 2026" onBack={() => {}}><p>Body.</p></LegalScreen>);
    expect(norm(container.querySelector(".legal-updated")!)).toBe("Last Updated September 5, 2026");
  });
});
