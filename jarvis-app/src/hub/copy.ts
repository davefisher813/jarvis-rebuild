// THE HUB'S WORDS (IMPLEMENTATION-SPEC.md 09, H1 to H7, in the house style:
// Title Case fragments, a middle dot between facts, no sentence). One place,
// so a screen and its test read the same line.

import type { AgentMode } from "../substrate/contracts";

export const HUB_TITLE = "AI Hub";
export const TABS = [
  { key: "agents", label: "Agents" },
  { key: "review", label: "Review" },
  { key: "activity", label: "Activity" },
] as const;
export type HubTab = (typeof TABS)[number]["key"];

export const BRIEF = "Your Context · Your Call";
export const AI_OFF_STILL_WORKS = "AI Off? Every Core JARVIS Tool Still Works";
export const ADMIN_OFF = "Turned Off by Admin";
// 2026-10-05 (catalog gate): the AI row's line used to say "On" under a switch
// that already shows it is on (a line that restates the row, R1) and
// "Off · Nothing Runs" with the dot baked into a string drawn in .conn-meta
// (R6). On says nothing now; Off says the one thing the switch cannot.
export const AI_OFF = "Nothing Runs";

export const EMPTY_AGENTS = { title: "No Assistant Connected", sub: "JARVIS Still Works", action: "Add Assistant" };
export const EMPTY_REVIEW = { title: "Nothing Waiting for Your Decision", sub: "New Project Suggestions Appear Here", action: "Paste a Conversation" };
export const EMPTY_ACTIVITY = { title: "Your Actions Will Appear Here", sub: "What Changed · Who Did It · Why", action: "Open Review" };

export const MODE_LABEL: Record<AgentMode, string> = { read_only: "Read Only", help_me: "Help Me", just_handle_it: "Just Handle It" };
export const MODES: AgentMode[] = ["read_only", "help_me", "just_handle_it"];

export const STATUS_WORD: Record<string, string> = {
  connected: "Connected", manual: "Manual", revoked: "Access Revoked", expired: "Expired", unavailable: "Unavailable",
};
export const TRANSPORT_WORD = { manual: "Export and Import", https: "Connected Directly" } as const;

export const REVOKE = "Revoke Access";
export const REVOKE_NOTE = "Revoking Stops Future Access · It Cannot Retrieve Anything Already Copied Outside JARVIS";
export const PREVIEW_CONTEXT = "Preview Shared Context";
export const SHARE_ONCE = "Share Once · 15 Minutes";
export const SHARE_PROJECT = "Share for This Project";
export const EXPORT_CONTEXT = "Export Shared Context";
export const PASTE_BACK = "Paste What Came Back";
export const NOTHING_SHARED = "Nothing Shared Yet";
export const PICK_PROJECT_FIRST = "Pick a Project First";
// Why Preview Shared Context is dimmed (2026-10-04): it stays tappable and says so.
export const PREVIEW_REVOKED = "Access Revoked · Nothing Left to Preview";
export const PREVIEW_AI_OFF = "AI Is Off · Turn It On to Preview";
export const PREVIEW_OFFLINE = "Offline · Connect to Preview";
export const CANCEL_SHARES_NOTHING = "Cancel Shares Nothing";
export const EXPORT_NOT_SENT = "Couldn't Share · Your Export Is Below";
export const EXPORT_COPIED = "Copied · Paste It Into Your Assistant";
export const COPY_EXPORT = "Copy Export";
export const COPY_EXPORT_FAILED = "Couldn't Copy · Select the Text Below";
export const EXPORT_CAVEAT = "A Copy Outside JARVIS Cannot Be Recalled · Revoking Does Not Reach It";

export const REVIEW_HEAD = "Save What We Decided";
export const NOT_SAVED_YET = "Not Saved Yet";
export const EXPLORATION = "Exploration · Not a Commitment";
export const SAVE_DECISION = "Save Decision";
export const EDIT_DETAILS = "Edit Details";
export const MOVE_TO_MENTIONED = "Move to Mentioned";
export const MOVE_TO_DECIDED = "Move to Decided";
export const KEEP_AS_NOTE = "Keep as Note";
export const DISMISS_SUGGESTION = "Dismiss Suggestion";
export const PASTE_CONVERSATION = "Paste or Import a Conversation";
export const REPLACE_DECISION = "Replace With a New Decision";
export const WITHDRAW_DECISION = "Withdraw Decision";
export const NEEDS_REVIEW = "Needs Review";
export const DECISION_CHANGED = "This Decision Changed · Review the Latest Version";
export const ENTERED_BY_YOU = "Entered by You";
// 2026-10-05: drawn in a row's .conn-meta, so the dot that was baked into it (R6) is a comma.
export const REPLACE_LINE = "Replace Supersedes the Earlier Version, History Stays";
export const WITHDRAW_LINE = "Withdrawn Decisions No Longer Guide New Plans · Related Records Remain";
export const DEP_CHANGED_NOTE = "A Dependency Changed · Review This Decision";
export const MARK_REVIEWED = "Mark Reviewed";

export const FILTERS = [
  { key: "all", label: "All" },
  { key: "actions", label: "Actions" },
  { key: "reads", label: "Reads" },
  { key: "drafts", label: "Drafts" },
] as const;
export type ActivityFilter = (typeof FILTERS)[number]["key"];

export const UNDO = "Undo";
export const OPEN_DESTINATION = "Open It";
export const COPY_RECEIPT = "Copy Receipt";
export const DELETE_RECEIPT = "Delete Receipt";
export const COPIED = "Copied";
export const ITEM_REMOVED = "Item Removed";
export const NOTE_NOT_FOUND = "Couldn't Open That Note";
export const UNDONE = "Undone";

/** "3 Email Items to Review" (T1, H2): the one Email fact a global surface may show. */
export function emailItemsLine(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  return n === 1 ? "1 Email Item to Review" : `${n} Email Items to Review`;
}

/** "Conflicts With Trip Budget" (06). */
export const conflictsWith = (title: string): string => `Conflicts With ${title}`;

/** The project's record count, in words the preview shows. */
export function recordsLine(n: number): string {
  return n === 1 ? "1 Record" : `${n} Records`;
}

/** The context sweep's one row (slice 09 QA): the person's own tap, because nothing here runs on a timer. */
export const SWEEP_ROW = { label: "Clear Expired Shares", meta: "Removes the Copies of Context That Have Run Out", working: "Clearing…" } as const;
export const sweepLine = (expired: number, purged: number): string =>
  expired + purged === 0 ? "Nothing Expired · All Clear"
    : `Cleared ${expired} Expired ${expired === 1 ? "Share" : "Shares"} · Removed ${purged} ${purged === 1 ? "Copy" : "Copies"}`;

/** Under the Provider card (2026-10-05): this was the fourth fact on the provider row, a sentence among greys; it is the card's note now. */
export const PROVIDER_ACK_NOTE = "Accepted Means Gmail Took It, Not That It Was Read";

/** The two always-true lines the preview's rows used to carry as a baked-dot tail (2026-10-05): its note, under the card. */
export const PREVIEW_ALWAYS = "Health, Money and Mail Are Never Shared, and a Read Receipt Is Written First";

/** The import sheet's row line (2026-10-05, R6): it had a middle dot baked into it and drew inside .conn-meta; one fragment with a comma, one grey. */
export const IMPORT_LANDS = "Everything Lands in Mentioned, Nothing Is Decided by Pasting";
