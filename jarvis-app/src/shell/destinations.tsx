import { Home, ListChecks, Calendar, Brain, FileText, Target, MessageSquare, Bell, Wallet, Sparkles, type LucideIcon } from "lucide-react";

// Every page that can live in the bottom tab bar. Whatever the user does not put
// in the bar falls into More. "More" itself is always the fixed last tab and is
// not in this list. Order here is the canonical tab order.
export interface Destination {
  key: string;
  label: string;
  Icon: LucideIcon;
}

export const DESTINATIONS: Destination[] = [
  { key: "today", label: "Today", Icon: Home },
  { key: "tasks", label: "Tasks", Icon: ListChecks },
  { key: "schedule", label: "Schedule", Icon: Calendar },
  { key: "brain", label: "Brain", Icon: Brain },
  { key: "notes", label: "Notes", Icon: FileText },
  { key: "bigger", label: "Bigger Picture", Icon: Target },
  { key: "messages", label: "Email", Icon: MessageSquare },
  { key: "notifications", label: "Notifications", Icon: Bell },
  { key: "money", label: "Money", Icon: Wallet },
  { key: "chat", label: "Chat", Icon: Sparkles },
];

export const DEFAULT_TABS = ["today", "tasks", "schedule", "brain"];
// New users start with three tabs: fewer choices on day one, and Brain is one
// tap away in More. Persisted at onboarding completion so existing users (who
// fall back to DEFAULT_TABS above) keep their current layout untouched.
export const NEW_USER_TABS = ["today", "tasks", "schedule"];
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
const RETIRED: Record<string, string | null> = {
  goals: "bigger",
  projects: "bigger",
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
