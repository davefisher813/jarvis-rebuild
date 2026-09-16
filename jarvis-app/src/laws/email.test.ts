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
    expect(effect, "keyed on every field").toMatch(/\[view, editingDraftId, draft\.to, draft\.cc, draft\.subject, draft\.body, draft\.threadId, draft\.account, draft\.inReplyTo\]/);
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
    guardedBefore(FLOW, "? await tasks.createTask(offer.title, { bill: { amount: offer.amount }, fromThread: thread.id", "the attachment offer");
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
  const CARD = read(join(SRC, "messages/ThreadStateCard.tsx"));
  it("the brief's meeting has exactly one writer, and it is the tap handler", () => {
    const at = FLOW.indexOf("const addMeetingToCalendar =");
    expect(at, "the tap handler exists").toBeGreaterThan(-1);
    const body = FLOW.slice(at, FLOW.indexOf("\n  };", at));
    expect(body, "and it is what writes the event").toMatch(/scheduleSvc\.createEvent\(m\.title/);
    // Nowhere else in the screen may write an event out of a brief.
    expect(FLOW.match(/createEvent\(m\.title/g)?.length, "one meeting writer").toBe(1);
  });
  it("nothing schedules it: no effect and no timer reaches the writer", () => {
    // Every call site of the writer must sit in a handler the person
    // pressed. An effect or a timeout around it would be the automatic
    // save he explicitly did not want.
    for (const m of FLOW.matchAll(/addMeetingToCalendar\(/g)) {
      const before = FLOW.slice(Math.max(0, m.index - 400), m.index);
      const decl = /const addMeetingToCalendar =\s*$/.test(before.trimEnd() + "");
      if (decl) continue;
      expect(before, "a call to the writer sits inside an effect or a timer")
        .not.toMatch(/useEffect\(|setTimeout\(|setInterval\(/);
    }
    // And the card itself has no lifecycle at all: it cannot fire the offer
    // for him on render.
    expect(CARD, "ThreadStateCard runs an effect").not.toMatch(/useEffect/);
  });
  it("opening the thread only LOOKS for an event, it never makes one", () => {
    const at = FLOW.indexOf("const findFiledMeeting =");
    expect(at).toBeGreaterThan(-1);
    const body = FLOW.slice(at, FLOW.indexOf("\n  }, [scheduleSvc]);", at));
    expect(body, "the load-time check writes").not.toMatch(/createEvent|updateEvent|deleteEvent/);
    expect(body, "and it reads one day, not a scan").toMatch(/eventsOn\(m\.date\)/);
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
    expect(FLOW).toMatch(/if \(!force && max === undefined && isFresh\("threads"\)\) \{/);
    const at = FLOW.indexOf('if (!force && max === undefined && isFresh("threads"))');
    const branch = FLOW.slice(at, at + 900);
    expect(branch, "and paints the rows it already has").toMatch(/loadRows\(\)/);
    // Cached is not sorted. Rows that came back without a request say
    // nothing about whether they have been triaged, and only runTriage may
    // answer that: asserting it here put unsorted mail under For You.
    expect(branch, "the cache path declares the sort done itself")
      .not.toMatch(/setTriaged\(true\)|setTriageState\("ready"\)/);
    expect(branch, "it must hand the question to runTriage").toMatch(/void runTriage\(cached\.rows\)/);
  });
  it("every expensive satellite keeps its own clock", () => {
    for (const kind of ["waiting", "sweep", "meetings"]) {
      expect(FLOW, kind + " must be gated on its own freshness")
        .toMatch(new RegExp('force \\|\\| !isFresh\\("' + kind + '"\\)'));
    }
    expect(FLOW, "drafts too").toMatch(/!draftsLoaded && !isFresh\("drafts"\)/);
  });
  it("a deliberate refresh always wins", () => {
    // Pull to refresh, Try Again and Load More all force the read.
    expect(FLOW).toMatch(/void loadThreads\(undefined, true\)/);
    expect(FLOW).toMatch(/loadThreads\(pageRef\.current \+ MAIL_PAGE, true\)/);
  });
  it("a write that changed the inbox drops what it invalidated", () => {
    expect(FLOW).toMatch(/invalidateReads\(\["waiting", "sweep"\]\)/);
  });
  it("a cached read may be stale but never old enough to be a lie", () => {
    const C = read(join(SRC, "messages/mailCache.ts"));
    expect(C).toMatch(/export const ROWS_MAX_AGE_MS/);
    const at = C.indexOf("export function loadRows");
    expect(C.slice(at, at + 700), "loadRows must refuse rows past the max age")
      .toMatch(/now - p\.ts > ROWS_MAX_AGE_MS \|\| now < p\.ts/);
  });
});
