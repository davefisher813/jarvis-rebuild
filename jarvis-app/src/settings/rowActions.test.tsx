// @vitest-environment jsdom
import { useEffect } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Capacitor } from "@capacitor/core";
import { AppearanceProvider } from "../appearance/AppearanceProvider";
import { NotesProvider, useProfile, useRules } from "../data/NotesProvider";
import { AuthProvider } from "../auth/AuthProvider";
import { capsulesInCards } from "../laws/catalogCheck";
import { lineCase } from "../shared/casing";
import { newSectionId } from "../messages/emailSections";
import * as textZoom from "../appearance/textZoom";
import { extrasFor } from "../shell/destinations";
import AppearancePage from "./AppearancePage";
import EmailSectionsPage from "./EmailSectionsPage";
import ProfilePage from "./ProfilePage";
import LearnedRulesPage from "./LearnedRulesPage";
import BookingPage from "./BookingPage";
import FeedbackStylePage from "./FeedbackStylePage";
import NotificationsPage from "./NotificationsPage";
import AccountPage from "./AccountPage";
import AIControlPage from "./AIControlPage";
import AdvancedPage from "./AdvancedPage";
import BackupPage from "./BackupPage";
import BrainSettingsPage from "./BrainSettingsPage";
import TrainingPage from "./TrainingPage";
import HealthSettingsPage from "./HealthSettingsPage";
import AboutPage from "./AboutPage";
import PrivacyPage from "./PrivacyPage";
import TermsPage from "./TermsPage";
import SupportPage from "./SupportPage";
import LearningLabPage from "./LearningLabPage";
import EditTabsPage from "../more/EditTabsPage";
import MorePage from "../more/MorePage";
import SettingsPage from "../more/SettingsPage";

// ROW ACTIONS ON SETTINGS (Dave 2026-10-05, locked; docs/jarvis-unified/ROW-ACTIONS-SPEC.md).
//
// Clean rows, no pills in a card: the section-level Add rides the section's head, a form's Save is the screen's one
// filled button, a row that deletes is a swipe. And every Settings sub-page is Title Case, in the DOM it draws
// (Alfred's pass reached only Notifications; AI Control, Connections, Appearance, Data and Privacy, Edit Tabs and the
// rest were not reached).

vi.mock("../shared/toast", () => ({ showToast: vi.fn(), subscribeToast: () => () => {}, resetToasts: () => {} }));

const noop = () => {};
const norm = (e: Element) => (e.textContent ?? "").replace(/\s+/g, " ").trim();
const wrap = (ui: React.ReactElement, user = "u-ra") => (
  <AppearanceProvider><AuthProvider><NotesProvider userId={user}>{ui}</NotesProvider></AuthProvider></AppearanceProvider>
);

beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });
afterEach(() => { vi.restoreAllMocks(); });

