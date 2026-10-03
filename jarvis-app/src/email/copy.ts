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

// Cards (slice 06): a card proposes one effect; the person's tap commits it,
// once, with no second question. Its words name the exact effect.
export const SUGGESTIONS = "Suggestions";
export const DETAILS = "Details";
export const DISMISS = "Dismiss";
export const RESTORE = "Restore";
export const SHOW_DISMISSED = "Show Dismissed Suggestions";
export const HIDE_DISMISSED = "Hide Dismissed Suggestions";
export const FIND_DETAILS = "Find Useful Details";
export const CAPTURE_TITLE = "Capture";
export const NOT_SAVED_YET = "Not Saved Yet";
export const NEEDS_DETAILS = "Needs Details";
export const AGENT_SUGGESTION = "Assistant Suggestion";
export const EMAIL_CHANGED = "Email Changed · Review These Details";
export const REVIEW_LATEST = "Review Latest Details";
export const SAVE_CHANGES = "Save Changes";
export const KEEP_IN_EMAIL = "Keep in Email";
export const VIEW_RECEIPT = "View";
export const MAY_EXIST = "This May Already Be Saved";
export const KEEP_SEPARATE = "Keep Separate";
export const PREVIOUSLY_SAVED = "Previously Saved";
export const LATEST = "Latest";
export const SOURCE_EVIDENCE = "Source Evidence";
export const ENTERED_BY_YOU = "Entered by You";
export const FROM_THE_EMAIL = "From the Email";
export const NO_DUE_DATE = "No Due Date";
export const NOTHING_FOUND = "No Useful Details Found · Capture One by Hand";
export const CAPTURE_DONE_ELSEWHERE = "Saved From Another Device · Open It to Review";
export const OPEN_MODULE: Record<string, string> = { Money: "Open Money", Tasks: "Open Tasks", Schedule: "Open Schedule", Email: "Open Waiting" };
export const UPDATE_IN: Record<string, string> = { Money: "Open Money to Update", Tasks: "Open Tasks to Update", Schedule: "Open Schedule to Update", Email: "Open Waiting to Update" };
export const SAVES_ONLY: Record<string, string> = {
  bill: "Saves Only the Bill · Sends Nothing · Makes No Task",
  receipt: "Saves Only the Receipt · Sends Nothing",
  task: "Adds Only the Task · Sends Nothing",
  event: "Adds Only the Event · Sends Nothing",
  waiting: "Tracks Only This · Sends Nothing",
};
export const CAPTURE_KIND: Record<string, string> = { bill: "Capture a Bill", receipt: "Capture a Receipt", task: "Capture a Task", event: "Capture an Event", waiting: "Capture Something You're Waiting On" };

export function moreSuggestions(n: number): string {
  return `${n} More ${n === 1 ? "Suggestion" : "Suggestions"}`;
}
export function foundLine(n: number): string {
  return n === 0 ? NOTHING_FOUND : `Found ${n} ${n === 1 ? "Suggestion" : "Suggestions"}`;
}

