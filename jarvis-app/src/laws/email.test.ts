import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";

// THE EMAIL LAWS (Dave's picks 2026-09-12; Email Build Master section 7,
// items 7 and the EM6/EM7 rulings). Written the session the shapes landed,
// so a row built next week cannot drift from the row he approved. Each was
// proven to bite: a violation was planted, the law went red naming it, the
// violation was removed. The commit says so.

const { join } = posix;
const SRC = join(process.cwd().replace(/\\/g, "/"), "src");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const rel = (f: string) => f.slice(SRC.length + 1);
const read = (f: string) => readFileSync(f, "utf8");
const COMPONENTS = walk(SRC).filter((f) => f.endsWith(".tsx") && !/\.test\.tsx$/.test(f) && !f.includes("/bench/") && !f.includes("/testpanel/"));
const FLOW = read(join(SRC, "messages/MessagesFlow.tsx"));
const FACTS = read(join(SRC, "messages/factsLine.tsx"));

// K.3 in messages/ (section 7, item 7). Astra law 4 scans literal .facts
// blocks; mail builds its lines through one component, so the rule lives in
// that component: the first tone stays, the rest are dropped.
describe("EMAIL law 1: a mail facts line carries at most one colour", () => {
  it("factsLine.tsx drops every tone after the first", () => {
    expect(FACTS).toMatch(/let toned = false/);
    expect(FACTS).toMatch(/const tone = f\.tone && !toned \? f\.tone : undefined/);
  });
  it("and nothing in messages/ builds a .facts line by hand", () => {
    const bad = COMPONENTS.filter((f) => rel(f).startsWith("messages/") && !rel(f).endsWith("factsLine.tsx") && /className="facts"/.test(read(f))).map(rel);
    expect(bad).toEqual([]);
  });
});

