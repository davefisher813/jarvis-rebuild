// THE EMAIL TAB'S WORDS (docs/jarvis-unified, slice 05; IMPLEMENTATION-SPEC.md
// 08 E01 to E06, E20 to E23, E28, E29; 09 M1, M2, M8, M9). House style:
// Title Case fragments, a middle dot between facts, no sentence in a label.
// Every state says what is true: what was searched, what was reached, what
// is saved on this phone and what is not.

export const EMAIL_TITLE = "Email";
export const SEGMENTS = [
  { key: "inbox", label: "Inbox" },
  { key: "waiting", label: "Waiting" },
] as const;
export type Segment = (typeof SEGMENTS)[number]["key"];

export const ALL_CHIP = "All";
export const SEARCH_LABEL = "Search";
export const REFRESH_LABEL = "Refresh";
export const SEARCH_PLACEHOLDER = "Search Mail";
export const LOAD_MORE = "Load More";
export const LOADING_MORE = "Loading...";
export const LOADED_SO_FAR = "Showing what's loaded so far.";
export const RETRY = "Retry";
const SHOW_ALL = "Show All";
export const PULL_HINT = "Release to Refresh";
export const REFRESHING = "Refreshing...";

// The banners. Offline keeps everything readable; reauth keeps the mail and
// asks for the one thing that fixes it.
export const OFFLINE_LINE = "Offline · Showing Saved Mail";
export const REFRESH_FAILED = "Couldn't Refresh · Showing Saved Mail";
export const REAUTH_LINE = "Gmail Needs Reconnecting · Saved Mail Is Still Here";
export const RECONNECT = "Reconnect Gmail";
export const NOT_SYNCED = "Not Synced Yet";

// Empty states: each one carries its action (law L7).
export const EMPTY_INBOX = { title: "Nothing in Your Inbox", sub: "New mail lands here on the next refresh", action: REFRESH_LABEL };
export const EMPTY_FILTER = { title: "Nothing Here Under This Area", sub: "Every message is still in All", action: SHOW_ALL };
export const EMPTY_WAITING = { title: "Nothing You're Waiting On", sub: "Track a reply from a message and it waits here", action: "Show Inbox" };
export const EMPTY_SEARCH = { title: "No Matching Mail", sub: "Try a different search or area", action: "Clear Search" };
export const SEARCH_FAILED = { title: "Couldn't Search Gmail", sub: "Saved mail was searched · Gmail wasn't reached", action: "Try Again" };
export const EMPTY_ACCOUNTS = { title: "No Gmail Connected", sub: "Connect a mailbox and its inbox reads here", action: "Add Gmail" };
export const NO_CLIENT = { title: "Email Isn't Set Up on This Build", sub: "The app has no database to read mail from", action: "Open Connections" };

// Search: provenance and coverage, said plainly (11: "never silently claim
// the entire account was searched if only a window was fetched").
export const SEARCHING_GMAIL = "Searching Gmail...";
export const SAVED_MAIL_ONLY = "Searching Saved Mail Only";
export const COVER_CACHED = "Saved Mail";
export const COVER_GMAIL = "Gmail";
export const ALL_ACCOUNTS = "All Accounts";
export const MORE_FROM_GMAIL = "More From Gmail";
export const SEARCH_RESULTS_FLOOR = "That's every match.";

// The message screen.
export const MESSAGE_TITLE = "Message";
export const MORE_LABEL = "More";
export const SHOW_HEADERS = "Show Headers";
export const HIDE_HEADERS = "Hide Headers";
export const MARK_UNREAD = "Mark as Unread";
export const MARK_READ = "Mark as Read";
export const ARCHIVE = "Archive";
export const TRASH = "Move to Trash";
export const FILE_UNDER = "File Under";
export const COPY_ID = "Copy Message Id";
export const COPIED_ID = "Message Id Copied";
export const UNDO = "Undo";
export const ARCHIVED = "Archived";
export const TRASHED = "Moved to Trash";
export const PUT_BACK = "Put Back in Inbox";
export const RESTORED = "Restored From Trash";
export const OPEN_GMAIL_EXACT = "Open in Gmail";
export const OPEN_GMAIL_GENERIC = "Open Gmail";
export const GENERIC_WHY = "Gmail Gave No Link for This Message · Opening Your Inbox Instead";
export const READ_CONFLICT = "Read Status Updated in Gmail";
export const READ_FAILED = "Couldn't Mark as Read";
export const UNREAD_FAILED = "Couldn't Mark as Unread";
export const SOURCE_GONE = "This Message Left Gmail · Showing the Saved Copy";
export const IMAGES_OFF = "Remote Images Off · Nothing Was Fetched";
export const SHOW_IMAGES = "Show Images";
export const BODY_PENDING = "Fetching the Full Message";
export const NO_BODY_OFFLINE = "Full Message Not Saved on This Phone · Connect to Read It";
export const ATTACHMENTS = "Attachments";
export const DOWNLOADING = "Downloading...";
export const ATTACHMENT_TOO_BIG = "Over the 20 MB Limit · Open in Gmail to Get It";
export const ATTACHMENT_FAILED = "Couldn't Download · Try Again";
export const ATTACHMENT_SAVED = "Saved";
export const ATTACHMENT_SHARED = "Shared";
export const UNSUPPORTED_ACTION = "Not Available for This Account";

// Areas (the app's word for a category): a chip filters, a rule only tags, Remember is the one question.
export const SUGGEST_TITLE = "Use This Area Next Time?";
export const REMEMBER = "Remember";
export const NOT_NOW = "Not Now";
export const RULE_KEPT = "Remembered · Only Tags, Never Hides";
export const AREAS_LABEL = "Areas";

// Accounts (M9).
export const ACCOUNTS_TITLE = "Accounts";
export const ADD_GMAIL = "Add Gmail";
export const RETENTION_NOTE = "Disconnecting Keeps Saved Mail and Every Approved Record · Only the Sign-In Goes";
export const CONNECT_WHERE = "Connect and Disconnect Under Settings · Connections";
export const STATE_WORD: Record<"connected" | "reauth" | "disconnected", string> = {
  connected: "Connected",
  reauth: "Needs Reconnecting",
  disconnected: "Disconnected · Saved Mail Kept",
};

/** "3 Messages", "1 Message". */
export function messagesWord(n: number): string {
  return `${n} ${n === 1 ? "Message" : "Messages"}`;
}

/** "2 Accounts", "1 Account". */
export function accountsWord(n: number): string {
  return `${n} ${n === 1 ? "Account" : "Accounts"}`;
}