describe("Email Sections: the Add and the form's buttons", () => {
  it("Add Section is the Sections head's capsule, and no capsule sits in a card", async () => {
    let profile: ReturnType<typeof useProfile> | null = null;
    const Grab = () => { profile = useProfile(); return null; };
    const user = "u-ra-sections";
    const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
    await waitFor(() => expect(profile).toBeTruthy());
    await profile!.save({ name: "Alex", emailSections: [{ id: newSectionId(), name: "Team Mail", matchers: [{ field: "sender", text: "marco" }] }] });
    view.rerender(<NotesProvider userId={user}><Grab /><EmailSectionsPage onBack={noop} /></NotesProvider>);
    const add = await screen.findByRole("button", { name: "Add Section" });
    expect(add.closest(".sh2"), "Add Section lives in the head").not.toBeNull();
    expect(add.closest(".card")).toBeNull();
    expect(capsulesInCards(document.body)).toEqual([]);
    // Editing: Add Matcher and Remove ride the matcher's head, Save is the one filled button below the cards.
    fireEvent.click(add);
    const addMatcher = await screen.findByRole("button", { name: "Add Matcher" });
    expect(addMatcher.closest(".sh2")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Remove Matcher 1" }).closest(".sh2")).not.toBeNull();
    const save = screen.getByRole("button", { name: "Save Section" });
    expect(save.className).toContain("btn-primary");
    expect(save.closest(".card")).toBeNull();
    expect(capsulesInCards(document.body)).toEqual([]);
  });

  it("with no sections the head and its capsule stand alone above the empty words, and no box holds only the button", async () => {
    const { container } = render(wrap(<EmailSectionsPage onBack={noop} />, "u-ra-sections-empty"));
    const add = await screen.findByRole("button", { name: "Add Section" });
    expect(add.closest(".sh2")).not.toBeNull();
    expect(await screen.findByText("No Sections Yet")).toBeInTheDocument();
    expect(container.querySelector(".empty-state button")).toBeNull();
  });
});

describe("Profile, Feedback Style, Booking, Learned Rules", () => {
  it("Profile: Save is the screen's one filled button, outside the card", () => {
    const { container } = render(wrap(<ProfilePage onBack={noop} />));
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.className).toContain("btn-primary");
    expect(save.closest(".card")).toBeNull();
    expect(capsulesInCards(container)).toEqual([]);
  });

  it("Feedback Style: Hear It carries the word Play as text in the row, not a capsule", () => {
    const { container } = render(wrap(<FeedbackStylePage onBack={noop} />));
    expect(screen.getByText("Play").className).toBe("row-ctx");
    expect(capsulesInCards(container)).toEqual([]);
  });

  it("Booking: Add a Day Off is the Days Off head's capsule, not a button inside its card", async () => {
    render(<BookingPage onBack={noop}
      readLinkImpl={async () => null} readBookingsImpl={async () => []} readDaysOffImpl={async () => []} saveDaysOffImpl={async (d: string[]) => d} />);
    const add = await screen.findByRole("button", { name: "Add a Day Off" });
    expect(add.closest(".sh2")).not.toBeNull();
    expect(add.closest(".card")).toBeNull();
    expect(capsulesInCards(document.body)).toEqual([]);
  });

  it("Learned Rules: a rule is a clean row, and Delete is the swipe's one tray button", async () => {
    let ready = false;
    const Seed = () => {
      const rules = useRules();
      useEffect(() => {
        void rules.restore({ kind: "alias", scope: "capture.category", from: "dentist", to: "Health", evidence: ['"Dentist at 3" moved to Health'], createdAt: new Date().toISOString() })
          .then(() => { ready = true; });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return null;
    };
    const user = "u-ra-rules";
    const view = render(<NotesProvider userId={user}><Seed /></NotesProvider>);
    await waitFor(() => expect(ready).toBe(true));
    view.rerender(<NotesProvider userId={user}><Seed /><LearnedRulesPage onBack={noop} /></NotesProvider>);
    const del = await screen.findByRole("button", { name: "Delete Dentist Means Health" });
    expect(del.className).toContain("task-del");
    expect(del.closest(".task-swipe")).not.toBeNull();
    expect(capsulesInCards(document.body)).toEqual([]);
  });
});

describe("Appearance", () => {
  it("is one Display head over Theme and Text Size, each said once, then a Preview of the choice", () => {
    const { container } = render(<AppearanceProvider><AppearancePage onBack={noop} /></AppearanceProvider>);
    const heads = [...container.querySelectorAll(".sh2 .t")].map(norm);
    expect(heads).toEqual(["Display", "Preview"]);
    expect(screen.getByLabelText("Theme")).toBeInTheDocument();
    expect(screen.getByLabelText("Text Size")).toBeInTheDocument();
  });

  it("the Text Size row promises the phone's own text size only once the phone can say it", async () => {
    // Today the seam answers null, so the row says only what the menu does.
    const { unmount } = render(<AppearanceProvider><AppearancePage onBack={noop} /></AppearanceProvider>);
    expect(screen.getByText("Larger Text Everywhere")).toBeInTheDocument();
    unmount();
    // The day the text-zoom plugin answers a number, Default follows the phone (the provider already applies it) and the
    // footer has to say so: a promise exists exactly when the code keeps it.
    vi.spyOn(textZoom, "readSystemTextScale").mockResolvedValue(1.2);
    render(<AppearanceProvider><AppearancePage onBack={noop} /></AppearanceProvider>);
    expect(await screen.findByText("Default Follows Your Phone")).toBeInTheDocument();
  });
});

describe("Every Settings sub-page is Title Case, in both builds", () => {
  const norm2 = (t: string | null) => (t ?? "").replace(/\s+/g, " ").trim();
  // Somebody's data (a build id, an address, a typed identifier) is not copy the app wrote.
  const isData = (t: string) => /[@/]|\.\w{2,}$|^\d{4}-\d{2}-\d{2}$|^(Build )?dev$/.test(t);
  function untitled(root: Element): string[] {
    const bad: string[] = [];
    const seen = new Set<string>();
    for (const el of root.querySelectorAll("button,.conn-name,.conn-meta,.row-value,.t,.empty-title,.account-sub,.chip,.btn,.eyebrow,.nav-title,.input-label,summary,.fact,.account-name,.empty-sub")) {
      if (el.querySelector("input,select,textarea")) continue;
      const t = norm2(el.textContent);
      if (!t || t.length > 90 || seen.has(t) || isData(t)) continue;
      seen.add(t);
      if (lineCase(t) !== t) bad.push(`"${t}" should read "${lineCase(t)}"`);
    }
    return bad;
  }
  const pages: [string, React.ReactElement][] = [
    ["More", <MorePage extras={extrasFor(["today", "life"])} onOpenExtra={noop} onNavigate={noop} />],
    ["Settings", <SettingsPage onNavigate={noop} onBack={noop} />],
    ["Appearance", <AppearancePage onBack={noop} />],
    ["Edit Tabs", <EditTabsPage tabKeys={["today", "life", "schedule"]} onToggle={noop} onReorder={noop} onBack={noop} />],
    ["Data and Privacy", <PrivacyPage onBack={noop} />],
    ["Terms", <TermsPage onBack={noop} />],
    ["Support", <SupportPage onBack={noop} />],
    ["Profile", <ProfilePage onBack={noop} />],
    ["Feedback Style", <FeedbackStylePage onBack={noop} />],
    ["Learning Lab", <LearningLabPage onBack={noop} />],
    ["Account", <AccountPage onBack={noop} onEditProfile={noop} onSignOut={noop} />],
    ["AI Control", <AIControlPage onBack={noop} />],
    ["Advanced", <AdvancedPage onBack={noop} onLearningLab={noop} />],
    ["Backup", <BackupPage onBack={noop} />],
    ["Brain", <BrainSettingsPage onBack={noop} />],
    ["Training", <TrainingPage onBack={noop} />],
    ["Health Settings", <HealthSettingsPage onBack={noop} />],
    ["About", <AboutPage onBack={noop} onTerms={noop} onPrivacy={noop} onSupport={noop} onSecret={noop} />],
    ["Notifications", <NotificationsPage onBack={noop} />],
    ["Email Sections", <EmailSectionsPage onBack={noop} />],
    ["Learned Rules", <LearnedRulesPage onBack={noop} />],
  ];
  for (const native of [false, true]) {
    for (const [name, ui] of pages) {
      it(`${name} on ${native ? "the phone app" : "the web"}`, async () => {
        vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(native);
        const { container } = render(wrap(ui, "u-ra-case-" + name));
        await new Promise((r) => setTimeout(r, 60));
        expect(untitled(container)).toEqual([]);
        expect(capsulesInCards(container), "no capsule inside a card or a row").toEqual([]);
      });
    }
  }
});
