// THE EMAIL TAB'S WORDS (docs/jarvis-unified, slice 05; IMPLEMENTATION-SPEC.md
// 08 E01 to E06, E20 to E23, E28, E29; 09 M1, M2, M8, M9). House style:
// Title Case fragments, a middle dot between facts, no sentence in a label.
// Every state says what is true: what was searched, what was reached, what
// is saved on this phone and what is not.

import type { SignatureField } from "./signature";
import type { MoneySemantics } from "./moneyRegistry";
import type { CalendarHit, WhyVia } from "./sections";

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
// Email v1 spec 8.1 and AC39: connected is not current. While the 90-day window is still being listed and reconciled, the
// header says so, never a time and never "Nothing in Your Inbox". When it is current, the time it was checked.
export const CATCHING_UP = "Catching Up on Mail";
// Spec microcopy (3.1, 2026-10-12): the home freshness reads "Last Checked 9:12 AM".
export const CHECKED = "Last Checked";

// Empty states: each one carries its action (law L7). 2026-10-05: every sub is Title Case, like every other line the
// app writes ("New mail lands here" was sentence case); the casing boundary names only chat, note bodies, onboarding and field notes.
export const EMPTY_INBOX = { title: "Nothing in Your Inbox", sub: "New Mail Lands Here on the Next Refresh", action: REFRESH_LABEL };
export const EMPTY_FILTER = { title: "Nothing Here Under This Area", sub: "Every Message Is Still in All", action: SHOW_ALL };
export const EMPTY_WAITING = { title: "Nothing You're Waiting On", sub: "Track a Reply from a Message and It Waits Here", action: "Show Inbox" };
export const EMPTY_SEARCH = { title: "No Matching Mail", sub: "Try a Different Search or Area", action: "Clear Search" };
export const SEARCH_FAILED = { title: "Couldn't Search Gmail", sub: "Saved Mail Was Searched · Gmail Wasn't Reached", action: "Try Again" };
export const EMPTY_ACCOUNTS = { title: "No Gmail Connected", sub: "Connect a Mailbox and Its Inbox Reads Here", action: "Add Gmail" };
export const NO_CLIENT = { title: "Email Isn't Set Up on This Build", sub: "The App Has No Database to Read Mail From", action: "Open Connections" };

// Search: provenance and coverage, said plainly (11: "never silently claim
// the entire account was searched if only a window was fetched").
export const SEARCHING_GMAIL = "Searching Gmail...";
export const SAVED_MAIL_ONLY = "Searching Saved Mail Only";
export const COVER_CACHED = "Saved Mail";
export const COVER_GMAIL = "Gmail";
export const ALL_ACCOUNTS = "All Accounts";
export const MORE_FROM_GMAIL = "More from Gmail";
export const DIDNT_ANSWER = "Didn't Answer:";
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
export const RESTORED = "Restored from Trash";
export const OPEN_GMAIL_EXACT = "Open in Gmail";
export const OPEN_GMAIL_GENERIC = "Open Gmail";
// Astra's bottom-sheet design (2026-10-10): the sheet's own kind picker behind
// Add to JARVIS. Track This reuses PRIMARY.waiting ("Track This") from
// candidates.ts rather than a second constant for the same word.
export const ADD_TO_JARVIS = "Add to JARVIS";
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
export const ONLY_TAGS = "Only Tags, Never Hides";
export const RULE_KEPT = "Remembered · " + ONLY_TAGS;
export const AREAS_LABEL = "Areas";

// Accounts (M9).
export const ACCOUNTS_TITLE = "Accounts";
export const ADD_GMAIL = "Add Gmail";
export const MAILBOXES = "Mailboxes";
export const RETENTION_NOTE = "Disconnecting Keeps Saved Mail and Every Approved Record · Only the Sign-In Goes";
// 2026-10-05: CONNECT_WHERE ("Connect and Disconnect Under Settings · Connections") is gone. It told the person where
// to go, under a screen whose rows and whose Add Gmail button already go there: a manual line, not a fact.
export const STATE_WORD: Record<"connected" | "reauth" | "disconnected", string> = {
  connected: "Connected",
  reauth: "Needs Reconnecting",
  // 2026-10-05: no "· Saved Mail Kept". The row's own "N Messages Saved" fact says it, and a dotted string cannot be a fact.
  disconnected: "Disconnected",
};

/** "3 Messages", "1 Message". */
export function messagesWord(n: number): string {
  return `${n} ${n === 1 ? "Message" : "Messages"}`;
}

