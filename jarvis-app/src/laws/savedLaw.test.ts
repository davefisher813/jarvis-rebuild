// LAW: A TOAST THAT SAYS SAVED IS TELLING THE TRUTH ABOUT WHERE THE ROW IS.
//
// Dave, 2026-09-28, on the brain filing: "a filing never says Saved before it
// reaches the server". ai/brainMemory.ts:123-128 obeyed it for the two brain
// surfaces, filingSurfaces.test.ts:208 pinned it ("offline or queued, the
// toast says Will Sync, never Saved"), and nothing checked the other doors.
// The Phase 0 trust checkpoint (PHASE0-DESIGN.md D4, 2026-10-10) found 41
// toasts on Store backed writes that say Saved, Filed, Added or Done the
// moment the Store accepted the write, which offline means the row is in
// localStorage on one phone and nowhere else. A row appearing in the list
// with a landed word over it is the exact lie the checkpoint names: the
// person reads Saved, closes the app, and the write dies in the queue.
//
// The rule: a toast whose message carries a landed word either goes through
// shared/saved.ts (savedToastText, or the two brain helpers that delegate to
// it, so the rule has one body) or sits in one of four rosters, each read and
// reasoned. HONEST_RPC: the server answered before the toast fired, so Saved
// is true. DEVICE_ONLY: the thing saved lives on this phone by design and the
// words say so. SIDE_QUEUE: health and gym run their own queues and their own
// vocabulary; folding them into the Store's pending() is Dave's call.
// STORE_PENDING_RULING: a Store backed door, which today says Saved while the
// write can still be queued, and waits for Dave's ruling that Saved means on
// the server for every door (D4 names three doors for Phase 0; the rest wait).
//
// The scanner reads every showToast( and, in MessagesFlow, its private say(,
// the one toast that escapes every showToast scanner (matrix section 1). Keys
// are `file · message` (first 44 characters, the undoLaw convention), never
// file:line, because a line key goes red on any edit above it. Exact both
// ways: a new landed toast off the helper fails, and so does a rostered toast
// that moves onto the helper without leaving its roster.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}

// The words this app uses when it claims a write landed. Case does not
// matter: `${name} added to Tuesday` claims as much as "Added to Tasks".
const LANDED = /\b(saved|filed|added|done)\b/i;
// A literal that carries a landed word and takes it back in the same breath
// ("Nothing Saved", "Already Done", "Couldn't Add It · Nothing Was Saved",
// "Discarded · The Saved Session Stays") claims nothing landed, and neither
// does a question ("3 attached tasks · Any done?").
const TAKEN_BACK = /\b(nothing|not|couldn't|can't|already|isn't|aren't|stays)\b|\?\s*$/i;
// The helper and its two named delegates (D4 change 1): a message built by
// one of these says Saved only when the Store is not pending.
const HELPER = /\b(savedToastText|filedToastText|filedContactToastText)\(/;

const LITERAL = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;

/** True when some literal inside `expr` claims a write landed. */
function claimsLanded(expr: string): boolean {
  for (const m of expr.matchAll(LITERAL)) {
    const text = (m[1] ?? m[2] ?? m[3] ?? "").replace(/\$\{[^}]*\}/g, " ");
    if (LANDED.test(text) && !TAKEN_BACK.test(text)) return true;
  }
  return false;
}

/** The text of the call from `at` to its balancing close paren. */
function balanced(src: string, at: number): string {
  let depth = 0;
  for (let j = src.indexOf("(", at); j < src.length && j < at + 2500; j++) {
    if (src[j] === "(") depth++;
    else if (src[j] === ")") { depth--; if (depth === 0) return src.slice(at, j + 1); }
  }
  return src.slice(at, at + 2500);
}

