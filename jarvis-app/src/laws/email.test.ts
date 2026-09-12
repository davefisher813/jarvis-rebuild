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
