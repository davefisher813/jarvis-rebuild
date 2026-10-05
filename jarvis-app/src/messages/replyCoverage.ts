import type { ReplyRequirement } from "./mailContracts";
import { withoutQuoted } from "./briefSource";
import { readWhen } from "./meetingRead";

// REPLY COVERAGE: DID THIS DRAFT ANSWER WHAT WAS ASKED (2026-09-29).
//
// A reply that forgets one of four questions costs a second email and a
// day. The brief already read the conversation once and listed what the
// people writing are waiting to hear (replyRequirements). This is the other
// half: a LOCAL check of the words being typed against that list, cheap enough
// to run on every keystroke because it is a pure function of two strings and
// an attachment list.
//
// It is a checklist, never a gate. Nothing here blocks Send, sends, or asks
// anything of a model or a network: it takes what it is handed and returns
// what it thinks, and every "answered" it is unsure of is shown as unsure.
//
// Laws:
//   - A TOPIC WORD ALONE IS NOT AN ANSWER. Typing "waiver" answers nothing.
//     An answer is an explicit choice, value or commitment that comes with
//     evidence about the thing asked: "yes you can publish", "four players",
//     "Tuesday works". A topic with no response beside it stays open.
//   - AN ATTACHMENT COUNTS ONLY IF ATTACHED. The word "attached" in the body
//     is a claim, and with no file it is called out as one ("Nothing Is
//     Attached"). "Can't send the waiver until Friday" ADDRESSES the ask (a
//     reply may decline or defer) and never means it was attached.
//   - NEGATION AND RETRACTION WIN. "Tuesday doesn't work" is not Tuesday, and
//     "Tuesday works, actually no" is not either. A target that flips back to
//     yes after a no is uncertain, not answered.
//   - AMBIGUOUS PROSE STAYS OPEN. "Maybe", "we'll see", a bare "yes" with
//     nothing to say what it is a yes to: uncertain, until the person marks it
//     answered themselves.
//   - QUOTES AND SIGNATURES ARE NOT THE REPLY. Quoted history, a valediction
//     block and "Sent from my iPhone" are removed before anything is read.
//   - IT MOVES BOTH WAYS. Delete the sentence and the check goes back.

export type CoverageStatus = "addressed" | "open" | "uncertain";
export type CoverageOverride = "addressed" | "open";
export type CoverageOverrides = Readonly<Record<string, CoverageOverride>>;

/** What is actually attached to the draft: the file names the body cannot fake. */
export interface AttachmentFact { filename: string; mime?: string }

export interface CoverageItem {
  requirement: ReplyRequirement;
  status: CoverageStatus;
  /** How it was decided: the words, an attached file, or the person's own mark. */
  via: "text" | "attachment" | "override" | "none";
  /** False for a reply that addressed the ask by declining or deferring it. */
  completes: boolean;
  /** A short fragment for the checklist: "Says Tuesday", "Deferred", "Nothing Is Attached". */
  note: string;
}

export interface CoverageResult {
  items: CoverageItem[];
  /** How many are addressed. Uncertain ones are not counted. */
  answered: number;
  uncertain: number;
  total: number;
}

/** The key an override is stored under. Stable across reopens: the requirement's own id. */
export function coverageKey(req: Pick<ReplyRequirement, "id">): string {
  return req.id;
}

// ---------------------------------------------------------------------------
// Normalising the draft
// ---------------------------------------------------------------------------

const VALEDICTION = /^\s*(best|best regards|kind regards|regards|warm regards|thanks|thank you|many thanks|thanks again|cheers|sincerely|warmly|talk soon|take care|yours|yours truly|respectfully)[,.!]?\s*$/i;
const SIG_LINE = /^\s*(--|__+)\s*$|^\s*sent from my (iphone|ipad|android|phone|mobile)|^\s*get outlook for/i;