/** The `message:` value of a showToast call, up to the next top level comma or brace. */
function messageExpr(call: string): string {
  const start = call.search(/message:\s*/);
  if (start === -1) return "";
  let i = start + call.match(/message:\s*/)![0].length;
  let depth = 0;
  for (; i < call.length; i++) {
    const c = call[i];
    if (c === '"' || c === "'" || c === "`") {
      // step over the literal
      for (i++; i < call.length && call[i] !== c; i++) if (call[i] === "\\") i++;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") { if (depth === 0) break; depth--; }
    else if (c === "," && depth === 0) break;
  }
  return call.slice(start, i);
}

type Site = { key: string; honest: boolean };

function landedToasts(): Site[] {
  const out: Site[] = [];
  for (const f of walk(SRC)) {
    const r = relative(SRC, f).replace(/\\/g, "/");
    if (/^(bench|testpanel|laws)\//.test(r)) continue;
    const src = readFileSync(f, "utf8");
    const needles = r === "messages/MessagesFlow.tsx" ? ["showToast(", "say("] : ["showToast("];
    for (const needle of needles) {
      let i = 0;
      for (;;) {
        const at = src.indexOf(needle, i);
        if (at === -1) break;
        i = at + needle.length;
        // `say(` must be the bare helper, not `.say(` or `sayAlreadyTask(`
        // (ChatFlow's `say("jarvis", ...)` is a chat bubble, not a toast; it
        // lives in another file, so the needle never reaches it).
        if (needle === "say(" && at > 0 && /[\w.$]/.test(src[at - 1]!)) continue;
        const call = balanced(src, at);
        let expr: string;
        let msg: string;
        if (needle === "say(") {
          // say(msg, undoable?, ms?): the first argument is the message.
          expr = messageExpr("message: " + call.slice(4, -1) + ")");
          msg = (expr.match(/["`']([^"`']{2,80})/) ?? [])[1] ?? expr.replace(/^message:\s*/, "");
        } else {
          expr = messageExpr(call);
          // The undoLaw convention: the first literal when the message opens
          // with one, else the opening of the expression.
          msg = (expr.match(/^message:\s*["`]([^"`]{2,80})/) ?? [])[1]
            ?? (expr.match(/^message:\s*[^,}]{2,60}/) ?? [])[0] ?? "";
        }
        if (!claimsLanded(expr)) continue;
        // One line per key: a message that wraps reads the same as one that does not.
        out.push({ key: `${r} · ${msg.replace(/\s+/g, " ").slice(0, 44)}`, honest: HELPER.test(expr) });
      }
    }
  }
  return out;
}

// The server answered before the toast fired. Saved is a fact here.
const HONEST_RPC: Record<string, string> = {
  "hub/HubFlow.tsx · Added Assistant · ${name}": "addManualAssistant is a Hub RPC; the toast fires on r.ok, after the server wrote the connection row",
  "messages/MessagesFlow.tsx · Saved to Drafts": "api.createDraft and api.updateDraft are Gmail calls awaited inside the try; Gmail holds the draft before the word is said",
  "notes/NotesFlow.tsx · message: type === \"photo\" ? \"Photo Added\" : ": "attachFile answers ok only after fileStore.upload reached storage AND the block write landed through the queue; a failed block write removes the upload and answers false",
  "settings/AIControlPage.tsx · Limit Saved \\u00b7 ${formatLimit(d.budget.li": "a fetch to api/ai-usage; the toast fires on r.ok with the server's own budget row in hand",
};

// The thing saved lives on this phone by design, and the words say so.
const DEVICE_ONLY: Record<string, string> = {
  "gym/GymFlow.tsx · ${cased} added": "saveCreatedLifts writes jarvis.gym.settings.v1 in localStorage (gym/settings.ts: gym state must work in the gym with no signal); nothing here is a Store write",
  "messages/MessagesFlow.tsx · Unlinked": "threadLink.ts: the project link lives on THIS device by law (N7, Dave 2026-08-20); mirrorMail copies it to the profile best effort and nothing reads that copy as truth",
  "settings/BookingPage.tsx · message: !made ? \"Saved on This Device\" : ma": "the first branch says On This Device in its own words; the Saved branches fire only when saveLink returned the server's row",
};

// Health and gym run their own queues (health/queue, gym/pending) with their
// own vocabulary. Folding those into the Store's pending() is Dave's call.
const SIDE_QUEUE: Record<string, string> = {
  "brain/CategoryDetail.tsx · Check In Saved": "healthSvc.logCheckIn writes the health module's own queue; the health rails decide what the word means there",
  "gym/GymFlow.tsx · Saved unfinished ${s.dayName} · ${monthDay(s": "queueFinished and flushPending are gym's own offline queue; the word is gym's, and the drain keeps a failed save queued",
  "gym/GymFlow.tsx · Added ${draft.name}": "patchLive adds the lift to the live session on this phone; nothing reaches the server until the workout is finished and queued",
};

// Store backed doors. Each one says Saved the moment the Store accepted the
// write, which offline means the row is in jarvis.store.queue on one phone.
// Each waits for Dave's ruling that Saved means on the server for every
// door. The Phase 0 doors (Quick Capture's Done toast, the New Task sheet's
// Saved to <Filter>) moved onto savedToastText under trust_v1 in step 5 and
// left this list; the brain filing surfaces delegate through filedToastText.
const RULING = "waits for Dave's ruling that Saved means on the server for every door";
const STORE_PENDING_RULING: Record<string, string> = {
  "bigger/BiggerPictureFlow.tsx · Check-In Saved · ": RULING + " (strandsSvc.seed)",
  "brain/BrainTop.tsx · Saved to Writing": RULING + " (strands svc.add)",
  "brain/BrainTop.tsx · message: outcome === \"full\" ? \"The Brain Is ": RULING + " (svc.accept on a derived principle; the other branch says the brain is full)",
  "brain/docs/BrainDocPage.tsx · Saved to Writing": RULING + " (strandsSvc.add)",
  "brain/manual/MemorySheet.tsx · message: svc.pending() ? \"Edited · Will Sync": "already branches on svc.pending() (Dave 2026-09-28) with its own two forms; routing it through savedToastText is Phase 0.5 housekeeping, not a word change",
  "chat/ChatFlow.tsx · Saved decision": RULING + " (decisionsSvc.create)",
  "chat/ChatFlow.tsx · message: justSaved.length === 1 ? \"Saved\" : ": RULING + " (the chat capture's Store writes)",
  "chat/ChatFlow.tsx · Filed to Money": RULING + " (filesSvc.create plus the ledger row; the upload is answered, the rows are Store writes)",
  "chat/ChatFlow.tsx · Saved to Notes": RULING + " (notes.createNote)",
  "decisions/DecisionsFlow.tsx · Rule Saved to Values · Linked to This Decisi": RULING + " (strands.add and the decision patch)",
  "gym/GymFlow.tsx · ${p.name} saved · Check days once": RULING + " (svc.createProgram from an upload)",
  "gym/GymFlow.tsx · ${week.label} added · Duplicated from ${src.": RULING + " (saveWeeks is svc.updateProgram, a Store write)",
  "gym/GymFlow.tsx · message: ok ? `${draft.name": RULING + " (saveDays is svc.updateProgram, a Store write; the else branch is the live session on this phone)",
  "gym/GymFlow.tsx · message: added.length === 1 ? `Added ${added": RULING + " (saveDays is svc.updateProgram, a Store write)",
  "messages/MessagesFlow.tsx · Added to your tasks": RULING + " (tasks.createTask, three sites: Reply Later, the ledger line and the attachment card)",
  "messages/MessagesFlow.tsx · Saved for Tonight \\u00b7 Back on Today at 6 ": RULING + " (tasks.createTask, then a device snooze)",
  "messages/MessagesFlow.tsx · Saved for Tomorrow": RULING + " (tasks.createTask)",
  "messages/MessagesFlow.tsx · Saved for ": RULING + " (tasks.createTask)",
  "messages/MessagesFlow.tsx · Filed to How You Write · Voice Sample ${coun": "already branches on brain.pending() (Dave 2026-09-28) and carries its own count form; routing it through heldText(place, count) is Phase 0.5 housekeeping, not a word change",
  "messages/MessagesFlow.tsx · Added to Your Tasks · ": RULING + " (tasks.createTask from an invite)",
  "money/screens/ReceiptsSection.tsx · Receipt Saved": RULING + " (ledger.addReceipt is a Store write; the upload before it is answered)",
  "money/screens/TrackerScreen.tsx · Budget Saved": RULING + " (svc.saveBudget)",
  "notes/NotesFlow.tsx · Added to ": RULING + " (svc.appendToDoc)",
  "notes/NotesFlow.tsx · Task Added": RULING + " (tasksSvc.createTask)",
  "notes/NotesFlow.tsx · Decision Saved": RULING + " (decisionsSvc.create)",
  "notifications/NotificationsFlow.tsx · Done": RULING + " (tasksSvc.toggleDone)",
  "onboarding/OnboardingFlow.tsx · message: ok ? \"Added to your tasks\" : \"Could": RULING + " (saveFoundTask)",
  "people/CallPrepSheet.tsx · Saved · Linked to ": RULING + " (onCaptureNote, a notes write)",
  "people/PeopleFlow.tsx · Added to Tasks": RULING + " (tasksSvc.createTask)",
  "routine/RoutineFlow.tsx · Routine Saved": RULING + " (routine.save)",
  "schedule/ScheduleFlow.tsx · message: lineCase(\"Added to \" + ev.data.titl": RULING + " (tasksSvc.createTask filed to an event)",
  "schedule/ScheduleFlow.tsx · Added to Contacts": RULING + " (peopleSvc.create)",
  "schedule/ScheduleFlow.tsx · message: lineCase(\"Added to \" + e.data.title": RULING + " (svc.editTaskIds)",
  "settings/ProfilePage.tsx · message: added > 0 ? `Switched to ${LABEL[t]": RULING + " (profile.save and categories.seedDefaults)",
  "tasks/TasksFlow.tsx · message: targets.length === 1 ? \"Done\" : lin": RULING + " (svc.toggleDone)",
  "tasks/TasksFlow.tsx · message: lineCase(parts.join(\" and \") + \" ad": RULING + " (the upload sheet's tasks and events, Store writes)",
  "tasks/TasksFlow.tsx · message: landed ? \"Added to Schedule\" : \"Cou": RULING + " (scheduleTask writes the block through the schedule Store)",
  "tasks/screens/RemindersFlow.tsx · Done · In Done for Today": RULING + " (tasks.tickReminder)",
  "tasks/screens/RemindersFlow.tsx · Reminder Settings Saved": RULING + " (profile.save; ProfileService has pending() and nothing here reads it)",
  "today/TodayFlow.tsx · message: lineCase(\"Added to \" + ev.data.titl": RULING + " (tasks.createTask filed to an event)",
  "today/TodayFlow.tsx · message: landed ? \"Added to Schedule\" : \"Cou": RULING + " (scheduleTask)",
  "today/TodayFlow.tsx · message: lineCase(\"Added to \" + e.data.title": RULING + " (schedule.editTaskIds)",
  "today/TodayFlow.tsx · message: ticked ? titleCase(ticked.text) + \"": RULING + " (tasks.tickReminder)",
  "today/TodayFlow.tsx · message: lineCase(`Added ${draft.title": RULING + " (createEventFromDraft)",
  "today/TodaySuggestions.tsx · Added to Your Tasks": RULING + " (tasksSvc.createTask)",
  "today/TodaySuggestions.tsx · Added to Your Routine": RULING + " (routineSvc.save)",
  "today/TodaySuggestions.tsx · Saved to Your Brain": RULING + " (docs.save)",
};

const ROSTERS = { HONEST_RPC, DEVICE_ONLY, SIDE_QUEUE, STORE_PENDING_RULING };

describe("LAW: a toast that says Saved is telling the truth about where the row is", () => {
  const sites = landedToasts();

  it("finds the landed toasts at all", () => {
    // If the scan goes blind every expectation below passes for free.
    expect(sites.length).toBeGreaterThanOrEqual(40);
    expect(sites.some((s) => s.key.startsWith("messages/MessagesFlow.tsx · "))).toBe(true);
  });

  it("no key sits in two rosters", () => {
    const seen = new Map<string, string>();
    for (const [name, roster] of Object.entries(ROSTERS)) {
      for (const k of Object.keys(roster)) {
        expect(seen.get(k), `${k} is in ${seen.get(k)} and ${name}`).toBeUndefined();
        seen.set(k, name);
      }
    }
  });

  it("every landed toast off the helper is rostered, and every roster entry is one", () => {
    // Three MessagesFlow sites say "Added to your tasks" word for word and
    // share a key; the roster reads as a set of messages, not of lines.
    const bare = [...new Set(sites.filter((s) => !s.honest).map((s) => s.key))].sort();
    const rostered = Object.values(ROSTERS).flatMap((r) => Object.keys(r)).sort();
    expect(bare, "a toast that says Saved before the row is on the server; route it through savedToastText, or read it and roster it")
      .toEqual(rostered);
  });

  it("every roster entry carries a reason", () => {
    for (const roster of Object.values(ROSTERS)) {
      for (const [k, why] of Object.entries(roster)) expect(why.length, k).toBeGreaterThan(20);
    }
  });
});