// The saved signature (Email v1 spec section 6, Dave's locked decision L3): one per account, empty is valid.
export const EDIT_SIGNATURE = "Edit Signature";
export const SIGNATURE_LABEL = "Signature";
export const SIGNATURE_NOTE = "Appears Once, at the End of New Messages and Replies from This Account";
export const SIGNATURE_SAVED = "Signature Saved";
export const SIGNATURES_TITLE = "Email Signatures";
export const NO_SIGNATURE = "Not Set";
export const NO_SIGNATURE_NOTE = "No Signature for This Account";
export const ADD_SIGNATURE = "Add Signature";
export const SIGNATURES_FOOT = "Added Once, at the End of New Messages and Replies";
export const USE_SAVED_SIGNATURE = "Use Saved Signature";
export const SIGNATURE_OFFER_NOTE = "This Account's Signature Isn't in This Draft";

// The signature builder (issue 113; Dave 2026-10-13: "Upload a pic. It auto scales. Enter your info and it creates a perfect
// signature." and "It should be super simple."): a picture, six details, a preview, one Save.
export const SIG_PICTURE_LABEL = "Picture";
export const SIG_PICTURE_ADD = "Add Picture";
export const SIG_PICTURE_CHANGE = "Change Picture";
export const SIG_PICTURE_REMOVE = "Remove Picture";
export const SIG_PICTURE_NOTE = "Any Photo or Logo, It Fits Itself";
export const SIG_PICTURE_FITTING = "Fitting";
export const SIG_PICTURE_UNREADABLE = "Couldn't Read That Picture · Try Another";
export const SIG_PICTURE_SAVE_FAILED = "Couldn't Save the Picture · Try Again";
export const SIG_DETAILS_LABEL = "Your Details";
export const SIG_DETAILS_NOTE = "Anything You Leave Blank Won't Show";
export const SIG_FIELD_LABELS: Record<SignatureField, string> = { name: "Name", title: "Title", organization: "Organization", phone: "Phone", email: "Email", website: "Website" };
export const SIG_PREVIEW_LABEL = "Preview";
export const SIG_PREVIEW_NOTE = "Exactly What Goes in the Email";
export const SIG_NEEDS_DETAIL = "Add a Detail to Go with the Picture";
export const SIG_WRITE_IT = "Write It Yourself";
export const SIG_USE_BUILDER = "Use the Signature Builder";
/** The row in a draft and in Review Send that says the picture goes with this message. */
export const SIG_PICTURE_ROW = "Signature Picture";

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
export const REMOVE_ATTACHMENT = "Remove Attachment";
export const UPLOADING = "Uploading";
export const REVIEW_SEND = "Review Send";
export const CLOSE_DRAFT = "Close";
export const DISCARD_DRAFT = "Discard Draft";
export const DRAFT_DISCARDED = "Draft Discarded";
export const DRAFT_KEPT = "Draft Kept";
// Close on a composer with words in it (issue 103, 2026-10-13): never silent. The first is said only after the server
// answered; the second when the words are on this phone only (offline, a conflict, a refusal).
export const DRAFT_SAVED = "Draft Saved";
export const DRAFT_SAVED_HERE = "Draft Saved on This Device";
// The one confirm before a draft is deleted (the issue quotes the live wording "Delete this draft?"); its action is Discard Draft.
export const DISCARD_ASK = "Delete This Draft?";
export const DISCARD_OFFLINE = "Connect to Discard · The Draft Is Saved on JARVIS";
export const DRAFT_ONLY = "Draft Only · Nothing Is Sent";
export const SAVED_HERE = "Saved on This Device";
export const SAVED_LINE = "Saved";
export const SAVING_LINE = "Saving";
export const SAVE_FAILED = "Couldn't Save to JARVIS · Kept on This Device";
export const KEEP_THIS_DRAFT = "Keep This Draft";
export const USE_NEWER_DRAFT = "Use Newer Draft";
export const THIS_DEVICE = "On This Device";
export const OTHER_DEVICE = "Newer · From Another Device";
export const CONFLICT_TITLE = "Edited on Another Device";
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
// Email v1, the 30-second hold (Dave's locked decision 4). One duration; "Not Sent Yet" stays until Gmail has it.
export const HELD_TITLE = "Waiting to Send";
export const PREPARING_LINE = "Preparing to Send";
export const UNDO_SEND = "Undo";
export const UNDO_TOO_LATE = "Already Sending · Checking the Result";
export const UNDO_UNCONFIRMED = "Undo Not Confirmed · Reconnect to Check";
export const HOLD_FIRST_USE = "Sends After 30 Seconds, Even If You Close JARVIS";
export const HOLD_WINDOW = "30-Second Undo Window";
export const UNDONE_LINE = "Not Sent · Back in Your Drafts";
export const SENT_TITLE = "Sent";
export const NOT_SENT_TITLE = "Not Sent";
export const UNKNOWN_TITLE = "Send Status Unknown";
export const SENT_LINE = "Gmail Accepted It · Accepted Is Not Read";
export const SENT_FROM = "Sent From";
export const UNKNOWN_WHY = "JARVIS Couldn't Confirm Whether Gmail Accepted It · Nothing Is Resent on Its Own";
export const CHECK_AGAIN = "Check Again";
export const RESEND_SHUT = "Resend Unavailable While Unknown";
export const STILL_UNKNOWN = "Still Unknown · Not Found in Gmail Yet";
export const NOW_CONFIRMED = "Found in Gmail · Sent";
export const DRAFTS_TITLE = "Drafts";
export const SENT_FOLDER = "Sent from JARVIS";
export const EMPTY_DRAFTS = { title: "No Saved Drafts", sub: "A Message You Close Without Sending Waits Here", action: "Write a Message" };
export const FORWARD_IN_GMAIL = "Forward in Gmail";
export const FORWARD_WHY = "Forwarding and Rich Formatting Stay in Gmail";
export const SENT_BADGE = "Sent";
export const FAILED_BADGE = "Not Sent";
export const UNKNOWN_BADGE = "Unknown";
export const SENDING_BADGE = "Sending";
export const NO_SUBJECT = "(No Subject)";
export const RECIPIENTS_LABEL = "Recipients";
export const DRAFTS_AND_SENT = "Drafts and Sent from JARVIS";
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
export const DELETE_WAITING = "Delete";
/** The toast after a resolved Waiting record is deleted (Undo puts it back as it was). */
export const waitingDeleted = (title: string): string => `Deleted · ${title || "Waiting"}`;
export const DRAFT_FOLLOW_UP = "Draft Follow-Up";
export const FOLLOW_UP_DATE = "Follow-Up Date";
export const CLEAR_DATE = "Clear Date";
export const FOLLOW_UP_TODAY = "Follow Up Today";
export const NEW_REPLY = "New Reply";
export const REVIEW_REPLY = "Review Reply";
export const RESOLUTION_NOTE = "Add a Note (Optional)";
export const RESOLUTION_NOTE_LABEL = "Note";
export const SOURCE_MESSAGE = "Open Source Message";
export const SOURCE_DELETED = "Source Email Deleted · Excerpt Kept";
export const SOURCE_DISCONNECTED = "Mailbox Disconnected · Excerpt Kept";
export const TRACKED_FROM = "Tracked from an Email";
export const PICK_RECIPIENT = "Pick the Address from the Source";
export const NO_RECIPIENT = "No Address in the Source · Type One";
/** Spec 5.3: the thread or the excerpt could not be read, and the approved record survives it. */
export const ORIGINAL_UNAVAILABLE = "Original Email Unavailable";
/** Draft Follow-Up while the thread is still being read: a greyed button says why. */
export const READING_THREAD = "Reading the Thread";
// 2026-10-05: FOLLOW_UP_IS_LOCAL and REPLY_NEVER_RESOLVES are gone, and NO_FOLLOW_UP with them. Two described how the
// app works (a manual under the page, true on an empty database) and one said "no date" under an empty date field (a
// placeholder that states nothing). The behaviour is unchanged: a reply is shown and never closes anything, and a
// follow-up date is still a local reminder.
export const WAITED = "Waited";
export const FOR_LABEL = "For";
export const ACCOUNT_LABEL = "Account";
export const EMPTY_RESOLVED = { title: "Nothing Resolved Yet", sub: "Resolve a Request Here When It Arrives", action: "Show Open" };
export const EMAIL_BAND_TITLE = "Email";
export const OPEN_EMAIL = "Open Email";
// 2026-10-05: OPEN_TO_REVIEW ("Open Email to Review") is gone. It was the grey line under "5 Email Items to Review" on the Today
// band that Dave photographed: a row that already is the door says nothing under its title. It was unused, and an unused
// string is how a rule that was fixed comes back. Dead constants went with it: DRAFT_BADGE, draftsWord, sentWord, OPEN_MODULE,
// CAPTURE_DONE_ELSEWHERE (the error table owns that sentence).
export function followUpWas(monthDayWord: string): string {
  return `Follow Up Was ${monthDayWord}`;
}
export function followUpOnWord(monthDayWord: string): string {
  return `Follow Up ${monthDayWord}`;
}
// ---- the review list and the paused sends (2026-10-12, Dave's rulings) ------------------------------------------------
/** The Email surface keeps the review count (spec section 7): a quiet line on the inbox, the door to every card it counts. */
export const reviewItemsLine = (n: number): string => `${n} ${n === 1 ? "Item" : "Items"} to Review`;
export const REVIEW_LIST_TITLE = "To Review";
export const REVIEW_OPEN = "Review";
export const EMPTY_REVIEW = { title: "Nothing to Review", sub: "Cards from Your Mail Wait Here Until You Decide", action: "Show Inbox" };
/** The V10 recovery list: every send stopped before Gmail, each reviewed and approved on its own. */
export const PAUSED_TITLE = "Needs Your Review";
export const EMPTY_PAUSED = { title: "Nothing Paused", sub: "Every Send Went Out or Is Still a Draft", action: "Show Inbox" };
export const PAUSED_REASON: Record<string, string> = {
  HOLD_EXPIRED: "Held Too Long",
  APPROVAL_EXPIRED: "Approval Expired",
  NOT_APPROVED: "Approval Expired",
  PROVIDER_AUTH: "Reconnect Gmail",
};
export const PAUSED_DEFAULT = "Not Sent";

