import { Home, ListChecks, Calendar, Brain, FileText, Target, Briefcase, MessageSquare, Bell, Wallet, BarChart3, type LucideIcon } from "lucide-react";

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
  { key: "goals", label: "Life Map", Icon: Target },
  { key: "projects", label: "Projects", Icon: Briefcase },
  { key: "messages", label: "Email", Icon: MessageSquare },
  { key: "notifications", label: "Notifications", Icon: Bell },
  { key: "money", label: "Money", Icon: Wallet },
  { key: "insights", label: "Insights", Icon: BarChart3 },
];

export const DEFAULT_TABS = ["today", "tasks", "schedule", "brain"];
export const MAX_TABS = 5;

export const destOf = (key: string): Destination | undefined =>
  DESTINATIONS.find((d) => d.key === key);

// Given the chosen tab keys, return the destinations that fall into More.
export function extrasFor(tabKeys: string[]): Destination[] {
  return DESTINATIONS.filter((d) => !tabKeys.includes(d.key));
}