// ---- compose, review, send (slice 07) ----
export const COMPOSE_LABEL = "Compose";
export const COMPOSE_TITLE = "New Message";
export const REPLY = "Reply";
export const REPLY_ALL = "Reply All";
export const FROM_LABEL = "From";
export const TO_LABEL = "To";
export const CC_LABEL = "Cc";
export const BCC_LABEL = "Bcc";
export const SUBJECT_LABEL = "Subject";
export const BODY_LABEL = "Message";
export const CC_BCC = "Cc / Bcc";
export const ATTACH = "Attach a File";
export const ATTACHMENTS_LABEL = "Attachments";
export const REMOVE_ATTACHMENT = "Remove";
export const UPLOADING = "Uploading";
export const REVIEW_SEND = "Review Send";
export const CLOSE_DRAFT = "Close";
export const DISCARD_DRAFT = "Discard Draft";
export const DRAFT_DISCARDED = "Draft Discarded";
export const DRAFT_KEPT = "Draft Kept";
export const DRAFT_ONLY = "Draft Only · Nothing Is Sent";
export const SAVED_HERE = "Saved on This Device";
export const SAVED_LINE = "Saved";
export const SAVING_LINE = "Saving";
export const SAVE_FAILED = "Couldn't Save to JARVIS · Kept on This Device";
export const KEEP_THIS_DRAFT = "Keep This Draft";
export const USE_NEWER_DRAFT = "Use Newer Draft";
export const THIS_DEVICE = "On This Device";
export const OTHER_DEVICE = "Newer · From Another Device";
export const NEEDS_RECIPIENT = "Add a Recipient Before Reviewing";
export const BAD_ADDRESS = "Check This Address";
export const OFFLINE_SEND = "Connect to Send · Your Draft Is Saved on This Device";
export const ATTACHMENTS_WAIT = "Wait for Every Attachment Before Reviewing";
export const ATTACH_NEEDS_APP = "Attachments Need the App's Storage";
export const ATTACH_TOO_MUCH = "Over 20 MB Together · Remove a File";
export const ATTACH_FAILED = "Couldn't Attach That File";
export const REVIEW_TITLE = "Review This Exact Message";
export const NOT_SENT_YET = "Not Sent Yet";
export const SEND_THIS = "Send This Message";
export const EDIT_MESSAGE = "Edit Message";
export const APPROVAL_SCOPE = "Your Approval Covers Only This Account, These Recipients and This Exact Message";
export const EMPTY_SUBJECT_WARN = "No Subject";
export const EMPTY_BODY_WARN = "Empty Message";
export const REVIEW_EXPIRED = "Approval Expired · Review It Again";
export const REVIEW_AGAIN = "Review Again";
export const SENDING_LINE = "Sending";
export const SENT_TITLE = "Sent";
export const NOT_SENT_TITLE = "Not Sent";
export const UNKNOWN_TITLE = "Send Status Unknown";
export const SENT_LINE = "Gmail Accepted It · Accepted Is Not Read";
export const SENT_FROM = "Sent From";
export const UNKNOWN_WHY = "JARVIS Couldn't Confirm Whether Gmail Accepted It · Nothing Is Resent on Its Own";
export const CHECK_GMAIL = "Check Gmail Before Trying Again";
export const CHECK_AGAIN = "Check Again";
export const RESEND_SHUT = "Resend Unavailable While Unknown";
export const STILL_UNKNOWN = "Still Unknown · Not Found in Gmail Yet";
export const NOW_CONFIRMED = "Found in Gmail · Sent";
export const DRAFTS_TITLE = "Drafts";
export const SENT_FOLDER = "Sent From JARVIS";
export const EMPTY_DRAFTS = { title: "No Saved Drafts", sub: "A message you close without sending waits here", action: "Write a Message" };
export const EMPTY_SENT = { title: "No Messages Sent From JARVIS Yet", sub: "Every send you approve is listed here with its receipt", action: "Write a Message" };
export const FORWARD_IN_GMAIL = "Forward in Gmail";
export const FORWARD_WHY = "Forwarding and Rich Formatting Stay in Gmail";
export const SENT_BADGE = "Sent";
export const FAILED_BADGE = "Not Sent";
export const UNKNOWN_BADGE = "Unknown";
export const SENDING_BADGE = "Sending";
export const DRAFT_BADGE = "Draft";
export const NO_SUBJECT = "(No Subject)";
export const RECIPIENTS_LABEL = "Recipients";
export function draftsWord(n: number): string {
  return `${n} ${n === 1 ? "Draft" : "Drafts"}`;
}
export function sentWord(n: number): string {
  return `${n} Sent`;
}
export const DRAFTS_AND_SENT = "Drafts and Sent From JARVIS";
export const VIEW_RECEIPT_LONG = "View Receipt";

// ---- Waiting, and Email on Today (slice 08) ----
export const WAITING_TITLE = "Waiting";
export const OPEN_VIEW = "Open";
export const RESOLVED_VIEW = "Resolved";
export const WAITING_ON = "Waiting On";
export const SINCE = "Since";
export const RESOLVE = "Resolve";
export const REOPEN = "Reopen";
export const RESOLVED_WORD = "Resolved";
export const DRAFT_FOLLOW_UP = "Draft Follow-Up";
export const FOLLOW_UP_DATE = "Follow-Up Date";
export const CLEAR_DATE = "Clear Date";
export const NO_FOLLOW_UP = "No Follow-Up Date";
export const FOLLOW_UP_TODAY = "Follow Up Today";
export const NEW_REPLY = "New Reply";
export const REVIEW_REPLY = "Review Reply";
export const RESOLUTION_NOTE = "Add a Note (Optional)";
export const RESOLUTION_NOTE_LABEL = "Note";
export const SOURCE_MESSAGE = "Open Source Message";
export const SOURCE_DELETED = "Source Email Deleted · Excerpt Kept";
export const SOURCE_DISCONNECTED = "Mailbox Disconnected · Excerpt Kept";
export const TRACKED_FROM = "Tracked From an Email";
export const PICK_RECIPIENT = "Pick the Address From the Source";
export const NO_RECIPIENT = "No Address in the Source · Type One";
export const FOLLOW_UP_IS_LOCAL = "A Follow-Up Date Is a Reminder Here · Not a Task, Not an Event";
export const REPLY_NEVER_RESOLVES = "A Reply Never Resolves This on Its Own";
export const EMPTY_RESOLVED = { title: "Nothing Resolved Yet", sub: "Resolve a request here when it arrives", action: "Show Open" };
export const REVIEW_FILTER = "Showing Items to Review";
export const SHOW_ALL_ROWS = "Show All";
export const EMAIL_BAND_TITLE = "Email";
export const OPEN_EMAIL = "Open Email";
export const OPEN_TO_REVIEW = "Open Email to Review";
export function followUpWas(monthDayWord: string): string {
  return `Follow Up Was ${monthDayWord}`;
}
export function followUpOnWord(monthDayWord: string): string {
  return `Follow Up ${monthDayWord}`;
}
export function countWord(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