const CONTRACTIONS: [RegExp, string][] = [
  [/\bcan't\b/g, "cannot"], [/\bcannot\b/g, "cannot"], [/\bwon't\b/g, "will not"], [/\bshan't\b/g, "shall not"],
  [/\bain't\b/g, "is not"], [/\blet's\b/g, "let us"],
  [/\b(\w+)n't\b/g, "$1 not"], [/\bi'm\b/g, "i am"], [/\b(\w+)'ll\b/g, "$1 will"], [/\b(\w+)'ve\b/g, "$1 have"],
  [/\b(\w+)'re\b/g, "$1 are"], [/\b(\w+)'d\b/g, "$1 would"], [/\b(it|that|there|here|he|she|what)'s\b/g, "$1 is"],
];

/**
 * The reply as words to be read: quoted history and the signature removed,
 * lower case, curly quotes flattened, contractions spelled out ("can't" is
 * "cannot", "don't" is "do not"), and punctuation kept only where it ends a
 * clause. Deterministic and cheap.
 */
export function normalizeReplyText(text: string): string {
  const body = withoutQuoted(text || "");
  const lines: string[] = [];
  for (const line of body.split("\n")) {
    // Everything from the first signature marker or closing valediction on is the sign-off.
    if (SIG_LINE.test(line) || VALEDICTION.test(line)) break;
    lines.push(line);
  }
  let t = lines.join("\n")
    .normalize("NFKC")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase();
  for (const [re, to] of CONTRACTIONS) t = t.replace(re, to);
  return t
    .replace(/[^a-z0-9.!?;,:\n\s/'-]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

// A clause is the unit a cue and a topic must share. Sentence enders, commas,
// semicolons, line breaks and the words that turn a sentence around split it.
function clausesOf(norm: string): string[] {
  return norm
    .split(/[.!?;\n]+|,|\bbut\b|\bhowever\b|\bthough\b|\bexcept\b|\balthough\b/)
    .map((c) => c.replace(/[:'"]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const tokensOf = (clause: string): string[] => clause.split(/[^a-z0-9]+/).filter(Boolean);

// Just enough stemming that "players" is "player" and "published" is "publish".
function stem(w: string): string {
  let s = w;
  if (s.length > 4 && s.endsWith("ies")) return s.slice(0, -3) + "y";
  if (s.length > 4 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("es") && /(ss|sh|ch|x|z)es$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  if (s.length > 3 && s.endsWith("e")) s = s.slice(0, -1);
  return s;
}

const termStems = (term: string): string[] => tokensOf(term.toLowerCase()).map(stem);

function indexOfTerm(toks: readonly string[], term: string): number {
  const ts = termStems(term);
  if (ts.length === 0) return -1;
  const st = toks.map(stem);
  for (let i = 0; i + ts.length <= st.length; i++) {
    let ok = true;
    for (let j = 0; j < ts.length; j++) if (st[i + j] !== ts[j]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

const hasAny = (toks: readonly string[], terms: readonly string[]) => terms.some((t) => indexOfTerm(toks, t) >= 0);

// ---------------------------------------------------------------------------
// Cues
// ---------------------------------------------------------------------------

const AFFIRM = /\b(yes|yep|yeah|yup|sure|ok|okay|fine|agreed|approved|absolutely|definitely|certainly|of course|go ahead|you can|you may|you could|feel free|works|work for us|sounds good|sounds great|that works|happy to|glad to|confirmed|confirm|granted|good to go|all set|please do|affirm|permission granted)\b/;
const NEGATE = /\b(no|not|never|cannot|unable|nope|nor|neither|decline|refuse|refused|declined)\b/;
const HEDGE = /\b(maybe|perhaps|possibly|might|probably|not sure|unsure|depends|tentative|tentatively|we will see|i will see|will see|if possible|if we can|hopefully|i think|i guess|tbd|to be determined|not certain|no idea)\b/;
const DEFER = /\b(until|later|next week|next month|tomorrow|tonight|soon|shortly|after|by (?:mon|tue|wed|thu|fri|sat|sun)\w*|this week|end of (?:the )?(?:day|week)|eod|once i|when i|will let you know|get back to you|circle back|working on)\b/;
const COMMIT = /\b(i will|we will|will do|i can|we can|i would|we would|count on|promise|going to|plan to|planning to|on it|will be there|will bring|will send|will confirm|will get)\b/;
const CLAIM = /\b(attached|attaching|attachment|enclosed|enclosing|here is|here are|see attached|sending|sent|forwarded|included|including)\b/;
const RETRACT = /\b(scratch that|never mind|nevermind|disregard|ignore that|ignore what|forget that|forget it|correction|take that back|second thought|actually no|no wait|wait no)\b/;
const EITHER = /\b(either|both|any of|whichever|all of them|any day|any time|whatever works)\b/;

// A clause that is nothing but a yes or a no, so it answers whatever named the
// thing beside it and cannot be pinned on any one ask by itself. "Tuesday works"
// is not one: it names a day.
const PURE = /^(?:(?:yes|yep|yeah|yup|sure|ok|okay|no|nope|fine|absolutely|definitely|certainly|agreed|of|course|go|ahead|please|thanks|thank|you|sounds|good|great|that|works|it|is|do|not|sorry|unfortunately|cannot|affirm|problem|worries)\s*)+$/;

/** "no problem" and "no worries" say yes with the word no in them. */
const flatten = (c: string): string => c.replace(/\bno (problem|worries|issue|issues|rush)\b/g, "affirm $1");

const isNeg = (c: string): boolean => NEGATE.test(flatten(c).replace(HEDGE, " hedge "));
const isHedge = (c: string): boolean => HEDGE.test(c);

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
};
const numberAt = (tok: string): number | null => {
  if (/^\d{1,3}$/.test(tok)) return Number(tok);
  return tok in NUMBER_WORDS ? NUMBER_WORDS[tok]! : null;
};

const SIGNAL_DAY = new Date(Date.UTC(2026, 0, 5)); // a fixed Monday; only "is there a day or a time in it" is asked
const dayIso = SIGNAL_DAY.toISOString().slice(0, 10);
/** Does the clause name a day, a date or a clock time at all? */
const namesWhen = (clause: string): boolean => readWhen(clause, dayIso).signals;

// ---------------------------------------------------------------------------
// Matching, one requirement at a time
// ---------------------------------------------------------------------------

interface Verdict { status: CoverageStatus; completes: boolean; note: string; via: "text" | "attachment" | "none" }
const OPEN: Verdict = { status: "open", completes: false, note: "", via: "none" };

type Ev = "pos" | "neg" | "hedge";
const evOf = (clause: string): Ev => (RETRACT.test(clause) || isNeg(clause) ? "neg" : isHedge(clause) ? "hedge" : "pos");

function judgeChoice(req: ReplyRequirement, clauses: string[]): Verdict {
  const choices = req.match.choices ?? [];
  const last = new Map<string, Ev>();
  const seen = new Map<string, Set<Ev>>();
  let touched: string[] = [];
  let either = false;
  clauses.forEach((clause) => {
    const toks = tokensOf(clause);
    const hit = choices.filter((c) => indexOfTerm(toks, c) >= 0);
    if (hit.length === 0) {
      // "scratch that" with no name in it takes back whatever the clause before it said.
      if (RETRACT.test(clause)) for (const c of touched) { last.set(c, "neg"); seen.get(c)?.add("neg"); }
      // "Tuesday, we'll see": the hedge is about the day before it.
      else if (isHedge(clause)) for (const c of touched) { last.set(c, "hedge"); seen.get(c)?.add("hedge"); }
      else if (EITHER.test(clause) && !isNeg(clause)) either = true;
      touched = [];
      return;
    }
    const ev = evOf(clause);
    for (const c of hit) {
      last.set(c, ev);
      if (!seen.has(c)) seen.set(c, new Set());
      seen.get(c)!.add(ev);
    }
    touched = hit;
  });
  if (last.size === 0) {
    return either ? { status: "addressed", completes: true, note: "Either", via: "text" } : OPEN;
  }
  const pos = choices.filter((c) => last.get(c) === "pos");
  const hedged = choices.filter((c) => last.get(c) === "hedge");
  const neg = choices.filter((c) => last.get(c) === "neg");
  const flipped = pos.filter((c) => seen.get(c)!.has("neg"));
  if (pos.length && flipped.length === 0) return { status: "addressed", completes: true, note: "Says " + pos.map(cap).join(" and "), via: "text" };
  if (pos.length) return { status: "uncertain", completes: false, note: "Changed Its Mind", via: "text" };
  if (hedged.length) return { status: "uncertain", completes: false, note: "Maybe", via: "text" };
  // Every option turned down is an answer ("neither works"); one turned down is not.
  if (neg.length === choices.length) return { status: "addressed", completes: false, note: "Declined", via: "text" };
  return { status: "uncertain", completes: false, note: "Which One?", via: "text" };
}

const cap = (s: string) => s.replace(/\b[a-z]/g, (m) => m.toUpperCase());

// "Until Friday", "by Tuesday", "after the 5th": a deadline for something else,
// not a day being proposed for the meeting.
const DEADLINE_OF_SOMETHING = /\b(until|till|by|before|after|through)\s+(?:the\s+|next\s+|this\s+)?(?:mon|tue|wed|thu|fri|sat|sun|tomorrow|tonight|today|end|noon|\d)/;

function judgeWhen(clauses: string[]): Verdict {
  let last: Ev | null = null;
  let value = "";
  let flipped = false;
  let sawNeg = false;
  for (const clause of clauses) {
    if (DEADLINE_OF_SOMETHING.test(clause)) continue;
    if (!namesWhen(clause)) {
      // "Tuesday works, we'll see": a hedge with no day of its own softens the one before it.
      if (last === "pos" && isHedge(clause)) last = "hedge";
      continue;
    }
    const ev = evOf(clause);
    if (ev === "neg") sawNeg = true;
    if (ev === "pos" && sawNeg) flipped = true;
    last = ev;
    if (ev === "pos") value = clause.replace(/\b(works?|is fine|sounds good|please|yes|ok|okay)\b/g, "").replace(/\s+/g, " ").trim();
  }
  if (last === null) return OPEN;
  if (last === "neg") return { status: "open", completes: false, note: "Turned Down", via: "text" };
  if (last === "hedge" || flipped) return { status: "uncertain", completes: false, note: last === "hedge" ? "Maybe" : "Changed Its Mind", via: "text" };
  return { status: "addressed", completes: true, note: value ? "Says " + cap(value).slice(0, 28) : "Gave a Time", via: "text" };
}

function judgeQuantity(req: ReplyRequirement, clauses: string[]): Verdict {
  const terms = [...req.match.topicTerms, ...(req.match.evidenceTerms ?? [])];
  let best: Verdict = OPEN;
  for (const clause of clauses) {
    const toks = tokensOf(clause);
    const at = terms.map((t) => indexOfTerm(toks, t)).filter((i) => i >= 0);
    if (at.length) {
      // A number within three words of the thing counted.
      for (let i = 0; i < toks.length; i++) {
        const n = numberAt(toks[i]!);
        if (n === null) continue;
        if (at.some((a) => Math.abs(a - i) <= 3)) {
          if (isHedge(clause)) { best = { status: "uncertain", completes: false, note: "Maybe " + n, via: "text" }; continue; }
          return { status: "addressed", completes: true, note: "Says " + n, via: "text" };
        }
      }
      if (isHedge(clause)) best = { status: "uncertain", completes: false, note: "Maybe", via: "text" };
      else if (DEFER.test(clause) || COMMIT.test(clause)) { if (best.status !== "uncertain") best = { status: "addressed", completes: false, note: "Deferred", via: "text" }; }
    } else if (!namesWhen(clause)) {
      // A bare number that is not a time and not next to the thing counted: could be the answer, could be anything.
      if (toks.some((t) => numberAt(t) !== null) && best.status === "open") best = { status: "uncertain", completes: false, note: "Which Number?", via: "text" };
    }
  }
  return best;
}

const attachmentMatches = (a: AttachmentFact, terms: readonly string[]): boolean => {
  const name = tokensOf(a.filename.toLowerCase());
  return terms.some((t) => indexOfTerm(name, t) >= 0);
};

function judgeAttachment(req: ReplyRequirement, clauses: string[], files: readonly AttachmentFact[]): Verdict {
  const terms = [...req.match.topicTerms, ...(req.match.evidenceTerms ?? [])];
  // A file that is really attached, and named for the thing asked for.
  const named = files.find((f) => attachmentMatches(f, terms));
  if (named) return { status: "addressed", completes: true, note: "Attached " + named.filename.slice(0, 24), via: "attachment" };
  // The words: a clause about the thing, and what it says about it.
  let claim = false;
  let handled: Verdict | null = null;
  for (const clause of clauses) {
    const toks = tokensOf(clause);
    if (!hasAny(toks, terms)) continue;
    const c = flatten(clause);
    if (isHedge(c)) { handled = handled ?? { status: "uncertain", completes: false, note: "Maybe", via: "text" }; continue; }
    if (isNeg(c) || DEFER.test(c) || COMMIT.test(c)) {
      // Declined or deferred: the ask is addressed, and NOT completed.
      handled = { status: "addressed", completes: false, note: isNeg(c) && !DEFER.test(c) ? "Declined" : "Deferred", via: "text" };
    } else if (CLAIM.test(c)) claim = true;
  }
  if (handled) return handled;
  // "Attached" in the body with nothing attached is a claim the draft cannot back.
  if (claim) return { status: "open", completes: false, note: files.length ? "Wrong File?" : "Nothing Is Attached", via: "none" };
  // Some other file is attached and the ask is for a file: maybe that is it.
  if (files.length) return { status: "uncertain", completes: false, note: "Is That the Right File?", via: "attachment" };
  return OPEN;
}

function judgeFreeText(req: ReplyRequirement, clauses: string[]): Verdict {
  const topics = req.match.topicTerms;
  const extra = req.match.evidenceTerms ?? [];
  const wantsCommit = req.kind === "commitment";
  let last: Verdict = OPEN;
  let sawNeg = false;
  let flipped = false;
  let bareCue = false;
  for (let i = 0; i < clauses.length; i++) {
    const clause = clauses[i]!;
    const toks = tokensOf(clause);
    const c = flatten(clause);
    const onTopic = hasAny(toks, topics);
    const extraHit = hasAny(toks, extra);
    const cueHere = AFFIRM.test(c) || NEGATE.test(c) || COMMIT.test(c) || DEFER.test(c) || extraHit;
    // A clause that is only "yes" or "no, sorry" answers the neighbour that names the thing.
    const pure = (k: number): boolean => {
      const n = clauses[k];
      if (n === undefined) return false;
      const t = tokensOf(n);
      return t.length <= 4 && PURE.test(flatten(n)) && (AFFIRM.test(flatten(n)) || NEGATE.test(flatten(n))) && !hasAny(t, topics);
    };
    // A hedge with nothing it is about softens the answer before it.
    if (!onTopic && !extraHit && isHedge(c) && last.status === "addressed") {
      last = { status: "uncertain", completes: false, note: "Maybe", via: "text" };
      continue;
    }
    if (!cueHere) {
      // A cue-less clause that names the thing gets its answer from an adjacent bare yes or no.
      if (onTopic && (pure(i - 1) || pure(i + 1))) {
        const neighbour = pure(i - 1) ? clauses[i - 1]! : clauses[i + 1]!;
        const ev = evOf(neighbour);
        if (ev === "neg") sawNeg = true;
        else if (sawNeg) flipped = true;
        last = ev === "neg" ? { status: "addressed", completes: false, note: "Declined", via: "text" } : { status: "addressed", completes: true, note: "Yes", via: "text" };
      }
      continue;
    }
    if (!onTopic && !extraHit) {
      // A cue with nothing it is about. Remembered, so a lone "yes" reads as maybe.
      if (pure(i)) bareCue = true;
      continue;
    }
    if (isHedge(c)) { last = { status: "uncertain", completes: false, note: "Maybe", via: "text" }; continue; }
    if (wantsCommit && !COMMIT.test(c) && !DEFER.test(c) && !NEGATE.test(c) && !extraHit) continue;
    if (RETRACT.test(c) || (isNeg(c) && !DEFER.test(c) && !COMMIT.test(c))) {
      sawNeg = true;
      last = { status: "addressed", completes: false, note: "Declined", via: "text" };
    } else if (DEFER.test(c) || (isNeg(c) && (DEFER.test(c) || COMMIT.test(c)))) {
      last = { status: "addressed", completes: false, note: "Deferred", via: "text" };
    } else {
      if (sawNeg) flipped = true;
      last = { status: "addressed", completes: true, note: COMMIT.test(c) ? "Committed" : "Yes", via: "text" };
    }
  }
  if (flipped && last.status === "addressed" && last.completes) return { status: "uncertain", completes: false, note: "Changed Its Mind", via: "text" };
  // A lone yes or no with nothing to say what it answers is not an answer to this, but it might be.
  if (last.status === "open" && bareCue) return { status: "uncertain", completes: false, note: "Yes to What?", via: "text" };
  return last;
}

function judge(req: ReplyRequirement, clauses: string[], files: readonly AttachmentFact[]): Verdict {
  switch (req.match.kind) {
    case "choice": return judgeChoice(req, clauses);
    case "date_time": return judgeWhen(clauses);
    case "quantity": return judgeQuantity(req, clauses);
    case "attachment": return judgeAttachment(req, clauses, files);
    default: return judgeFreeText(req, clauses);
  }
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/**
 * How much of what was asked the draft answers. Local: no model, no network,
 * no storage. `overrides` are the person's own marks and beat the reading in
 * both directions.
 */
export function evaluateCoverage(
  requirements: readonly ReplyRequirement[],
  draftText: string,
  attachmentFacts: readonly AttachmentFact[] = [],
  overrides: CoverageOverrides = {},
): CoverageResult {
  const clauses = clausesOf(normalizeReplyText(draftText));
  const items: CoverageItem[] = requirements.map((requirement) => {
    const mark = overrides[coverageKey(requirement)];
    if (mark === "addressed") return { requirement, status: "addressed", via: "override", completes: true, note: "Marked Answered" };
    if (mark === "open") return { requirement, status: "open", via: "override", completes: false, note: "Marked Open" };
    const v = judge(requirement, clauses, attachmentFacts);
    return { requirement, status: v.status, via: v.via, completes: v.completes, note: v.note };
  });
  return {
    items,
    answered: items.filter((i) => i.status === "addressed").length,
    uncertain: items.filter((i) => i.status === "uncertain").length,
    total: items.length,
  };
}

/**
 * The indicator's words. "Answered 3 of 4" when the whole conversation was
 * read; "Answered 3 of 4 Found" when part of it was not (the row's own line
 * says "Not Every Message Was Read", and no dot is baked into the title), because
 * a count over a partial read is not the count. Null when there is
 * nothing to show: a complete read that found nothing asked.
 */
export function coverageSummary(result: CoverageResult, completeSource: boolean): { label: string; incomplete: boolean } | null {
  if (result.total === 0 && completeSource) return null;
  if (!completeSource) return { label: `Answered ${result.answered} of ${result.total} Found`, incomplete: true };
  return { label: `Answered ${result.answered} of ${result.total}`, incomplete: false };
}
