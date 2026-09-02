import { Home, ListChecks, Calendar, Brain, FileText, MessageSquare, Bell, Wallet, Sparkles, type LucideIcon } from "../shared/icons";

// Every page that can live in the bottom tab bar. Whatever the user does not put
// in the bar falls into More. "More" itself is always the fixed last tab and is
// not in this list. Order here is the canonical tab order.
export interface Destination {
  key: string;
  label: string;
  // THE BAR GETS ITS OWN WORD (Dave 2026-08-25: "when I do big picture wraps.
  // Need a work around or to change the name of bigger picture").
  //
  // The tab and the page were the same string, so a page called Bigger Picture
  // forced a tab called Bigger Picture, and at six tabs each one has about
  // 65px: four to seven characters at the tab type size. Fourteen wrapped.
  //
  // Splitting them is the fix rather than a rename. The feature keeps the
  // name it earned everywhere it has room; only the bar, which has none,
  // wears the short one. Optional, because every other destination already
  // fits and giving them all a second label would be ceremony.
  tabLabel?: string;
  Icon: LucideIcon;
}

// What the bar shows: the short word when there is one, else the real name.
export const tabLabelOf = (d: Destination): string => d.tabLabel ?? d.label;

export const DESTINATIONS: Destination[] = [
  { key: "today", label: "Today", Icon: Home },
  // LIFE (ruled 2026-09-01, "Tasks becomes Focus": "The Lens plus Lineage
  // rows", tab called Life, segments Tasks / Projects / Goals). Tasks and
  // Your Life were two tabs for one tree; they are one tab with three zoom
  // levels now, and the daily path still lands on tasks. The icon is the
  // list because that is what opens. Saved bars holding "tasks" or "bigger"
  // migrate below.
  { key: "life", label: "Life", Icon: ListChecks },
  { key: "schedule", label: "Schedule", Icon: Calendar },
  { key: "brain", label: "Brain", Icon: Brain },
  { key: "notes", label: "Notes", Icon: FileText },
  { key: "messages", label: "Email", Icon: MessageSquare },
  // Thirteen characters, and it would have wrapped exactly the way Bigger
  // Picture did the moment anyone put it in the bar. Found by the law rather
  // than by a screenshot, which is the point of writing the law.
  { key: "notifications", label: "Notifications", tabLabel: "Alerts", Icon: Bell },
  { key: "money", label: "Money", Icon: Wallet },
  { key: "chat", label: "Chat", Icon: Sparkles },
];

export const DEFAULT_TABS = ["today", "life", "schedule", "brain"];
// New users start with three tabs: fewer choices on day one, and Brain is one
// tap away in More. Persisted at onboarding completion so existing users (who
// fall back to DEFAULT_TABS above) keep their current layout untouched.
export const NEW_USER_TABS = ["today", "life", "schedule"];
export const MAX_TABS = 5;

export const destOf = (key: string): Destination | undefined =>
  DESTINATIONS.find((d) => d.key === key);

// Given the chosen tab keys, return the destinations that fall into More.
export function extrasFor(tabKeys: string[]): Destination[] {
  return DESTINATIONS.filter((d) => !tabKeys.includes(d.key));
}


// Session 6 consolidation. Life Map and Projects merged into Bigger Picture and
// the Insights page was removed (the Sunday close-out card replaces it). Saved
// tab bars still hold the retired keys, so every load repairs them: retired
// keys map forward or drop, order and de-dupe are preserved, and the result is
// capped. A saved bar must never render a tab that resolves to nothing.
// 2026-09-01: Tasks and Your Life ("bigger") became Life. A saved bar that
// held both collapses to one Life tab in the earlier one's slot.
const RETIRED: Record<string, string | null> = {
  goals: "life",
  projects: "life",
  tasks: "life",
  bigger: "life",
  insights: null,
};

export function migrateTabs(saved: string[]): string[] {
  const out: string[] = [];
  for (const key of saved) {
    const mapped = key in RETIRED ? RETIRED[key] : key;
    if (!mapped) continue;
    if (!destOf(mapped)) continue; // unknown key from a newer or older build
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out.slice(0, MAX_TABS);
}