// EM7 / E-09: every offer on the Email tab is a NoticeCard. The three ad hoc
// shapes (a card over a full-width red button over a text link, twice, and
// a bare pair of buttons) are gone and may not come back.
describe("EMAIL law 2: an offer is a NoticeCard, one shape", () => {
  it("no offer-row survives in messages/", () => {
    expect(FLOW).not.toMatch(/offer-row/);
    expect(FLOW).not.toMatch(/msg-offer-line/);
  });
  it("the three offers mount NoticeCard with a capsule and a quiet alt", () => {
    for (const title of ["title={sweepSub(sweep)}", 'title={"File " + tossName(toss.sender) + " as Noise?"}', 'title="Clear Noise Automatically?"']) {
      const at = FLOW.indexOf(title);
      expect(at, title + " is an offer title").toBeGreaterThan(-1);
      const mount = FLOW.slice(FLOW.lastIndexOf("<NoticeCard", at), at + 3200);
      expect(mount, title + " carries one capsule").toMatch(/action=\{\{/);
      expect(mount, title + " carries its no as the alt").toMatch(/alt=\{\{ label: "[A-Z][a-z]/);
    }
  });
});

// EM6 / E-39: a JSX text node cannot carry a JS escape. "·" between a
// > and a < renders as a literal backslash-u, which is exactly what shipped
// on the For You empty state until 2026-09-12. Inside braces it is a string
// and fine; as bare text it is a bug.
describe("EMAIL law 3: no JSX text node carries a backslash escape", () => {
  it("every \\u sequence in a component is inside a string, never bare text", () => {
    const bad: string[] = [];
    for (const f of COMPONENTS) {
      read(f).split("\n").forEach((line, i) => {
        // A tag's closing > (no space before it: `">` or `div>` or `}>`;
        // a comparison is always written ` > ` here and an arrow is `=>`),
        // then bare text carrying a \u escape before the next < or {. Text
        // inside braces is a string and is fine.
        if (/[^\s=]>[^<{}\n]*\\u[0-9a-fA-F]{4}/.test(line)) bad.push(rel(f) + ":" + (i + 1));
      });
    }
    expect(bad).toEqual([]);
  });
});

// E-16 (section 7, item 4): the per-thread override never leaks into the
// sender rule. threadOverride.ts's own test proves the store writes no
// SenderRules entry; this pins the one place the UI writes it, so nobody
// wires Not for Me to saveRule "for consistency" later.
describe("EMAIL law 4: Not for Me corrects the thread, never the sender", () => {
  it("the override handler writes threadOverride and nothing else", () => {
    const at = FLOW.indexOf("onOverride: (b) =>");
    expect(at, "ThreadStateCard is handed an override handler").toBeGreaterThan(-1);
    const handler = FLOW.slice(at, at + 600);
    expect(handler).toMatch(/saveOverride\(thread\.id, b\)/);
    expect(handler).toMatch(/clearOverride\(thread\.id\)/);
    expect(handler, "no sender rule from a thread correction").not.toMatch(/saveRule\(/);
  });
  it("the correction is applied after the sender rule and before the VIP pass", () => {
    expect(FLOW).toMatch(/applyVips\(applyKnownPeople\(applyOverrides\(applyRules\(/);
  });
});

// E-31 (section 7, item 6): a proposed day and a due date never sit on one
// task. The catcher never emits both, and the service refuses the pair.
describe("EMAIL law 6: proposed and due never collide", () => {
  it("parseCommitment writes one or the other", () => {
    const src = read(join(SRC, "messages/commitments.ts"));
    expect(src).toMatch(/if \(\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(d\)\) \{[\s\S]{0,200}\} else if/);
  });
  it("TasksService drops a proposal when a due date is present", () => {
    const src = read(join(SRC, "tasks/TasksService.ts"));
    expect(src).toMatch(/if \(opts\.proposedDate && !data\.due\) data\.proposedDate/);
  });
});

// Push D (E-19) and Push F (E-26): the parked Sweep and the compose
// autosave are UI state that carries his prepared reply and his half-typed
// mail. Neither is an event, and no event writer may read them: the event
// log stays free of free text, wherever the text came from.
describe("EMAIL law 8: no event writer reads the sweep session or the compose draft", () => {
  const WRITERS = walk(join(SRC, "events")).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
  const STORES = ["jarvis.mail.sweep.session", "jarvis.mail.composeDraft", "messages/sweepSession", "messages/composeDraft"];
  it("the stores' keys and modules never appear under events/", () => {
    expect(WRITERS.length).toBeGreaterThan(0);
    const bad: string[] = [];
    for (const f of WRITERS) {
      const src = read(f);
      for (const s of STORES) if (src.includes(s)) bad.push(rel(f) + ": " + s);
    }
    expect(bad).toEqual([]);
  });
  it("and the store modules never emit an event", () => {
    const stores = ["messages/sweepSession.ts", "messages/composeDraft.ts"]
      .map((p) => join(SRC, p)).filter((p) => { try { statSync(p); return true; } catch { return false; } });
    expect(stores.length).toBeGreaterThan(0);
    for (const p of stores) {
      const src = read(p);
      expect(src, rel(p) + " imports the event bus").not.toMatch(/from "\.\.\/events/);
      expect(src, rel(p) + " emits").not.toMatch(/\bemit\(/);
    }
  });
});

// EM9 / E-24: the doc's fuller Standing Rules model (conditions, exceptions,
// a scope beyond the account) was the alternate option and was not chosen.
// The v2 type is exactly bucket + account + enabled, and stays that way.
describe("EMAIL law 3: Standing Rules stay sender-only", () => {
  it("SenderRule carries bucket, account and enabled, and nothing else", () => {
    const src = read(join(SRC, "messages/ruleScope.ts"));
    const m = /export interface SenderRule \{([\s\S]*?)\n\}/.exec(src);
    expect(m, "ruleScope.ts declares SenderRule").toBeTruthy();
    const fields = m![1]!.split("\n")
      .map((l) => l.replace(/\/\/.*$/, "").trim())
      .filter(Boolean)
      .map((l) => l.replace(/\??:.*$/, ""));
    expect(fields.sort()).toEqual(["account", "bucket", "enabled"]);
    for (const banned of ["condition", "exceptions", "scope"]) {
      expect(src.toLowerCase(), "no " + banned).not.toMatch(new RegExp("\\b" + banned + "s?\\??:"));
    }
  });
});

// E-26: "no autosave" narrows to "no autosave TO GMAIL". The composer keeps
// a local copy on every debounced change; Gmail Drafts is still written by
// cancelCompose alone, on the way out, exactly as EMAIL-F-14 built it.
describe("EMAIL law 1: the composer autosaves locally, and only Cancel writes Gmail Drafts", () => {
  it("every compose change reaches jarvis.mail.composeDraft.v1 through a debounced effect", () => {
    const src = read(join(SRC, "messages/composeDraft.ts"));
    expect(src).toMatch(/DRAFT_KEY = "jarvis\.mail\.composeDraft\.v1"/);
    const at = FLOW.indexOf("saveLocalDraft(draftKey(editingDraftId)");
    expect(at, "MessagesFlow autosaves the compose").toBeGreaterThan(-1);
    const effect = FLOW.slice(FLOW.lastIndexOf("useEffect(", at), at + 900);
    expect(effect, "debounced a beat behind the keystroke").toMatch(/setTimeout\(/);
    expect(effect, "keyed on every field").toMatch(/\[view, editingDraftId, draft\.to, draft\.cc, draft\.subject, draft\.body, draft\.threadId, draft\.account, draft\.inReplyTo, draft\.sourceRevision, draft\.overrides\]/);
  });
  it("cancelCompose's Gmail write path is untouched, and it is the only one", () => {
    const at = FLOW.indexOf("const cancelCompose = async () => {");
    expect(at).toBeGreaterThan(-1);
    const fn = FLOW.slice(at, at + 1400);
    expect(fn).toMatch(/if \(editingDraftId\) await api\.updateDraft\(editingDraftId, raw, draft\.threadId\);\s*else await api\.createDraft\(raw, draft\.threadId\);/);
    const writes = FLOW.match(/\b(createDraft|updateDraft)\(/g) ?? [];
    expect(writes, "Gmail Drafts is written from cancelCompose and nowhere else in MessagesFlow").toHaveLength(2);
    const store = read(join(SRC, "messages/composeDraft.ts"));
    expect(store, "the local store never touches Gmail").not.toMatch(/createDraft|updateDraft|connections\/google/);
  });
});

// E-14: a window is one day's stretch. isOpenNow never wraps past midnight,
// so a window that would is refused in the editor, with a line, before it
// can be saved and silently cut at 23:59.
describe("EMAIL law 5: windows cannot cross midnight, and the editor says so", () => {
  it("the curtain's math is unchanged and does not wrap", () => {
    const src = read(join(SRC, "messages/batching.ts"));
    expect(src).toMatch(/return w\.windows\.some\(\(x\) => mins >= x\.startMin && mins < x\.startMin \+ x\.minutes\);/);
    expect(src).toMatch(/export function crossesMidnight\(startMin: number, minutes: number\): boolean \{\s*return startMin \+ minutes > 24 \* 60;/);
  });
  it("the single-window editor refuses with an inline line and never truncates", () => {
    const sheet = read(join(SRC, "messages/WindowsSheet.tsx"));
    expect(sheet).toMatch(/const refused = crossesMidnight\(edStart, edLen\);/);
    expect(sheet, "Done does nothing while refused").toMatch(/if \(editing === null \|\| refused\) return;/);
    expect(sheet, "the line is inline, on the editor").toMatch(/\{refused && <div className="win-error" role="alert">\{MIDNIGHT_LINE\}<\/div>\}/);
    expect(sheet, "no clamp of the length to fit").not.toMatch(/Math\.min\([^)]*24 \* 60 - edStart/);
  });
});

// E-30: one task per thread, checked (not just documented) on every manual
// path. commitments.ts's catcher and the safety net dedupe on their own
// lists; the Sweep, the ledger, the attachment offer, the waiting row and
// the Later picker all ask dupTaskGuard first. The behavioral half lives in
// DeckFlow.test.tsx (Later twice, one task) and dupTaskGuard.test.ts.
describe("EMAIL law 2: every manual task path asks for an existing task first", () => {
  const guardedBefore = (src: string, anchor: string, label: string) => {
    const at = src.indexOf(anchor);
    expect(at, label + " exists").toBeGreaterThan(-1);
    const before = src.slice(Math.max(0, at - 900), at);
    expect(before, label + " asks findTaskForThread before it writes").toMatch(/await findTaskForThread\(/);
  };
  it("the Sweep's task card and its Later", () => {
    const deck = read(join(SRC, "messages/DeckFlow.tsx"));
    guardedBefore(deck, 'await tasks.createTask(plan.task.title', "Add Task & Next");
    guardedBefore(deck, "await tasks.createTask(laterTaskTitle(displayName(row.from), row.subject)", "the Sweep's Later");
  });
  it("the ledger, the attachment offer, the waiting row, and the Later picker", () => {
    guardedBefore(FLOW, "const id = await tasks.createTask(r.what, {", "the ledger's Add Task");
    guardedBefore(FLOW, "const id = await tasks.createTask(ev.title, { due: ev.date, fromThread: thread.id", "the attachment offer's all-day invite");
    // A bill offer is Money's (ledger hard rule 1): it asks the ledger for the
    // thread's bill first (fileEmailBill), and only a plain offer makes a task.
    expect(FLOW, "the attachment offer's bill never reaches createTask").not.toMatch(/createTask\(offer\.title, \{ bill/);
    expect(FLOW, "the attachment offer files its bill by thread").toMatch(/fileEmailBill\(moneyLedger, \{ vendor: displayName\(m\.from\), amount: offer\.amount/);
    guardedBefore(FLOW, "const id = await tasks.createTask(offer.title, { fromThread: thread.id", "the attachment offer's task");
    guardedBefore(FLOW, "const id = await tasks.createTask(laterTaskTitle(displayName(row.to), row.subject ?? \"\"), {\n          due: todayISO(),", "the waiting row's Add Task");
    guardedBefore(FLOW, "const id = await tasks.createTask(laterTaskTitle(displayName(r.from), r.subject), {", "the Later picker");
  });
});

// ---------------------------------------------------------------------------
// THE 2026-09-16 MAIL RULINGS (Dave, on two screenshots of an interview
// thread). Three complaints, three laws, each written the session its fix
// landed and each proven to bite before it shipped.
// ---------------------------------------------------------------------------

// "this should be EXTREMELY easy to add to the Jarvis calendar ... But I care
// more about it NOT automatically saving in my Jarvis calendar. That's the
// entire point of it being able to read my emails. It should take ACTION if I
// want it to."
//
// Reading his mail earns the OFFER. It is not a licence to write to his
// calendar. The event exists only after the tap, and the whole difference
// between the two is one line of code, so the line is nailed down here.
describe("EMAIL law 9: a meeting the mail mentions is filed only on the tap", () => {
  // REWRITTEN 2026-09-29. The offer moved out of ThreadStateCard into
  // MeetingFinishCard, and its writer out of MessagesFlow into
  // emailSchedule.addEmailMeetingOnce (one idempotent door for the card, the
  // .ics attachment and the Today notification actions). The rule is the same
  // one line: reading earns the offer, only a tap writes.
  const CARD = read(join(SRC, "messages/MeetingFinishCard.tsx"));
  const STATE_CARD = read(join(SRC, "messages/ThreadStateCard.tsx"));
  const DOOR = read(join(SRC, "messages/emailSchedule.ts"));
  it("an email's appointment has exactly one writer, and it is the one door", () => {
    expect(DOOR, "the door writes the event with its idempotency key and provenance").toMatch(/svc\.createEvent\(title, \{[\s\S]*?clientId: cid/);
    expect(DOOR.match(/svc\.createEvent\(/g)?.length, "one appointment writer").toBe(1);
    // Nowhere else in the mail screens is an appointment made out of a brief.
    expect(FLOW, "the old inline writer is gone").not.toMatch(/createEvent\(m\.title/);
    expect(FLOW, "the old inline writer is gone").not.toMatch(/const addMeetingToCalendar =/);
    expect(CARD, "the card writes through the door").not.toMatch(/createEvent\(/);
    expect(CARD).toMatch(/addEmailMeetingOnce\(/);
    // The .ics attachment offer goes through the same door.
    expect(FLOW).toMatch(/addEmailMeetingOnce\(\{ scheduleSvc, candidate: cand/);
  });
  it("the appointment card renders only when there is a Schedule service to write to", () => {
    expect(FLOW).toMatch(/\{scheduleSvc && \(\s*<MeetingFinishCard/);
    expect(FLOW.match(/<MeetingFinishCard/g)?.length, "one place draws it").toBe(1);
    // And it sits above the messages: before the thread's message list is mapped.
    expect(FLOW.indexOf("<MeetingFinishCard")).toBeLessThan(FLOW.indexOf("{thread.messages.map((m) => {"));
  });
  it("the state card has no calendar action of its own", () => {
    expect(STATE_CARD).not.toMatch(/onAddToCalendar|calendarState|Add to Calendar/);
  });
  it("nothing schedules it: no effect and no timer reaches the writer", () => {
    // Every call site of the writer must sit in a handler the person
    // pressed. An effect or a timeout around it would be the automatic
    // save he explicitly did not want.
    for (const [name, src] of [["MessagesFlow", FLOW], ["MeetingFinishCard", CARD]] as const) {
      for (const m of src.matchAll(/addEmailMeetingOnce\(/g)) {
        const before = src.slice(Math.max(0, m.index - 500), m.index);
        expect(before, name + ": a call to the writer sits inside an effect or a timer")
          .not.toMatch(/useEffect\(|setTimeout\(|setInterval\(/);
      }
    }
    // The card's one effect only LOOKS. It names no writer at all.
    const effects = [...CARD.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[/g)].map((m) => m[1]!);
    expect(effects.length, "the card looks for what is already filed").toBe(1);
    expect(effects[0]).not.toMatch(/addEmailMeetingOnce|createEvent|deleteEvent|recreateFrom|reviseFiledMeeting|applyEventDraft|moveDay|edit[A-Z]/);
    // And the state card has no lifecycle at all.
    expect(STATE_CARD, "ThreadStateCard runs an effect").not.toMatch(/useEffect/);
  });
  it("opening the thread only LOOKS for an event, it never makes one", () => {
    const at = DOOR.indexOf("export async function findFiledMeeting");
    expect(at).toBeGreaterThan(-1);
    const body = DOOR.slice(at, DOOR.indexOf("\nasync function run(", at));
    expect(body, "the load-time check writes").not.toMatch(/createEvent|updateEvent|deleteEvent|edit[A-Z]|moveDay|linkEmailIds/);
    expect(body, "and it reads the events").toMatch(/listEvents\(\)/);
  });
  it("a cancellation never deletes: nothing in the card deletes except the person's own Delete Event", () => {
    // deleteEvent appears in the card in exactly two places, Undo of its own
    // add (through the door's confirmed undo, not directly) and the sheet's
    // onDelete: never on a cancelled candidate by itself.
    const calls = [...CARD.matchAll(/scheduleSvc\.deleteEvent\(/g)];
    expect(calls.length).toBe(1);
    const at = CARD.indexOf("const removeFiled = async");
    expect(CARD.indexOf("scheduleSvc.deleteEvent(", at)).toBeGreaterThan(at);
    expect(CARD).toMatch(/onDelete=\{\(\) => void removeFiled\(sheet\.offer\)\}/);
  });
});

// "if I open up my email outside of the time window it shouldn't close every
// single time I switch screens."
//
// AppShell mounts the mail tab as `{active === "messages" && <MessagesFlow/>}`,
// so every tab switch is a full unmount. A peek held in component state died
// with it and the curtain came back down. The peek is stored, with an expiry,
// so the habit still re-forms at the next opening.
describe("EMAIL law 10: Open Anyway outlives the tab switch", () => {
  it("the peek is read from the store, not from a fresh false", () => {
    expect(FLOW).toMatch(/const \[peeked, setPeeked\] = useState\(\(\) => loadPeek\(\)\)/);
    expect(FLOW, "the peek must never be seeded as plain component state")
      .not.toMatch(/useState\(false\)[^\n]*peek/i);
  });
  it("and opening the curtain writes it with an end", () => {
    const at = FLOW.indexOf("const openAnyway =");
    expect(at).toBeGreaterThan(-1);
    const body = FLOW.slice(at, FLOW.indexOf("\n  };", at));
    expect(body).toMatch(/savePeek\(peekUntil\(windows/);
  });
  it("the peek ends: it is a window, not a switch that stays off", () => {
    const B = read(join(SRC, "messages/batching.ts"));
    const at = B.indexOf("export function loadPeek");
    expect(at).toBeGreaterThan(-1);
    expect(B.slice(at, at + 400), "loadPeek must compare the stored end to now")
      .toMatch(/until > now/);
    // Turning the windows off entirely clears it rather than leaving a
    // stale end behind for the next time they are turned on.
    expect(FLOW).toMatch(/if \(!next\.on\) \{ clearPeek\(\); setPeeked\(false\); \}/);
  });
});

// "It also shouldn't need to read my emails every time I go back to the
// screen it's killing api usage."
//
// The mount had no freshness gate at all: about 93 Gmail requests per visit,
// per account. Each pass now keeps its own clock, and only a deliberate
// refresh ignores them.
describe("EMAIL law 11: a return to the screen is not a reason to re-read the mail", () => {
  it("the inbox load answers from cache while its last read is fresh", () => {
    // 2026-09-29: the gate is per ACCOUNT now (every account's own clock), and
    // the cached rows are read per account.
    expect(FLOW).toMatch(/if \(!force && max === undefined && haveAll && list\.every\(\(\{ email \}\) => isFresh\(scopeOf\(email\), "threads"\)\)\) \{/);
    const at = FLOW.indexOf('if (!force && max === undefined && haveAll');
    const branch = FLOW.slice(at, at + 900);
    expect(branch, "and paints the rows it already has").toMatch(/const cachedRows = paint\(\)/);
    expect(FLOW, "from each account's own cache").toMatch(/loadRows\(scopeOf\(email\)\)/);
    // Cached is not sorted. Rows that came back without a request say
    // nothing about whether they have been triaged, and only runTriage may
    // answer that: asserting it here put unsorted mail under For You.
    expect(branch, "the cache path declares the sort done itself")
      .not.toMatch(/setTriaged\(true\)|setTriageState\("ready"\)/);
    expect(branch, "it must hand the question to runTriage").toMatch(/void runTriage\(cachedRows\)/);
  });
  it("and when the read is stale it paints the cache FIRST and asks Gmail the cheap question", () => {
    // Dave, 2026-09-16: "It also shouldn't need to read my emails every time
    // I go back to the screen". Stale is not a reason to blank the screen, and
    // it is not a reason to re-read thirty threads either.
    expect(FLOW).toMatch(/if \(haveAll\) \{ paint\(\); mirrorArmed\.current = true; setLoading\(false\); \} else setLoading\(true\);/);
    expect(FLOW, "the refresh is the coordinator's, not a second inbox reader").toMatch(/await refreshInboxAccounts\(userId, list,/);
    expect(FLOW, "the tab lists threads itself again").not.toMatch(/api\.listThreads\(/);
  });
  it("every expensive satellite keeps its own clock, per account", () => {
    for (const kind of ["waiting", "sweep", "meetings"]) {
      expect(FLOW, kind + " must be gated on its own freshness")
        .toMatch(new RegExp('if \\(stale\\("' + kind + '"\\)\\)'));
    }
    expect(FLOW, "and the gate is force, or ANY account's clock stale")
      .toMatch(/force \|\| list\.some\(\(\{ email \}\) => !isFresh\(scopeOf\(email\), k\)\)/);
    expect(FLOW, "drafts too").toMatch(/!draftsLoaded && !g\.apis\("mail"\)\.every\(\(\{ email \}\) => isFresh\(scopeOf\(email\), "drafts"\)\)/);
  });
  it("a clock is set by SUCCESS, never ahead of the work", () => {
    // The old shape was `markRead("waiting"); void loadWaiting();`, which is
    // how a read that failed passed for a fresh one.
    expect(FLOW).not.toMatch(/markRead\([^)]*\);\s*void (loadWaiting|runSweep|findMeetings)/);
    expect(FLOW).toMatch(/\.then\(\(ok\) => \{ if \(ok\) for \(const \{ email \} of list\) markRead\(scopeOf\(email\), k\); \}\)/);
    expect(FLOW, "the threads clock is set per account that answered")
      .toMatch(/for \(const o of out\) if \(o\.result\.ok\) markRead\(scopeOf\(o\.email\), "threads"\)/);
  });
  it("a deliberate refresh always wins", () => {
    // Pull to refresh and Try Again force the read; Load More follows the cursor.
    expect(FLOW).toMatch(/void loadThreads\(undefined, true\)/);
    expect(FLOW).toMatch(/loadMoreInbox\(scopeOf\(email\), api, MAIL_PAGE/);
  });
  it("a write that changed the inbox drops what it invalidated", () => {
    expect(FLOW).toMatch(/invalidateReads\(scopeOf\(email\), \["waiting", "sweep"\]\)/);
  });
  it("a cached read may be stale but never old enough to be a lie", () => {
    const C = read(join(SRC, "messages/mailCache.ts"));
    expect(C).toMatch(/export const ROWS_MAX_AGE_MS/);
    const at = C.indexOf("export function loadRows");
    expect(C.slice(at, at + 900), "loadRows must refuse rows past the max age")
      .toMatch(/now - c\.checkedAt > ROWS_MAX_AGE_MS/);
    expect(C, "and a timestamp from the future is not trusted").toMatch(/c\.checkedAt > now\) return null/);
  });
  it("no mail cache key is unscoped: every entry names its owner and account", () => {
    // 2026-09-29: one global row list let two accounts overwrite each other
    // and a second sign-in on the same phone read the first person's mail.
    const C = read(join(SRC, "messages/mailCache.ts"));
    for (const fn of ["loadRows", "saveRows", "mirrorRows", "clearRows", "markRead", "isFresh", "invalidate", "loadReads"]) {
      expect(C, fn + " must take the account scope").toMatch(new RegExp("export function " + fn + "\\(\\s*scope: MailScope"));
    }
    expect(C, "a fixed, global storage key").not.toMatch(/const ROWS_KEY|const READS_KEY/);
  });
  it("an emptied inbox is a cached answer, and the last archive is persisted", () => {
    const C = read(join(SRC, "messages/mailCache.ts"));
    expect(C, "loadRows must not treat zero rows as a miss").not.toMatch(/rows\.length === 0\) return null/);
    expect(FLOW, "the mirror effect must not skip an empty list").not.toMatch(/if \(rows\.length > 0\) mirrorRows/);
  });
});

// 2026-09-29: THE BRIEF'S THREE NEW READINGS ARE UNTRUSTED, AND REPLY COVERAGE
// IS LOCAL. Two rules that a later edit could quietly break, so they are
// written down as checks.
describe("EMAIL law 10: model output about a thread is checked in code before anything reads it", () => {
  const BRIEF = read(join(SRC, "messages/brief.ts"));
  const VALIDATE = read(join(SRC, "messages/briefValidate.ts"));
  it("brief.ts hands the three readings to the validators and takes no date, time or id from the model", () => {
    expect(BRIEF).toMatch(/validateMeetingCandidates\(/);
    expect(BRIEF).toMatch(/validateReplyRequirements\(/);
    expect(BRIEF).toMatch(/validateNotification\(/);
    // Ids are hashed locally from the account, thread, message and sentence.
    expect(VALIDATE).toMatch(/stableId\("mc"/);
    expect(VALIDATE).toMatch(/stableId\("rr"/);
    expect(VALIDATE, "a model-supplied id is never used").not.toMatch(/item\??\.id\b|item\[["']id["']\]/);
    // Dates and times come out of the sentence, by code, against the message's own day.
    expect(VALIDATE).toMatch(/readWhen\(quote,/);
    expect(VALIDATE, "a model-supplied date is never used").not.toMatch(/item\??\.(date|start|end|timeZone)\b|\(item as[^)]*\)\.|item\[/);
    // A claim's sentence must be inside the message it names.
    expect(VALIDATE.match(/quoteIn\(/g)?.length, "every reading checks its quote").toBeGreaterThanOrEqual(3);
  });
  it("a notification may point at a link id it was shown and never carries a URL", () => {
    expect(VALIDATE).toMatch(/links\.some\(\(l\) => l\.id === raw\.linkId\)/);
    expect(read(join(SRC, "messages/mailContracts.ts"))).toMatch(/model never supplies a URL/);
  });
});

describe("EMAIL law 11: Reply Coverage never leaves the device and never runs per keystroke", () => {
  const EVAL = read(join(SRC, "messages/replyCoverage.ts")).replace(/\/\/.*$/gm, "");
  const CARD = read(join(SRC, "messages/coverage/ReplyCoverage.tsx")).replace(/\/\/.*$/gm, "");
  it("the evaluator is a pure function: no model, no network, no storage", () => {
    for (const banned of [/\bfetch\s*\(/, /\.complete\s*\(/, /localStorage/, /sessionStorage/, /XMLHttpRequest/, /AIService/, /ensureThreadBrief/]) {
      expect(EVAL, String(banned)).not.toMatch(banned);
    }
  });
  it("the indicator never blocks or sends: it takes no send handler and touches no outbox", () => {
    expect(CARD).not.toMatch(/onSend|enqueueOutbox|disabled=\{[^}]*coverage/i);
    expect(CARD).not.toMatch(/ensureThreadBrief|\.complete\(|fetch\(/);
  });
  it("Send is not gated on coverage anywhere in the composer", () => {
    const at = FLOW.indexOf("const send = (scheduledAt?: number) => {");
    const body = FLOW.slice(at, FLOW.indexOf("\n  };", at));
    expect(body).not.toMatch(/replyReqs|coverage|evaluateCoverage|overrides/i);
    expect(FLOW).not.toMatch(/evaluateCoverage\(/);
  });
  it("the requirements are looked up when the SOURCE changes, keyed on it alone, never on the words", () => {
    const hook = read(join(SRC, "messages/useReplyRequirements.ts"));
    expect(hook).toMatch(/\}, \[key\]\);/);
    expect(hook, "typing never reaches the lookup").not.toMatch(/draftText|\.body\b/);
  });
});