// The mail home (Email v1 spec 3.1 to 3.3, 11; Dave's ruling 2026-10-12).
export const INBOX_TITLE = "Inbox";
export const WAITING_SEGMENT_TITLE = "Waiting";
export const ALL_ACCOUNTS_PICK = "All Accounts";
export const ACCOUNT_PICK_TITLE = "Show Mail From";
export const VIEW_LABEL = "Arrange Mail";
export const VIEW_DATE = "All by Date";
export const VIEW_GROUPED = "Grouped";
// The one-time Use Grouped Mail explainer (issue 112, item 17; spec 2.2, AC01): a Title Case title and the card's one grey fact,
// with no dot and no dash between them. Show All by Date needs no string of its own: it is the arrangement control directly
// above (VIEW_DATE), equally available, so the card never draws a second copy of it.
//
// THE TITLE IS SHORT ON PURPOSE. The spec's own sentence ("Group mail by conversation, schedule, money and mailing list facts")
// was drawn through the real card at 390 wide and wrapped to THREE lines at the normal text size and FOUR at 1.4x, in the
// wide fallback face and in a Helvetica-metric one alike (issue 112 round, 2026-10-13). The five headings it lists sit
// directly under the card, so the card says what the arrangement is and the headings say which facts.
export const GROUPED_INTRO_TITLE = "Group Mail by Its Facts";
export const GROUPED_INTRO_SUB = "Nothing Is Hidden";
export const USE_GROUPED = "Use Grouped Mail";
export const SELECT = "Select";
export const CANCEL = "Cancel";
export const SELECT_SECTION = "Select";
export const DESELECT_SECTION = "Deselect";
/** Spec 3.3: the exact Message-ID is in another connected mailbox too. A label; both rows stay. */
export const SAME_CONTENT = "Same Content";
export const ALSO_IN = "Also In";
export const MOVE_TO_SECTION = "Move to Section";
export const PUT_BACK_SECTION = "Use Its Own Section";
/** The receipt after a Move to Section (issue 104): "Moved to Money", with an Undo that sets the section the message was in. */
export const movedToLine = (section: string): string => `Moved to ${section}`;
/** The receipt after Use Its Own Section: the message is back where its own facts put it. Same Undo. */
export const MOVED_BACK = "Back in Its Own Section";
// Why This Section? (issue 112, item 15; spec 3.2: "Click Why this section? for the rule and evidence"). The More menu's entry and
// the small sheet it opens. Every line is a fact the resolver really used (sections.ts whySection), written as a fragment: no
// sentence, no dot, no dash. Nothing the data cannot support is here: no sender reputation, no category, no named message.
export const WHY_SECTION = "Why This Section?";
/** The sheet's head: where the message sits, in the section's own name. */
export const whyIn = (section: string): string => `In ${section}`;
export const WHY_ROW_RULE = "Rule";
export const WHY_ROW_EVIDENCE = "Evidence";
export const WHY_ROW_WITHOUT_MOVE = "Without Your Move";
/** One line per rule, about the message and never about the sender's character. */
export const WHY_RULE: Record<WhyVia, string> = {
  moved: "You Moved It Here",
  conversation: "You Sent a Message in This Thread",
  calendar: "It Has Calendar Structure",
  money: "It Matches a Money Sender Template",
  list: "It Has a Mailing List Header",
  other: "No Section Rule Matched",
};
/** A move is kept on the phone that made it (Settings says the same: Moves stay on this phone). */
export const WHY_SAVED_HERE = "Saved on This Phone Only";
/** own_reply is one yes or no for the whole thread, so the sheet says where the sent message was found, never which one it was. */
export const WHY_SENT_FOUND = "Sent Message in Synced Mail";
export const WHY_CAL: Record<CalendarHit, string> = {
  mime: "Message Type Is Calendar",
  content_class: "Marked as a Calendar Message",
  attachment: "Calendar File Attached",
};
export const WHY_MONEY_WORD: Record<MoneySemantics, string> = { invoice: "Invoice", receipt: "Receipt", statement: "Statement" };
export const WHY_LIST = { both: "List-ID and List-Unsubscribe Headers", id: "List-ID Header", unsubscribe: "List-Unsubscribe Header" };
/** A row cached before the mail home kept its facts has nothing to go on, and says so rather than imply that a rule ran. */
export const WHY_NO_FACTS = "Facts Not Kept for This Message";
/** Two or more Money templates fit the same message: the spec leaves that to Other rather than guess between them. */
export const WHY_MONEY_AMBIGUOUS = "More Than One Money Template Fit";
// The section heading's Why This Section? (issue 112 remainder, 2026-10-13). What each section is for, in one line, then
// how many loaded messages each rule placed. Fragments, Title Case, no dot, no dash.
export const SECTION_PURPOSE: Record<"conversations" | "schedule" | "money" | "lists" | "other", string> = {
  conversations: "Threads Where You Sent a Message",
  schedule: "Mail with Calendar Structure",
  money: "Bills, Receipts and Statements from Registered Senders",
  lists: "Mail Sent to a Mailing List",
  other: "Mail No Section Rule Matched",
};
export const WHY_ROW_FOR = "For";
export const WHY_ROW_HERE = "Here Because";
export const WHY_ROW_FROM = "Senders";
export const WHY_ROW_MAILBOXES = "Mailboxes";
export const WHY_ROW_CAVEAT = "Read From";
/** "12 Messages": a count with its noun, Title Case with the number first. */
export const messagesCount = (n: number): string => `${n} ${n === 1 ? "Message" : "Messages"}`;
/** The plain answer when a section's loaded mail carries no specific reason (no facts kept): said, never filled in. */
export const WHY_SECTION_NONE = "No Specific Reason Kept for These Messages";
export const WHY_FACTS_NOT_KEPT = "Facts Not Kept";
export const TRASH_HELPER = "Moves Selected Messages to Trash.";
export const RETRY_FAILED = "Retry Failed";
export const SIGN_IN_FIRST = "Signed Out of JARVIS";
export const RECONNECT_FIRST = "Reconnect Gmail Before Acting on Its Mail";
export const NOTHING_SELECTED = "Nothing Selected";
// The contact sheet on the sender's circle (issue 112, item 14; Email v1 spec 4: "Unknown address: Not in contacts."). Every
// line is Title Case with no dot and no dash. A sender the People store cannot place says Not in Contacts; two contacts that
// carry one address say Choose Contact; nothing here claims a count, a date or a history the data does not hold.
export const CONTACT_LABEL = "Contact";
export const NOT_IN_CONTACTS = "Not in Contacts";
export const CHOOSE_CONTACT = "Choose Contact";
export const RECENT_MAIL = "Recent Mail";
export const OPEN_CONTACT = "Open Contact";
/** The sender is one of the person's own connected mailboxes: not a contact, and not a stranger either. */
export const YOUR_MAILBOX = "Your Mailbox";
/** The name a screen reader gives the sender's circle, which is a button: what it opens, and for whom. */
export const contactDoorLabel = (name: string): string => `Contact Details for ${name}`;

/** "12 Selected". */
export function selectedWord(n: number): string {
  return `${n} Selected`;
}

/** "Select All 30 Loaded": what is on the phone, never the whole mailbox. */
export function selectAllLoaded(n: number): string {
  return `Select All ${n} Loaded`;
}
