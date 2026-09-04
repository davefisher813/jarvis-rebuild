import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { reachOf } from "../bigger/reach";
import { movesLine } from "../today/goalPulse";
import { healthOf, measureState } from "../bigger/measure";

// THE LAWS, AS TESTS.
//
// Every rule in this file was learned by shipping a violation of it and having
// Dave find it on his phone. A rule that lives only in a document decays the
// moment someone is moving fast; a rule that fails the suite cannot.
//
// Adding a law here is cheap and permanent. When a new one is agreed, write it
// as a check in this file in the same session, not "later".

const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const ALL = walk(SRC);
const isTest = (f: string) => /\.test\.(ts|tsx)$/.test(f);
const isBench = (f: string) => f.includes("/bench/") || f.includes("/testpanel/");
const COMPONENTS = ALL.filter((f) => f.endsWith(".tsx") && !isTest(f) && !isBench(f));
const SOURCES = ALL.filter((f) => /\.(ts|tsx)$/.test(f) && !isTest(f) && !isBench(f));
const CSS = ALL.filter((f) => f.endsWith(".css")).map((f) => readFileSync(f, "utf8")).join("\n");

const read = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => f.slice(SRC.length + 1);

describe("LAW: no em dashes, anywhere", () => {
  // Cost: three separate sweeps missed these, because they hide as —
  // escapes and because truncated grep output lies.
  it("no literal em dash in any source file", () => {
    const hits = SOURCES.filter((f) => read(f).includes("—")).map(rel);
    expect(hits).toEqual([]);
  });

  it("no escaped em dash in any string we render", () => {
    // Two legitimate uses, and both of them are about SOMEBODY ELSE'S text.
    //
    //   ai/suggestions.ts is the scrubber that REMOVES them from what the
    //   model writes, because model output is the app talking.
    //
    //   connections/google/decode.ts is the HTML entity table. &mdash; in a
    //   sender's email is that sender's punctuation, and rewriting it would
    //   be misquoting them. The law is about the app's own prose; quoted mail
    //   is not the app's prose. (2026-08-25)
    const allowed = ["ai/suggestions.ts", "connections/google/decode.ts"];
    const hits = SOURCES
      .filter((f) => !allowed.includes(rel(f)) && /\\u2014/.test(read(f)))
      .map(rel);
    expect(hits).toEqual([]);
  });

  it("every AI parse function scrubs its output", () => {
    // A style rule enforced only by the prompt is not enforced. Anything the
    // model writes that a human reads or sends passes through noDashes at its
    // parse point, so a new caller cannot forget.
    const parsers = ["messages/triage.ts", "messages/brief.ts", "messages/commitments.ts", "messages/deck.ts"];
    for (const p of parsers) {
      const src = read(join(SRC, p));
      expect(src, p + " must import noDashes").toContain("noDashes");
    }
  });
});

describe("LAW: every class has CSS behind it", () => {
  // Cost: `nav-act` sat on four nav buttons for a whole session with no
  // stylesheet rule anywhere. Nothing errors. The icons simply never got
  // their size.
  it("no className is used that no stylesheet defines", () => {
    const defined = new Set(Array.from(CSS.matchAll(/\.([a-z][a-z0-9-]{2,})/g), (m) => m[1]!));
    const used = new Map<string, string>();
    for (const f of COMPONENTS) {
      for (const m of read(f).matchAll(/className=["`{]([^"`}]*)/g)) {
        for (const c of m[1]!.split(/[\s+"']+/)) {
          const t = c.trim();
          if (/^[a-z][a-z0-9-]{3,}$/.test(t) && !defined.has(t)) used.set(t, rel(f));
        }
      }
    }
    expect(Object.fromEntries(used)).toEqual({});
  });
});

// NO MILITARY TIME ON SCREEN (Dave 2026-08-22: "reminders are rendering in
// military time"). Every surface but one ran its HH:MM through fmtTime; the
// reminders strip printed the stored string raw, so 9 PM meds read "21:00".
// A time that reaches the screen goes through the formatter.
describe("LAW: clock times are 12-hour", () => {
  it("no component renders a raw stored time string", () => {
    const bad: string[] = [];
    for (const f of COMPONENTS) {
      const src = read(f);
      // {x.time} rendered directly, without fmtTime around it. fmtTime's own
      // output is {t.time}/{t.ap} where t = fmtTime(...), which is fine, so
      // the check is for a time field on a DATA object reaching JSX bare.
      for (const m of src.matchAll(/\{(\w+)\.time\}/g)) {
        const varName = m[1]!;
        // The declaration only has to REACH fmtTime, not start with it:
        // `const endT = e.data.end ? fmtTime(e.data.end) : null` is correct
        // and a stricter pattern flagged it as a violation.
        const decl = new RegExp("(const|let)\\s+" + varName + "\\s*=[^;\\n]*", "g");
        const declared = [...src.matchAll(decl)].some((d) => d[0].includes("fmtTime("));
        if (!declared) bad.push(rel(f) + ": {" + varName + ".time}");
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("LAW: no inline styles", () => {
  // Tokens only. Two legitimate exceptions, both the same idea: a runtime
  // NUMBER the CSS cannot know. Live geometry (a drag position), and a
  // custom property ("--x") that a stylesheet rule consumes: the Sweep's
  // countdown ring passes its arc angle this way (2026-08-25), and the
  // paint itself stays in CSS where the tokens are. An inline style that
  // sets a real CSS property by name is still the violation this law was
  // written for.
  it("style={{ }} appears only for dynamic geometry or a custom property", () => {
    const bad: string[] = [];
    for (const f of COMPONENTS) {
      read(f).split("\n").forEach((line, i) => {
        if (!/style=\{\{/.test(line)) return;
        if (/transform|left:|top:|width:|height:/.test(line)) return; // geometry
        if (/style=\{\{\s*"--[a-z-]+":/.test(line)) return; // custom property only
        bad.push(rel(f) + ":" + (i + 1));
      });
    }
    expect(bad).toEqual([]);
  });
});

describe("LAW: Apple HIG casing", () => {
  // "as" joined 2026-09-02 (Show as Sent): a preposition, lowercase mid-title by the same style.
  const SMALL = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
  const titleCased = (t: string) => {
    const words = t.split(/\s+/).filter(Boolean);
    return words.every((w, i) =>
      !/^[a-z]/.test(w) || (i > 0 && i < words.length - 1 && SMALL.has(w.toLowerCase())));
  };

  it("nav titles and section titles are Title Case", () => {
    const bad: string[] = [];
    for (const f of COMPONENTS) {
      const src = read(f);
      for (const cls of ["nav-title", "nav-large", "sec-title"]) {
        for (const m of src.matchAll(new RegExp('className="' + cls + '"[^>]*>\\s*([^<>{}\\n]{3,50}?)\\s*<', "g"))) {
          const t = m[1]!.trim();
          if (t.split(/\s+/).length > 1 && !titleCased(t)) bad.push(rel(f) + ": " + t);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  // Catalog V3.1 (Dave 2026-08-18): Title Case EVERYWHERE. Row names, library
  // rows, empty-state titles, field labels, tip titles, and button labels all
  // join the law. Only pure literals are checkable statically; dynamic content
  // is the user's words and exempt by nature.
  it("row names, labels, empty titles, and buttons are Title Case", () => {
    // Exemptions, each principled: onboarding is a conversational surface
    // (sentence case by catalog); interrogative strings are talk wherever
    // they appear; brand words carry their own casing.
    const TALK_FILES = new Set(["onboarding/OnboardingFlow.tsx"]);
    // WHOSE VOICE IS THE BUTTON IN? (Dave 2026-08-25, ruling on the 21
    // buttons this law had never actually been enforced against.)
    //
    // Widening the regex above (it used to stop at the `>` inside an arrow
    // function, so every button with an onClick was invisible) surfaced 21
    // sentence-case labels. Reading them in context showed the law was
    // missing a distinction, not that 21 screens were wrong:
    //
    //   The APP naming an action gets Title Case. "Mute This Thread",
    //   "Use Next Free Slot", "Turn Into Heading". Twelve of these; all
    //   fixed, so none appear below.
    //
    //   A button written in the USER's voice does not. Title Case makes a
    //   person's own words read like a filing cabinet, and the app is
    //   putting these words in his mouth: "It Pays Itself" is absurd sat
    //   next to "Off", and "No Thanks" is not how anybody declines.
    //
    // Two shapes speak in the user's voice, and only two:
    //
    //   SEGMENTED VALUES answer the field label above them. Autopay ->
    //   "I pay it" / "It pays itself". This one is categorical, so it is
    //   exempted by CLASS: a .seg option is always an answer.
    //
    //   DECLINES sit beside a Title Case primary and refuse it. "Clear
    //   Noise Automatically From Now On" / "Keep it manual". Class cannot
    //   decide this one, because .quiet-action also carries commands
    //   ("Show All Mail Instead" is an escape hatch, not a decline), so
    //   these are named. Nine of them, and the list should not grow: a new
    //   entry means somebody wrote copy in the user's voice, which is worth
    //   a moment's thought rather than an automatic exemption.
    const USER_VOICE = new Set([
      "Leave them", "Yes, file them", "No thanks", "Keep it manual",
      "No, move out", "Leave it scheduled",
    ]);
    const BRAND = /^(iCloud|iPhone|iPad|iOS|iMessage|macOS|kg|lb|min|hr)$/;
    // THE LAW ONLY EVER LOOKED ONE WAY (Dave 2026-09-03, pics 2 and 4:
    // "more title case issues"). Every check above asks whether a word is
    // capitalised ENOUGH, so a small word capitalised mid-title -- "Point
    // At It", "Take This To The Doctor", "Add To Today" -- sailed through
    // every one of them. That is not a rare slip: the sweep this law was
    // written for (commit cc0d5bb) explicitly fixed "Add To Today" to "Add
    // to Today", and it drifted straight back, because nothing failed when
    // it did. 26 strings had accumulated by the time Dave caught them by
    // eye, most of them on the health screens, which had never been read
    // by a law at all.
    //
    // Scoped deliberately: only strings that already READ as Title Case
    // (every non-small word capitalised) are judged, so sentence-case copy
    // and the user's own words are untouched. First and last word are
    // always allowed their capital, which is the rule Apple states.
    const overCapped = (t: string) => {
      const words = t.split(/\s+/).filter(Boolean);
      if (words.length < 3) return [];
      const big = words.filter((w) => !SMALL.has(w.toLowerCase()));
      if (big.length === 0 || !big.every((w) => /^[A-Z]/.test(w))) return [];
      return words.filter((w, i) => i > 0 && i < words.length - 1
        && SMALL.has(w.toLowerCase()) && /^[A-Z]/.test(w));
    };
    const passes = (t: string) => {
      if (t.includes("?")) return true; // interrogative talk
      const words = t.split(/\s+/).filter(Boolean);
      if (overCapped(t).length > 0) return false;
      return words.every((w, i) =>
        BRAND.test(w.replace(/[^A-Za-z]/g, "")) || !/^[a-z]/.test(w) ||
        (i > 0 && i < words.length - 1 && SMALL.has(w.toLowerCase())));
    };
    const bad: string[] = [];
    for (const f of COMPONENTS) {
      if (TALK_FILES.has(rel(f))) continue;
      const src = read(f);
      // Apple Music casing EVERYWHERE (Dave 2026-08-18): section heads (sh2
      // "t" spans), library names, fold heads, day dividers, and chips join
      // the scan alongside the original set.
      for (const cls of ["conn-name", "lib-name", "empty-title", "input-label", "tip-title", "restore-title", "promo-title", "t", "sec-title", "msg-fold-head", "day-divide", "chip"]) {
        for (const m of src.matchAll(new RegExp('className="' + cls + '(?: [a-z-]+)*"[^>]*>\\s*([^<>{}\\n]{3,60}?)\\s*<', "g"))) {
          const t = m[1]!.trim();
          if (t.split(/\s+/).length > 1 && !passes(t)) bad.push(rel(f) + " [" + cls + "]: " + t);
        }
      }
      // `[^>]*` used to close the opening tag here, which meant any button
      // carrying an arrow function was invisible to this law: the `>` in
      // `=>` ended the match early. Caught 2026-08-25 when "Open early"
      // shipped past it on `onClick={() => setPeeked(true)}`. A law with a
      // hole that the newest code falls straight through is not a law.
      // `[\s\S]*?` is safe because buttons do not nest and the body is
      // still barred from containing `<`.
      for (const m of src.matchAll(/<button\b[\s\S]*?>\s*([A-Za-z][^<>{}\n]{2,40}?)\s*<\/button>/g)) {
        const t = m[1]!.trim();
        if (USER_VOICE.has(t)) continue;
        // A segmented option is always an answer to the field label above
        // it, so its voice is the user's by construction.
        if (/className=\{?"[^"]*\bseg\b/.test(m[0]!)) continue;
        if (t.split(/\s+/).length > 1 && !passes(t)) bad.push(rel(f) + " [button]: " + t);
      }
      // Placeholders carry the same casing when they are labels. Example-
      // carrying placeholders (a middle dot or "e.g.") are content, not
      // labels, and stay exempt.
      for (const m of src.matchAll(/placeholder="([^"{}]{3,60}?)"/g)) {
        const t = m[1]!.trim();
        if (t.includes("·") || /e\.g\./.test(t)) continue;
        if (t.split(/\s+/).length > 1 && !passes(t)) bad.push(rel(f) + " [placeholder]: " + t);
      }
    }
    expect(bad).toEqual([]);
  });

  // A BUTTON IS A VERB, NEVER A CONFESSION (Dave 2026-08-26: "These button
  // names don't align with the research theme of the app").
  //
  // The casing law above asks WHOSE voice a button is in. This one asks what
  // it makes the user say to press it, and it is L1 in words rather than in
  // color. L1 outlawed red as a status because a status you cannot act on is
  // just a report on your own failure; a button labelled with the user's
  // deficit is the same object with a tap target.
  //
  // Three shipped, all found in one sweep of every label in the app:
  //
  //   "I'm Overwhelmed"       the door into the app's most important ADHD
  //                           feature, priced at a declaration of the exact
  //                           state that makes pressing anything hard, on a
  //                           home screen anyone glancing at the phone reads
  //   "Just Pick One For Me"  "Just" begs; "For Me" casts the user as a
  //                           dependent asking a caretaker
  //   "Plan It For Me"        the same "For Me", milder
  //
  // Now "Just This One", "Pick One" and "Plan It". Each names what the app
  // does or what you get, and the last two were already the labels for the
  // identical action elsewhere, so this collapsed two vocabularies into one.
  //
  // The test is deliberately narrow: two syntactic shapes, no vocabulary
  // list of sad words. A label pleading in some new way will not be caught
  // here, and should not be -- that is a judgement, and this file is for the
  // rules that hold without one.
  it("no button asks the user to confess or to beg", () => {
    // "For Me" as the whole tail of a label: the app doing its job is not a
    // favour granted on request. "Deal Five Quick Ones Instead" and friends
    // are untouched; this fires only on the trailing plea.
    const BEGS = /\bfor me$/i;
    // A first-person state as the entire label. Not every "I": the segmented
    // values ("I pay it") are the user answering a field, which the casing
    // law above already recognises as legitimately his voice, and they are
    // exempted here by the same .seg class.
    const CONFESSES = /^i(?:'m| am)\b/i;
    const bad: string[] = [];
    for (const f of COMPONENTS) {
      const src = read(f);
      for (const m of src.matchAll(/<button[\s\S]*?>\s*([^<>{}\n]{2,60}?)\s*<\/button>/g)) {
        const t = m[1]!.trim();
        if (/className=\{?"[^"]*\bseg\b/.test(m[0]!)) continue;
        if (BEGS.test(t)) bad.push(rel(f) + ' [begs]: "' + t + '"');
        if (CONFESSES.test(t)) bad.push(rel(f) + ' [confesses]: "' + t + '"');
      }
    }
    expect(bad, "name the move, not the person pressing it").toEqual([]);
  });

  // V3.3 addendum (Dave 2026-08-18): anything starting a line, and anything
  // after a middle-dot section break, starts with a capital. Applies to sub
  // and meta literals and to toast receipts; dynamic segments are exempt by
  // nature (only pure literals are scanned).
  it("line starts and dot-break segments start capital", () => {
    const segsOk = (raw: string) =>
      raw.replace(/&middot;/g, "·").split("·").every((seg) => {
        // Apple's own brand casing is not a violation: iCloud, iPhone, iOS.
        if (/^i[A-Z]/.test(seg.trim())) return true;
        const first = seg.trim().match(/[A-Za-z]/)?.[0];
        // Only judge the leading character of the segment; a digit lead
        // ("20 minutes ago") is fine, so find the FIRST char, not first letter.
        const lead = seg.trim()[0];
        if (!lead) return true;
        return !/[a-z]/.test(lead) || first !== lead;
      });
    const bad: string[] = [];
    for (const f of COMPONENTS) {
      const src = read(f);
      // Widened 2026-08-22: "Protected · until 10:00 AM" shipped because
      // this scan covered six sub classes and nothing else. Every class
      // that renders copy with a dot-break is on the list now.
      for (const cls of ["conn-meta", "lib-sub", "promo-sub", "restore-meta", "tip-sub", "empty-sub",
        "conn-name", "input-help", "input-error", "input-note", "bp-sub", "sched-cat", "plan-sub",
        "eyebrow", "t-body", "block-meta"]) {
        for (const m of src.matchAll(new RegExp('className="' + cls + '(?: [a-z-]+)*"[^>]*>\\s*([^<>{}\\n]{3,80}?)\\s*<', "g"))) {
          const t = m[1]!.trim();
          if (!segsOk(t)) bad.push(rel(f) + " [" + cls + "]: " + t);
        }
      }
      for (const m of src.matchAll(/message:\s*"([^"{}]{3,80}?)"/g)) {
        const t = m[1]!.trim();
        if (!segsOk(t)) bad.push(rel(f) + " [toast]: " + t);
      }
      // Notification bodies and mail-deck say() receipts are copy too
      // (2026-08-22 sweep found violations in both).
      for (const m of src.matchAll(/body:\s*"([^"{}]{3,80}?)"/g)) {
        const t = m[1]!.trim();
        if (!segsOk(t)) bad.push(rel(f) + " [notification]: " + t);
      }
      // The space requirement skips speaker ids (say("jarvis", ...)):
      // one-word lowercase literals there are identifiers, not copy.
      for (const m of src.matchAll(/\bsay\(\s*"([^"{}]*?\s[^"{}]*?)"/g)) {
        const t = m[1]!.trim();
        if (!segsOk(t)) bad.push(rel(f) + " [say]: " + t);
      }
    }
    expect(bad).toEqual([]);
  });

  // A REMINDER IS NOT A TASK (catalog Q1). It rides the task entity for
  // storage, so every list that offers WORK has to carve it out by hand. The
  // planner did not, and "Morning Meds" turned up under Anytime asking for a
  // 45-minute block. Any new list of offerable tasks must check this too.
  it("no list of offerable work forgets to carve reminders out", () => {
    const OFFERS = [
      "tasks/filters.ts", "upnext/upnext.ts",
      "today/TodayFlow.tsx", "schedule/ScheduleFlow.tsx",
    ];
    const bad: string[] = [];
    for (const r of OFFERS) {
      const f = SOURCES.find((x) => rel(x) === r);
      if (!f) { bad.push(r + " (missing)"); continue; }
      if (!/data\.reminder/.test(read(f))) bad.push(r);
    }
    expect(bad).toEqual([]);
  });

  // THE NOTICE LAW (A1, Dave 2026-08-20). Every card in the Heads Up stream
  // is built one way: glyph, words, exactly ONE control on the visible line.
  // Dismiss is a swipe. The corner × is banned: on a one-row card the corner
  // and the row's right edge are the same place, and two tap targets stacked
  // on each other is how you hit the wrong one.
  it("no card carries a corner dismiss", () => {
    const bad: string[] = [];
    for (const f of SOURCES) {
      if (/promo-x/.test(read(f))) bad.push(rel(f));
    }
    expect(bad).toEqual([]);
  });

  // THE STREAM HAS RHYTHM (2026-08-20). Dave spotted the cards were stacked
  // flush: converting everything to one anatomy dropped the bottom margin the
  // promo card used to carry, and what read as separation was only the
  // rounded corners against black. Measured at 0px between every card.
  // A stacked surface must declare its own spacing.
  it("the notice stream declares the spacing between its members", () => {
    const css = read(SRC + "/styles/components.css");
    // On the STREAM, not on one card type: the day-draft card is deliberately
    // not a notice card, and when the margin lived on .notice-swipe it sat
    // flush against everything else.
    expect(css).toMatch(/\.heads-up-stream\s*>\s*\*\s*\+\s*\*\s*\{[^}]*margin/);
  });

  // THE 44px TAP TARGET (Apple HIG). The app already has --tap-min and
  // .see-all already meets it; .pill-act shipped at 27px, which is every
  // action button in the notice stream. A row action must expand its hit
  // area past its paint rather than be pleasant to look at and hard to hit.
  it("the row action pill expands its hit area to the tap minimum", () => {
    const css = read(SRC + "/styles/components.css");
    expect(css).toMatch(/\.pill-act::after\s*\{[^}]*inset/);
  });

  // B1/B2 (2026-08-23): the law above checked ONE class, so it could not have
  // caught the two things this audit found. `.cb` was the tap target on note
  // checklists and reminders and painted at 22px; `.chip` paints at 30px
  // across three dozen screens. Every control that paints smaller than
  // --tap-min has to say, in CSS, how it reaches 44.
  //
  // Deliberately a source check and not a measurement: jsdom reports every
  // width as 0, so a real height assertion belongs in the browser walk. What
  // this catches is the expansion being deleted, which is how it went missing
  // the first time.
  it("every control that paints under 44px expands its hit area", () => {
    const css = read(SRC + "/styles/components.css") + read(SRC + "/styles/uniformity.css");
    const bad: string[] = [];
    // class -> the painted size that makes the expansion mandatory
    const small: Record<string, string> = {
      "cb": "22px checkbox, note checklists and reminders",
      "chip": "30px filter chip",
      "pill-act": "27px row action",
      "row-act": "40px bare-text action, 26 call sites, four short",
      // Added 2026-08-24: every use of this class is a <button> that opens
      // something, and it painted at roughly 19px with no affordance at all.
      "receipt-line": "eyebrow-sized receipt that opens the pile it describes",
      // Added 2026-08-24 by a page-by-page browser walk. The law had five
      // classes; the walk measured every button on every screen and found
      // these six, including the Schedule tab's primary navigation at 30px.
      "seg": "30px segmented control, Day/Week/Month/Repeats",
      "barbtn": "32px round bar button",
      "cal-step": "32px month stepper",
      "plan-cta": "30px day action, Plan My Day and Running Late?",
      "day-pill": "32px summary pill on Today",
      // Added 2026-08-26 (Dave, from two screenshots): every .see-all on the
      // home page now wears Plan My Day's ghost pill instead of bare text,
      // same ~30px painted size as plan-cta itself.
      "pill-action": "30px home-page head action (See All, Open Inbox, Schedule...), ghosted to match Plan My Day",
    };
    for (const [cls, why] of Object.entries(small)) {
      // Either an ::after carrying inset/height, or a wrapper that is itself
      // at least the tap minimum, counts as meeting it.
      const expands = new RegExp("\\." + cls + "::after\\s*\\{[^}]*(inset|height)").test(css);
      if (!expands) bad.push(`.${cls} (${why}) has no ::after hit area`);
    }
    expect(bad).toEqual([]);
  });

  // THE RETIRED SECTION HEAD (catalog L). Today's icon-tile head, sec-ico
  // plus sec-title, was retired in favour of the steel head. It survived in
  // the check-in, which meant the one card in the Heads Up stream that was
  // not a card, sitting directly under three that were. That reads as "why
  // is this sectioned off differently", which is the note Dave has written
  // more times than any other.
  it("nothing on Today uses the retired icon-tile section head", () => {
    const bad: string[] = [];
    for (const f of COMPONENTS) {
      const r = rel(f);
      if (!r.startsWith("today/") && !r.startsWith("weather/")) continue;
      // Comments explaining WHY it was retired are not uses of it.
      const src = read(f)
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
      if (/className="[^"]*sec-(ico|title)/.test(src)) bad.push(r);
    }
    expect(bad).toEqual([]);
  });

  // EVERY CSS VARIABLE MUST EXIST (2026-08-20). An undefined custom property
  // does not error and does not warn: the declaration is simply dropped, and
  // the element silently renders with nothing. This has now shipped twice,
  // once as an invisible progress arc drawn in var(--green) when the token is
  // called --good, and once as a card whose background never applied. Both
  // passed every other gate, because tests do not look at pixels.
  it("no stylesheet references a custom property that was never defined", () => {
    const css = ["jarvis-design-system.css", "uniformity.css", "components.css"]
      .map((f) => read(SRC + "/styles/" + f)).join("\n");
    const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]!));
    // Fallback forms, var(--x, something), are safe by construction.
    const used = [...css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)].map((m) => m[1]!);
    const missing = [...new Set(used.filter((v) => !defined.has(v)))].sort();
    expect(missing).toEqual([]);
  });

  // ONE RED, THREE JOBS (2026-08-21). The first contrast sweep found 236
  // unreadable strings, and 160 of them were one mistake repeated: the brand
  // red used for a job it cannot do.
  //
  //   --accent      the brand red. Anything with no text on or in it.
  //   --accent-fill the red that carries WHITE text (#FF2B3C is 3.71:1).
  //   --accent-tx   the red drawn AS text (3.32:1 on the light page).
  //
  // The visual auditor catches a regression here, but only on a screen it
  // walks, only for text that is on screen at the moment it looks. This
  // catches it at the declaration, which is where it is actually made.
  it("the brand red is never used for a job it cannot do", () => {
    const files = ["jarvis-design-system.css", "uniformity.css", "components.css"];
    const bad: string[] = [];
    for (const f of files) {
      const css = read(SRC + "/styles/" + f);
      for (const [i, line] of css.split("\n").entries()) {
        // The token definitions themselves are the one legitimate place the
        // raw value and the word "color" appear together.
        if (/--accent(-tx|-fill)?\s*:/.test(line)) continue;
        if (/(?<![-\w])color:\s*var\(--accent\)/.test(line)) {
          bad.push(`${f}:${i + 1} accent as TEXT (use --accent-tx)`);
        }
        if (/background(-color)?:\s*var\(--accent\)/.test(line) && /color:\s*(#fff|#ffffff|white)/i.test(line)) {
          bad.push(`${f}:${i + 1} white text on accent FILL (use --accent-fill)`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

});

describe("LAW: an icon always has a size", () => {
  // Cost: a trash can rendered the height of a sheet on Dave's phone,
  // covering Save, Cancel and half of Delete Exercise.
  //
  // `.ic` had 63 sizing rules and no bare default, every one scoped to a
  // parent someone remembered. Moving one button from .btn-danger to
  // .btn-secondary took away the only rule sizing that icon, and an inline
  // SVG with just a viewBox stretches to fill its box. Nothing caught it:
  // the class-has-CSS law passed, because the class DOES have CSS, just
  // never for that parent.
  //
  // A shared glyph class needs a base case, and the base case is what this
  // pins. Parent-scoped rules keep winning on specificity.
  it("the icon class carries an unscoped width and height", () => {
    // A bare `.ic { ... }` rule: no ancestor, no combinator, no other class.
    const m = CSS.match(/(^|\n)\.ic\s*\{([^}]*)\}/);
    expect(m, ".ic has no unscoped rule at all").toBeTruthy();
    const body = m![2]!;
    expect(body, ".ic default must set width").toMatch(/width\s*:/);
    expect(body, ".ic default must set height").toMatch(/height\s*:/);
  });

  it("an svg that renders inline carries the icon class", () => {
    // An <svg> with a viewBox and no width/height attribute and no className
    // is the exact shape that stretches. Anything drawing one has to say how
    // big it is, either with the class or with its own attributes.
    const bad: string[] = [];
    for (const f of COMPONENTS) {
      const src = read(f);
      for (const m of src.matchAll(/<svg\s[^>]*>/g)) {
        const tag = m[0];
        if (/className=/.test(tag)) continue;
        if (/\bwidth=/.test(tag) && /\bheight=/.test(tag)) continue;
        // Locate it for the message.
        const line = src.slice(0, m.index).split("\n").length;
        bad.push(rel(f) + ":" + line);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("LAW: a destructive verb never matches its Cancel", () => {
  // Cost: the 2026-08-23 danger-text sweep moved Delete off a red fill and
  // onto `color: var(--accent-tx)` across ELEVEN sheets. On dark card
  // surfaces --accent-tx is WHITE by deliberate palette decision (a red light
  // enough to pass there reads salmon, which Dave rejected on sight), so
  // every Delete in the app rendered identical to the Cancel under it. In
  // light, [data-theme="light"] .btn-secondary then outranked it and made it
  // near-black, identical again for the opposite reason.
  //
  // Neither failed anything: the class had CSS, the token existed, the
  // contrast was fine. It was just the wrong colour, twice.
  it("the destructive text token exists in both themes and is not a neutral", () => {
    const dark = CSS.match(/--danger-tx:\s*(#[0-9A-Fa-f]{6})/g) ?? [];
    expect(dark.length, "--danger-tx must be defined for light AND dark").toBeGreaterThanOrEqual(2);
    for (const d of dark) {
      const hex = d.split(":")[1]!.trim().toUpperCase();
      // A red has a red channel clearly ahead of the other two. White, black
      // and every grey fail this, which is the exact bug.
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      expect(r, hex + " is not a red").toBeGreaterThan(g + 60);
      expect(r, hex + " is not a red").toBeGreaterThan(b + 60);
    }
  });

  it("the destructive class uses that token and nothing else", () => {
    expect(CSS).toMatch(/\.btn-danger-text\s*\{[^}]*color:\s*var\(--danger-tx\)/);
    // And it must beat the light-theme secondary rule, which is 0,2,0.
    expect(CSS, "light theme needs its own danger-text rule or .btn-secondary wins")
      .toMatch(/\[data-theme="light"\]\s*\.btn-danger-text/);
  });
});

describe("LAW: a dead control looks dead", () => {
  // The app carried exactly three :disabled rules, each scoped to one
  // component, and none for buttons in general. Every other disabled button
  // rendered identically to a live one and silently ate taps. It stopped
  // being theoretical the day ~8 Save buttons and both ends of every Stepper
  // gained a disabled state.
  it("there is an unscoped disabled treatment for buttons", () => {
    const m = CSS.match(/(^|\n)[^{}\n]*\bbutton:disabled\b[^{]*\{([^}]*)\}/);
    expect(m, "no unscoped button:disabled rule").toBeTruthy();
    const body = m![2]!;
    expect(body, "disabled must change how the control LOOKS").toMatch(/opacity|color|background/);
  });
});

describe("LAW: one filled red per screen", () => {
  // B15 (2026-08-23): ONE FILL PER SCREEN.
  //
  // The red law above maps each token to the job it can do. It says nothing
  // about how MANY are lit at once, and its own comment names that gap: "the
  // visual auditor catches a regression here, but only on a screen it walks".
  // The audit found three filled reds on Today every session, three on Tasks
  // on the default filter, and two on the Schedule tab's most common
  // first-run state. Nothing was broken by the rules as written.
  //
  // Only two classes carry --accent-fill: .btn-primary, and .plan-cta when it
  // is NOT also .plan-cta-ghost. .promo-pill looks red and is not a fill (it
  // is accent TEXT on a neutral pill), so it is deliberately not counted, and
  // neither is .btn-danger, which is --sys-red and a different question.
  //
  // This is a source scan, so it counts what a file CAN render, not what it
  // does. That over-counts mutually exclusive branches, which is why the
  // allowance below is per-file and why known-exclusive files are pinned with
  // their reason rather than the threshold being raised for everyone.
  //
  // AND IT HAS A HOLE IT CANNOT CLOSE. Counting per file cannot see two files
  // composing onto one screen. The Schedule tab shipped exactly that on the
  // day this law was written: Plan My Day in SchedulePage and Accept the Day
  // in ScheduleFlow's dayFooter, one fill each by this test, two on the
  // glass. The browser walk found it; this test never could. So this law is
  // the floor, not the ceiling, and the walk that counts PAINTED background
  // colours per screen is the thing that actually enforces B15.
  // THE LAW COUNTED BUTTONS AND MISSED A PANEL (Dave 2026-08-29, Email).
  //
  // The test below scans RENDER SITES for .btn-primary and .plan-cta, which
  // is the right shape for buttons and blind to everything else. The Email
  // tab's Mission Deck painted --accent-fill as a CARD BACKGROUND
  // (.mode-card.mode-hero), 1.35x the width of its neighbour, and the law
  // could not see it -- the CSS even carried a comment asserting "the
  // one-filled-red law holds" directly above the rule that broke it.
  //
  // So the fill token gets an allowlist at the CSS level. Painting
  // --accent-fill is how a thing declares itself THE action on a screen, and
  // the list of things allowed to make that claim should be short enough to
  // read. A new entry needs a reason here, in front of the others, which is
  // the same bar the EXCLUSIVE map below sets for render sites.
  it("only a known control paints the accent fill, never a panel", () => {
    const ALLOWED = new Set([
      // Buttons and pills: the fill means "tap this".
      ".btn-primary", ".plan-cta", ".mode-go", ".mode-hero .mode-go",
      ".bench-act.prim", ".chip.chip-on",
      // Small round controls whose whole body is the control.
      ".ob-check-row", ".convo-send", ".voice-mic", ".voice-orb",
      ".sel-box.on", ".sched-row.past .sel-box.on",
      // Identity marks, not actions: an avatar and the user's own chat
      // bubble. Neither competes for "the thing to tap" because neither is
      // tappable, and the bubble is the user's own words, not the app's ask.
      ".av-accent", ".chat-user", ".bubble-user",
      // The app's own 64px mark on the profile screen. A logotype, exempt
      // from this law for the same reason the wordmark is exempt from the
      // contrast bar: it is identity, not an instruction.
      ".app-icon",
    ]);
    const bad: string[] = [];
    // Comments carry commas and no braces, so a raw [^{}]+ capture swallows
    // the comment block above a rule and then splits IT on commas. Strip
    // comments first, and keep only the last line of the capture, which is
    // the selector itself rather than the blank space above it.
    const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of bare.matchAll(/([^{}]+)\{[^}]*background:\s*var\(--accent-fill\)/g)) {
      const line = m[1]!.trim().split("\n").pop() ?? "";
      for (const sel of line.split(",")) {
        const clean = sel.trim()
          .replace(/^\[data-theme="(light|dark)"\]\s*/, "")
          .replace(/:(hover|active|focus|focus-visible)\b/g, "");
        if (!clean) continue;
        // A compound like ".mode-card.mode-hero" is judged whole: the point
        // is that a CARD may not wear the fill even when a modifier does.
        if (!ALLOWED.has(clean)) bad.push(clean);
      }
    }
    expect([...new Set(bad)], "the accent fill means TAP THIS, so a panel may not wear it").toEqual([]);
  });

  it("no screen can render more than one filled red at a time", () => {
    const FILLS = /className=\{?["'`][^"'`}]*\b(btn-primary|plan-cta)\b[^"'`}]*["'`]?/g;

    // Files whose multiple fills are provably not simultaneous. Each needs a
    // reason, and the reason has to be checkable by reading the file.
    const EXCLUSIVE: Record<string, string> = {
      "messages/MessagesFlow.tsx": "sweep / toss / autoOffer are one if-else chain; the rest are separate views",
      "upnext/UpNextFlow.tsx": "three mutually exclusive branches of one switch",
      "gym/GymFlow.tsx": "Create a Program and Start are gated on !program vs program",
      "connections/ConnectionsPage.tsx": "one per connection state",
      "schedule/screens/SchedulePage.tsx": "the empty-day branch and the populated list never both render",
      "today/YourDay.tsx": "the plan-cta row ghosts all but one, and the day-empty branch excludes the rest",
      "money/MoneyFlow.tsx": "each sheet is its own portal; the empty state excludes the populated one",
      "bigger/GoalDetailPage.tsx": "the savings sheet is a portal over the page",
      "settings/BackupPage.tsx": "import and export are separate rows of one form",
      "tasks/screens/TasksPage.tsx": "Just Pick One needs counts.all > 0; the empty-state New Task needs counts.all === 0",
      "onboarding/OnboardingFlow.tsx": "a step wizard; one step is mounted at a time",
      "screens/SignIn.tsx": "sign-in and sign-up are exclusive branches",
      "gym/UploadFlow.tsx": "phase machine; one phase renders",
      "health/screens/SeasonFeedScreen.tsx": "same phase machine as gym/UploadFlow.tsx; the source-pick view and the draft-review view are an early return apart",
      "schedule/screens/ScheduleUploadFlow.tsx": "phase machine; one phase renders",
      "capture/QuickCapture.tsx": "dupAge ternary, plus a separate saved-phase screen",
      "people/CallPrepSheet.tsx": "Call and Save Note are exclusive on `dialed`",
      "schedule/screens/PlanDaySheet.tsx": "count === 0 ternary: replan or commit, never both",
      "schedule/ScheduleFlow.tsx": "the Anytime guard is a modal over the page, not a second button in it",
      "gym/MetricsCard.tsx": "MetricLogSheet and AddMetricSheet are separate portals, each mounted alone by CategoryDetail's metricSheet state; never both on screen together",
      "gym/SessionScreen.tsx": "cond ternary: Start the Clock for a conditioning block, Log Set for a strip, never both",
    };

    const bad: string[] = [];
    for (const f of COMPONENTS) {
      const name = rel(f);
      if (EXCLUSIVE[name]) continue;
      const src = read(f);
      let n = 0;
      for (const m of src.matchAll(FILLS)) {
        const cls = m[0];
        // A ghosted plan-cta is not a fill.
        if (/plan-cta/.test(cls) && /plan-cta-ghost/.test(cls)) continue;
        n++;
      }
      if (n > 1) bad.push(`${name}: ${n} filled reds`);
    }
    expect(bad).toEqual([]);
  });

  // THE PALETTE IS MEASURED, NOT TRUSTED (2026-08-21, Apple palette). Every
  // slot has a light and a dark value, an on-colour for its fills, and text
  // variants where the raw value cannot be read. None of that is taken on
  // faith: this test parses the palettes out of the stylesheet and runs the
  // WCAG maths on every combination the app can render. A wrong hex fails
  // the suite the moment it is typed, not the next time the auditor happens
  // to walk a screen where it is on show.
  const srgb = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = (hex: string) => {
    const h = hex.replace("#", "");
    return 0.2126 * srgb(parseInt(h.slice(0, 2), 16)) + 0.7152 * srgb(parseInt(h.slice(2, 4), 16)) + 0.0722 * srgb(parseInt(h.slice(4, 6), 16));
  };
  const ratio = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const palettes = () => {
    const css = read(SRC + "/styles/components.css");
    const blocks = [...css.matchAll(/(:root|\[data-theme="light"\])\s*\{([^}]*)\}/g)];
    const dark: Record<string, string> = {}, light: Record<string, string> = {};
    for (const [, sel, body] of blocks) {
      for (const [, name, hex] of body!.matchAll(/--cat-([a-z]+)\s*:\s*(#[0-9A-Fa-f]{6})/g)) {
        if (sel === ":root") dark[name!] = hex!;
        else light[name!] = hex!;
      }
    }
    return { css, dark, light };
  };

  // L3: A PROMISE IS NOT DECORATION (2026-08-25, found by a browser walk of
  // the Door and the Clean Out).
  //
  // --tx-4 is the app's quaternary ramp: 0.30 alpha, iOS's decoration
  // weight. Composited over the real page it measures 2.25:1 on dark and
  // 1.71:1 on light, nowhere near the 4.5:1 bar for text a person is
  // expected to READ. That is right for a divider or a glyph and wrong for
  // three kinds of line, all of which had drifted onto it:
  //
  //   A PROMISE ("Goes to Gmail's trash · 30 days to change your mind") is
  //   the sentence that makes a bulk delete safe to press. Illegible safety
  //   copy is worse than none, because the button still looks reassured.
  //
  //   A FLOOR ("That's everything.") is L2's entire payload. An edge you
  //   cannot see is an edge you do not have.
  //
  //   The WHO line on the Door is what rescues somebody who does not
  //   recognise the screen. Dave hit exactly that once: "My email is closed
  //   off and I no idea why."
  //
  // The maths below is the rule's justification, not ornament on it: it
  // proves --tx-4 fails the bar and --tx-3 clears it, so the rule follows
  // from a measurement rather than a preference.
  //
  // MEASURED AND MARGINAL, and the first version of this note named the
  // WRONG SURFACE. Light --surface-2 is #FFFFFF, which measures 4.74:1 and
  // passes; the shortfall is on --surface-3 (#F1F2F7), which in light backs
  // toasts, plan rows and the select bar. The full ramp, measured:
  //
  //   light --tx-3   page #F3F4F9 4.51   card #FFFFFF 4.74   s-3 4.47
  //   dark  --tx-3   page #000000 6.36   s-1 5.95  s-2 5.27  s-3 4.59
  //
  // One combination sits 0.7% under, on a handful of small containers most
  // of which set --tx-2 explicitly anyway. RULED 2026-08-25 (Dave, shown a
  // rendered 0.72-vs-0.75 comparison): leave the ramp alone. The difference
  // is invisible, and 0.75 is one point off the 0.76 that was rejected in
  // dark for sitting too close to titles and killing hierarchy. This was
  // never a legibility risk; it was a rounding artefact wearing one.
  it("promises, floors, and the door's explanation are never the decoration ramp", () => {
    // Composite in FLOAT. An earlier draft rounded each channel to hex
    // first, which cost 0.02:1 and made a passing colour look like a
    // failing one. A law that rounds before it judges is a law that lies
    // about small margins, and small margins are the only ones it decides.
    type RGB = [number, number, number];
    const over = (rgb: RGB, a: number, bg: RGB): RGB =>
      [rgb[0] * a + bg[0] * (1 - a), rgb[1] * a + bg[1] * (1 - a), rgb[2] * a + bg[2] * (1 - a)];
    const lumF = (c: RGB) => 0.2126 * srgb(c[0]) + 0.7152 * srgb(c[1]) + 0.0722 * srgb(c[2]);
    const ratioF = (a: RGB, b: RGB) => {
      const x = lumF(a), y = lumF(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const DARK: RGB = [0, 0, 0];
    const PAGE: RGB = [0xF3, 0xF4, 0xF9];
    const CARD: RGB = [255, 255, 255];

    // --tx-4 fails the text bar on every surface in both themes. This is
    // the whole reason the rule below exists.
    expect(ratioF(over([235, 235, 245], 0.30, DARK), DARK)).toBeLessThan(2.5);
    expect(ratioF(over([60, 60, 67], 0.30, PAGE), PAGE)).toBeLessThan(2.0);
    // --tx-3 clears it where these lines are actually drawn.
    expect(ratioF(over([235, 235, 245], 0.60, DARK), DARK)).toBeGreaterThanOrEqual(4.5);
    expect(ratioF(over([60, 60, 67], 0.72, PAGE), PAGE)).toBeGreaterThanOrEqual(4.5);
    expect(ratioF(over([60, 60, 67], 0.72, CARD), CARD)).toBeGreaterThanOrEqual(4.5);

    // ESSENTIAL names its own scope out loud rather than leaning on a fuzzy
    // word list: a class earns the bar by being one of these kinds of line,
    // and anything new that is has to be added here deliberately.
    const ESSENTIAL = /^\.(purge-promise|msg-amnesty-promise|list-floor|sweep-floor|mail-door-who|mail-door-peek)\b/;
    const css = read(SRC + "/styles/components.css");
    const bad: string[] = [];
    for (const m of css.matchAll(/^(\.[a-z0-9-]+)[^{}]*\{([^}]*)\}/gim)) {
      if (!ESSENTIAL.test(m[1]!)) continue;
      if (/color:\s*var\(--tx-4\)/.test(m[2]!)) bad.push(m[1]! + " is drawn in --tx-4");
    }
    expect(bad).toEqual([]);
    // The rule has teeth only if it is pointed at rules that exist.
    for (const cls of ["purge-promise", "list-floor", "mail-door-who"]) {
      expect(css).toMatch(new RegExp("\\." + cls + "\\s*\\{"));
    }
  });

  it("every category fill's on-colour measurably clears 4.5:1 in both themes", () => {
    const { css, dark, light } = palettes();
    const bad: string[] = [];
    for (const slot of Object.keys(dark)) {
      if (!light[slot]) { bad.push(slot + ": no light variant"); continue; }
      const rule = css.match(new RegExp("\\.cat-bg-" + slot + "\\s*\\{[^}]*\\}"));
      if (!rule) { bad.push(slot + ": no fill rule"); continue; }
      const m = rule[0].match(/color:\s*(var\(--on-fill-dark\)|#[0-9A-Fa-f]{3,6})/);
      if (!m) { bad.push(slot + ": fill declares no on-colour"); continue; }
      const on = m[1] === "var(--on-fill-dark)" ? "#000000" : m[1]!.length === 4 ? "#" + [...m[1]!.slice(1)].map((c) => c + c).join("") : m[1]!;
      for (const [theme, v] of [["dark", dark[slot]!], ["light", light[slot]!]] as const) {
        const r = ratio(on, v);
        if (r < 4.5) bad.push(`${slot} (${theme}): ${on} on ${v} is ${r.toFixed(2)}:1`);
      }
    }
    expect(Object.keys(dark).length).toBeGreaterThanOrEqual(15);
    expect(bad).toEqual([]);
  });

  it("every category colour drawn as text clears 4.5:1 on its theme's worst surface", () => {
    const { css, dark, light } = palettes();
    const bad: string[] = [];
    const txVar = (theme: string, slot: string, prefix: string) => {
      const m = css.match(new RegExp('--cat-' + prefix + '-' + slot + '\\s*:\\s*(#[0-9A-Fa-f]{6})'));
      return m?.[1];
    };
    for (const slot of Object.keys(dark)) {
      // Dark: the override when one exists, else the raw dark value, judged
      // against surface-3 #3A3A3C (chips, the lightest thing text sits on).
      const d = txVar("dark", slot, "dtx") ?? dark[slot]!;
      const rd = ratio(d, "#3A3A3C");
      if (rd < 4.5) bad.push(`${slot} (dark text): ${d} on #3A3A3C is ${rd.toFixed(2)}:1`);
      // Light: the tx variant is REQUIRED (no raw Apple light value survives
      // #F2F2F7), judged against the page AND against its own kicker chip.
      // The chip is an 18% wash of the slot's FILL over the page, which is
      // what components.css draws -- it was briefly washed from the INK
      // instead, and washing an already-darkened ink is exactly how MONEY
      // arrived olive-on-olive in Dave's 2026-08-22 screenshot. Mixing the
      // fill keeps the chip vivid and makes it LIGHTER than the ink wash,
      // so the ink has room to stay saturated.
      const l = txVar("light", slot, "tx");
      if (!l) { bad.push(`${slot}: no --cat-tx-${slot} light text variant`); continue; }
      const rl = ratio(l, "#F2F2F7");
      if (rl < 4.5) bad.push(`${slot} (light text): ${l} on #F2F2F7 is ${rl.toFixed(2)}:1`);
      const fill = light[slot];
      if (!fill) { bad.push(`${slot}: no light fill to mix its chip from`); continue; }
      const ch = (i: number) => Math.round(
        parseInt(fill.slice(1 + 2 * i, 3 + 2 * i), 16) * 0.18 +
        parseInt("F2F2F7".slice(2 * i, 2 * i + 2), 16) * 0.82,
      );
      const chip = "#" + [ch(0), ch(1), ch(2)].map((v) => v.toString(16).padStart(2, "0")).join("");
      const rc = ratio(l, chip);
      if (rc < 4.5) bad.push(`${slot} (light text on own chip): ${l} on ${chip} is ${rc.toFixed(2)}:1`);
      // GLYPHS ARE CHROME, NOT TEXT. An icon carries no words, so it is held
      // to the 3:1 non-text bar -- but it must actually HAVE its own value,
      // or it inherits the text ink and arrives as mud (Dave, 2026-08-22:
      // "the yellow in some spots it's terrible", on olive chevrons).
      const g = txVar("light", slot, "ic");
      if (!g) { bad.push(`${slot}: no --cat-ic-${slot} light glyph variant`); continue; }
      const rg = ratio(g, "#F2F2F7");
      if (rg < 3) bad.push(`${slot} (light glyph): ${g} on #F2F2F7 is ${rg.toFixed(2)}:1`);
    }
    expect(bad).toEqual([]);
  });

  // C2 · THE THREE-SECOND CAPTURE (Dave 2026-08-20, from the research).
  //
  // Capture has to take about three seconds or working memory drops the
  // thought before it lands. That is the whole reason the capture bar exists,
  // and it is exactly the kind of thing that erodes: someone adds a category
  // picker "just to make it tidy" and the feature quietly stops working.
  //
  // So the rule is a test. The quick capture surface may ask for ONE thing.
  it("quick capture never grows a second required field", () => {
    const src = read(SRC + "/capture/QuickCapture.tsx");
    const required = [...src.matchAll(/input-req/g)].length;
    expect(required).toBeLessThanOrEqual(1);
    // And it never gains a picker that has to be answered before saving.
    expect(/required\s*(=|:)\s*(\{?\s*true)/.test(src)).toBe(false);
  });

  // E2 · DEFAULTS OVER CONFIGURATION. The abandonment research is blunt: the
  // apps people quit are the ones that ask instead of deciding. A sheet may
  // require the ONE thing it cannot invent (a task needs its text, an event
  // needs a time). Anything past that is the app making its homework his.
  it("no sheet asks for more than the thing it cannot invent", () => {
    const LIMIT: Record<string, number> = {
      // An event genuinely cannot be placed without a title, a date and a
      // start; every other field on that sheet defaults.
      "schedule/screens/EventSheet.tsx": 3,
      // A protected block genuinely cannot be placed without a name, a start
      // and at least one day; end defaults to start + 1h, same rule as the
      // event sheet's End (2026-08-28, Dave: "edit it like a normal
      // scheduled event").
      "schedule/screens/BlockSheet.tsx": 3,
    };
    const bad: string[] = [];
    for (const f of COMPONENTS) {
      const r = rel(f);
      const n = [...read(f).matchAll(/input-req/g)].length;
      const cap = LIMIT[r] ?? 1;
      if (n > cap) bad.push(`${r}: ${n} required fields`);
    }
    expect(bad).toEqual([]);
  });

  // THE NUMBER-LEAD CAPITAL (Dave 2026-08-20, caught on "14 emails need
  // you"). When a number leads a line, the first word behind it that can
  // carry a capital gets one. The rule lives in shared/casing; a builder that
  // opens a line with a count must route through capAfterNumber.
  it("a line that leads with a number capitalizes the word behind it", () => {
    // Measurements are exempt: the word after the number is a unit ("135 kg
    // x 8"), and a capitalized unit is wrong, not stylish.
    // Exempt, each for a stated reason: measurement strings (the word after
    // the number is a unit), the rule's own source and tests, spec documents
    // (prose about the app, not app copy), and onboarding (conversational).
    const UNITS = new Set([
      "gym/measures.ts", "shared/casing.ts", "shared/Payoff.tsx", "gym/ReceiptSheet.tsx",
      "notes/notesSpec.ts", "tasks/tasksSpec.ts", "onboarding/steps.ts",
      "schedule/ScheduleFlow.tsx", "schedule/screens/SchedulePage.tsx",
    ]);
    // Names that hold a count. Only these open a line as a number.
    const COUNTY = /(^|\.)(length|count|total|done|overdue|days|mins|minutes|hours|months|weeks|years|n)$|^Math\./;
    const strip = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
    const bad: string[] = [];
    for (const f of SOURCES) {
      const r = rel(f);
      if (UNITS.has(r)) continue;
      // aria-labels are read aloud, not read: casing is inaudible there.
      const src = strip(read(f)).replace(/aria-label=\{?`[^`]*`\}?/g, " ");
      // A file that routes its lines through the rule is trusted: its
      // literals are inputs to capAfterNumber, not final copy.
      if (src.includes("capAfterNumber")) continue;
      for (const m of src.matchAll(/"(\d[\d.,]*\s+[a-z][A-Za-z]*(?:\s|·|"))/g)) {
        bad.push(r + " [literal]: " + m[1]!.trim());
      }
      for (const m of src.matchAll(/`\$\{([^}]{1,60})\}\s+[a-z]/g)) {
        if (COUNTY.test((m[1] ?? "").trim())) bad.push(r + " [built]: " + m[0]);
      }
    }
    expect(bad).toEqual([]);
  });

  // Sectioning law, V4 revision (Dave 2026-08-18): CONTENT lists label every
  // group; NAV lists are headerless by design (More entirely; Brain carries
  // exactly one mini-caps boundary label where user content begins). The nav
  // allowlist is explicit so a new lib-row surface must either label its
  // groups or be consciously registered as a nav list here.
  it("every lib-row surface carries section heads or is a registered nav list", () => {
    const NAV_NO_HEAD = new Set(["more/MorePage.tsx", "more/SettingsPage.tsx"]);
    const bad: string[] = [];
    for (const f of COMPONENTS) {
      const src = read(f);
      if (NAV_NO_HEAD.has(rel(f))) {
        if (src.includes('className="sh2"')) bad.push(rel(f) + " [nav list grew a head]");
        continue;
      }
      if (src.includes('className="lib-row"') && !src.includes('"sh2')) bad.push(rel(f));
    }
    expect(bad).toEqual([]);
  });

  // V4: nav glyphs are the FILLED brand-red state, drawn as filled shapes.
  // More and Brain nav rows must use lib-ico-brand + the filledIcon set;
  // auto-filling stroke icons is the compass-blob bug and stays banned.
  it("nav lists wear the filled brand glyph state", () => {
    for (const f of ["more/MorePage.tsx", "brain/BrainPage.tsx", "more/SettingsPage.tsx"]) {
      const src = read(join(SRC, f));
      expect(src, f).toContain("lib-ico-brand");
      expect(src, f).toMatch(/filled(Settings)?Icon\(/);
    }
    const filled = read(join(SRC, "shared/filledIcons.tsx"));
    // Quality law (Dave: "make sure all red icons are improved"): the filled
    // set comes from the professionally drawn Phosphor FILL weight; a return
    // to hand-poured fills fails here.
    expect(filled).toContain('@phosphor-icons/react');
    expect(filled).toContain('weight: "fill"');
  });

  it("the retired whitespace-cluster class never returns", () => {
    const bad: string[] = [];
    for (const f of COMPONENTS) {
      if (read(f).includes("settings-group")) bad.push(rel(f));
    }
    expect(bad).toEqual([]);
  });

  it("ALL CAPS never appears in a source string, only via CSS", () => {
    const bad: string[] = [];
    for (const f of COMPONENTS) {
      for (const m of read(f).matchAll(/>\s*([A-Z][A-Z ]{5,30})\s*</g)) {
        const t = m[1]!.trim();
        if (t.split(/\s+/).length > 1 && t === t.toUpperCase()) bad.push(rel(f) + ": " + t);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("LAW: the app never scolds", () => {
  // No shame vocabulary, and the app never diagnoses the user.
  it("no shame or diagnosis vocabulary in any rendered string", () => {
    // "lazy" is deliberately absent: React's own lazy() is everywhere, and no
    // copy in this app would use the word anyway. Every term here is prose.
    const banned = /\b(you failed|you forgot|you should have|procrastinat\w*|adhd|neglected|you always|you never|slacking|no excuse)\b/i;
    const bad: string[] = [];
    for (const f of COMPONENTS) {
      // Strip comments first: a comment may legitimately NAME the condition
      // this law exists to prevent. Everything else on the line is copy,
      // whether it is quoted or bare JSX text.
      const body = read(f)
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .split("\n")
        .map((l) => l.replace(/\/\/.*$/, ""));
      body.forEach((line, i) => {
        if (banned.test(line)) bad.push(rel(f) + ":" + (i + 1) + " " + line.trim().slice(0, 80));
      });
    }
    expect(bad).toEqual([]);
  });
});

// A LIFE IS NEVER SCORED (2026-08-25, the Life View, pick 19).
//
// The research stance behind the whole Insights surface: an importance-
// weighted life score adds no validity over the parts (Collabra 2018), and a
// single number turns a mirror into a judge. So the review surfaces may
// count, name, and compare a month to its own past, and may never grade.
// Scoped to src/review because src/bigger legitimately ranks WORK
// (rankProjects orders a queue); ranking work is triage, ranking a life is a
// verdict.
describe("LAW: a life is never scored", () => {
  it("no grading vocabulary anywhere in the review surfaces", () => {
    const banned = /\b(score[sd]?|grade[sd]?|percentile|rank(ed|ing)?|out of 100|\d+%\s*(complete|done)|life score)\b/i;
    const bad: string[] = [];
    for (const f of SOURCES.filter((x) => rel(x).startsWith("review/"))) {
      const body = read(f)
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .split("\n")
        .map((l) => l.replace(/\/\/.*$/, "").replace(/\{\/\*[\s\S]*$/, ""));
      body.forEach((line, i) => {
        if (banned.test(line)) bad.push(rel(f) + ":" + (i + 1) + " " + line.trim().slice(0, 80));
      });
    }
    expect(bad).toEqual([]);
  });

  // The delta rule from the report carried to CSS: a month down on its past
  // is muted, never alarmed. The only emphasis a delta may take is the good
  // tone on a rise; accent or danger on a delta would make the number a
  // verdict about the reader.
  it("a delta is never dressed in accent or danger", () => {
    for (const m of CSS.matchAll(/^([^{\n]*rep-delta[^{\n]*)\{([^}]*)\}/gm)) {
      expect(m[2], m[1]!.trim() + " colors a delta like a verdict").not.toMatch(/var\(--accent\)|var\(--danger\)/);
    }
  });

  // And the down direction stays the base class: no stylesheet may ever grow
  // a rep-delta-down. The absence IS the design (down = muted, wordless).
  it("there is no down-delta class to dress", () => {
    expect(CSS).not.toContain("rep-delta-down");
  });
});

describe("LAW: icon-only controls are reachable", () => {
  it("a button whose only child is an icon carries an aria-label", () => {
    const bad: string[] = [];
    for (const f of COMPONENTS) {
      for (const m of read(f).matchAll(/<button([^>]*)>\s*<[A-Z][A-Za-z]*\s+className="ic"[^>]*\/>\s*<\/button>/g)) {
        if (!/aria-label=/.test(m[1]!)) bad.push(rel(f));
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("LAW: stored shapes are versioned", () => {
  // Cost: the triage cache gained a field, the delta check never re-ran, and
  // deadlines would have been invisible on every thread already in the inbox.
  // Grandfathered: these nine predate the law and hold a single scalar or a
  // dismissed-flag, so there is no shape to evolve and renaming them would
  // throw away real user state (jarvis.appearance is Dave's chosen theme).
  // A NEW key must be versioned, and any of these that ever gains structure
  // must be versioned at that moment.
  const LEGACY = new Set([
    "jarvis.appearance", "jarvis.projstep.dismissed", "jarvis.events",
    "jarvis.attach.asked", "jarvis.setaside.last", "jarvis.firststep.dismissed",
    "jarvis.fresh.skip", "jarvis.suggestions.", "jarvis.pattern.dismissed",
  ]);

  it("every localStorage key carries a version suffix", () => {
    const bad = new Set<string>();
    for (const f of SOURCES) {
      for (const m of read(f).matchAll(/["'](jarvis\.[a-z0-9._]+)["']/g)) {
        const key = m[1]!;
        if (!/\.v\d+$/.test(key) && !LEGACY.has(key)) bad.add(key + "  (" + rel(f) + ")");
      }
    }
    expect([...bad]).toEqual([]);
  });

  // THE CHEVRON IS DRAWN, NOT DRAWN TWICE (Dave 2026-08-19, from a screenshot
  // of a mangled one on Today). `.chev` is a 7x12 box with two borders rotated
  // 45deg, so it only renders correctly on an EMPTY element. Twenty-one call
  // sites had put the class on an <svg> that already contained its own arrow:
  // the CSS then drew a rotated bordered box AROUND a second arrow, which is
  // the clipped smudge he photographed. Half the app was right and half was
  // wrong for months because nothing checked.
  it("the chevron class is never put on an svg", () => {
    const bad: string[] = [];
    for (const f of SOURCES) {
      if (/<svg[^>]*className="chev/.test(read(f))) bad.push(rel(f));
    }
    expect(bad).toEqual([]);
  });

  // ONE ICON DOOR (Dave 2026-08-22: "on the light version filled in icons
  // look MUCH better"). Light wears Phosphor's FILL weight, dark keeps the
  // lucide outline, and the pairing lives in shared/icons.tsx. A file that
  // imports lucide-react directly gets an icon with no filled twin, which
  // vanishes in light (the stylesheet hides .ic-out there) or, worse, stays
  // outline while everything around it fills. So there is exactly one door.
  it("nothing imports lucide-react except the icon module", () => {
    const bad = SOURCES
      .filter((f) => rel(f) !== "shared/icons.tsx" && /from "lucide-react"/.test(read(f)))
      .map(rel);
    expect(bad).toEqual([]);
  });

  // SECTIONS ARE DERIVED, NEVER TYPED (Dave 2026-08-22, pick 9). The Bigger
  // Picture head counted projects whose STATUS said active while the list
  // rendered all of them, so it read "Moving Now 5" over seven rows, one of
  // which carried a card saying nothing was moving there. A section head is a
  // claim about reality and must come from bucketOf, which reads real task
  // completion, not a field nobody has touched since the record was made.
  it("the bigger picture never sections by a typed status", () => {
    const src = read(SRC + "/bigger/BiggerPicturePage.tsx");
    expect(src).toContain("bucketOf");
    expect(/status === "active"/.test(src)).toBe(false);
  });

  // ONE WORD FOR ONE THING (pick 30). The project page called them Steps and
  // the Tasks tab called the same records Tasks, which taught him that filing
  // work into a project moved it somewhere else. Prop names may stay `step`;
  // the words a reader sees may not.
  it("no surface calls a task a step", () => {
    const bad: string[] = [];
    for (const f of COMPONENTS) {
      for (const m of read(f).matchAll(/(placeholder|title|aria-label)="([^"]*\bSteps?\b[^"]*)"/g)) {
        bad.push(rel(f) + ": " + m[2]);
      }
      for (const m of read(f).matchAll(/>\s*(Steps?)\s*</g)) bad.push(rel(f) + ": " + m[1]);
    }
    expect(bad).toEqual([]);
  });

  // THE HAND-DRAWN RATCHET (Dave 2026-08-22, sending examples of icons that
  // were still outline in light: the Today double-chevron, the Checklist
  // document, the note files). Not every icon came from a library -- 43
  // shapes were drawn inline as raw SVG, invisible to the icon pairing, and
  // they would have stayed outline in light while everything around them
  // filled. The 24 that NAME a thing were paired in shared/glyphs.tsx. What
  // is left is controls, which are supposed to stay outline. This number may
  // fall, never rise: a new hand-drawn glyph is a new icon with no filled
  // twin, and the mixed state comes straight back.
  it("hand-drawn icon SVGs do not multiply", () => {
    const n = SOURCES
      .filter((f) => rel(f) !== "shared/glyphs.tsx")
      .reduce((acc, f) => acc + [...read(f).matchAll(/<svg className="ic/g)].length, 0);
    expect(n).toBeLessThanOrEqual(43);
  });

  // Fill is for glyphs that NAME a thing. A control is operated WITH, and
  // Phosphor's fill weight turns those into blobs: a filled magnifier is a
  // disc, a filled "..." is a badge. Those stay outline in both themes.
  it("controls are never given a filled twin", () => {
    const src = read(SRC + "/shared/icons.tsx");
    for (const c of ["Search", "Ellipsis", "MoreHorizontal", "ChevronRight", "Plus", "X"]) {
      expect(src, `${c} must stay outline`).toMatch(new RegExp(`export const ${c} = [^;]*outline\\(`));
    }
  });

  // A SENDER OWNS ITS LINE (Dave's 10:30 screenshot, 2026-08-22). Mail
  // notices once took the one-line verb row, where the sender and the
  // subject split ~180px with the capsule and his phone rendered
  // "nikestrength H… Missi…": two fragments carrying less than one whole
  // sender. The one-line contract is for producers whose sub is a short
  // fused datum (Slid 3d, 9h ago); a sender is any length the world
  // chooses, so mail notices are ALWAYS the stacked card form.
  it("mail notices never take the one-line verb row", () => {
    const src = read(SRC + "/today/MailNotices.tsx");
    expect(/form="card"/.test(src)).toBe(true);
    expect(/form=\{[^}]*"row"/.test(src)).toBe(false);
  });

  // ARCHITECTURE C, THE HONESTY OF A TAG (Dave 2026-08-22, pick C).
  //
  // A tag is a saved filter. The temptation is to pour tagged tasks into
  // done/total so the bar moves, and the reason that is a lie is specific:
  // an ordinary task carries no completion date (only bills and recurring
  // tasks stamp lastDone), so a goal tagged Health on Tuesday would inherit
  // every Health task ever closed and open at 78% on the day it was born.
  //
  // This law RUNS the function rather than grepping it, because the property
  // is behavioural: no arrangement of tagged tasks may move the fraction.
  it("a tag never feeds a goal's done over total", () => {
    const goal = { id: "g", data: { title: "Get Fit", state: "on_track" as const, tags: ["health"] } };
    const done = [
      { id: "t1", data: { text: "a", category: "health", done: true } },
      { id: "t2", data: { text: "b", category: "health", done: true } },
    ];
    expect(reachOf(done, [], goal).progress).toBeNull();
    const mixed = [...done, { id: "t3", data: { text: "c", category: "health", done: false } }];
    expect(reachOf(mixed, [], goal).progress).toBeNull();
    // Filed work, and ONLY filed work, produces a denominator.
    const filed = [{ id: "t4", data: { text: "d", category: "health", done: true, projectId: "p" } }];
    const p = [{ id: "p", data: { title: "P", status: "active" as const, goalId: "g" } }];
    expect(reachOf([...mixed, ...filed], p, goal).progress).toEqual({ done: 1, total: 1, pct: 100 });
  });

  // A RED GLYPH WEARS THE BRAND, IN BOTH THEMES (Dave 2026-08-24: "make sure
  // all red icons in light version are Jarvis red. It looks a little off on
  // the icons there"). He was right, and the cause is the trap this codebase
  // has now hit three times: a token serving two roles gets changed for one
  // of them. --accent-chrome served the red TEXT on the page AND the red
  // glyphs on nav lists. Light took chrome down to #DA0012 so text could
  // clear 4.5:1 on paper, and every brand glyph in the app rode down with it.
  //
  // The catalog has said the right thing since V4.14: red is routed by JOB,
  // not flattened, and anything with no words in or on it takes the real
  // #FF2B3C under the 3:1 bar. This pins the token that finally implements it.
  it("brand glyphs take the glyph red, and light never pulls it down", () => {
    expect(CSS, "the token exists and is the real brand red").toMatch(/--accent-glyph:\s*#FF2B3C/);
    for (const sel of ["\\:where\\(\\.lib-ico\\)", "\\.lib-ico-brand", "\\.tip-ico"]) {
      expect(CSS, sel + " must take the glyph red").toMatch(new RegExp(sel + "[^}]*var\\(--accent-glyph\\)"));
    }
    // No theme may redefine it. The whole point is that one value clears the
    // 3:1 glyph bar on black AND on paper, so there is nothing to override.
    expect(CSS).not.toMatch(/\[data-theme=[^\]]*\][^{]*\{[^}]*--accent-glyph\s*:/);
  });

  // ...and it is legal on the worst light ground it can land on. A glyph
  // carries no words, so the bar is 3:1, not 4.5:1. Computed as a real
  // relative-luminance ratio rather than eyeballed, because eyeballing is how
  // #DA0012 got onto the icons in the first place.
  it("the glyph red clears 3:1 on every light surface", () => {
    const lum = (hex: string) => {
      const v = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!;
    };
    const ratio = (a: string, b: string) => {
      const la = lum(a), lb = lum(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };
    // page, white card, and the strict constant the palette sweep judges by
    for (const ground of ["#F3F4F9", "#FFFFFF", "#F1F2F7", "#F2F2F7"]) {
      expect(ratio("#FF2B3C", ground), "glyph red on " + ground).toBeGreaterThanOrEqual(3);
    }
  });

  // PICK 23, THE DAY IS PLANNED THROUGH THE UPWARD INDEX (2026-08-24). Plan
  // My Day has ranked goal-moving tasks above goalless ones since
  // 2026-08-09, but it could only SEE tasks filed under a project, so most of
  // his real work ranked as if it moved nothing. Both surfaces that build
  // plan candidates read the same index, or they will rank the same day
  // differently.
  it("plan candidates read the upward index, not the project chain alone", () => {
    for (const f of ["today/TodayFlow.tsx", "schedule/ScheduleFlow.tsx"]) {
      const src = read(SRC + "/" + f);
      expect(src, f).toMatch(/goal: goalTitleForTask\(goalIdx, t\)/);
      expect(src, f + " must not fall back to the filed-only lookup").not.toMatch(/goal: goalTitleOf\(/);
    }
  });

  // PICK 28, THE BRAIN IS NEVER TOLD A STORED GOAL STATUS. Every AI feature
  // in the app read `Run three times a week (on_track)` where on_track is the
  // field nothing updates, so the model has been reasoning about statuses
  // typed once, months ago. It gets the derived reading now.
  it("the AI context sends a derived goal status, never the stored one", () => {
    const src = read(SRC + "/ai/useAIContext.ts");
    expect(src).not.toMatch(/status: g\.data\.state/);
    expect(src).toMatch(/goalStatusForAI\(/);
    expect(src, "and never speaks about a dropped goal").toMatch(/liveGoals\(gl\)/);
  });

  // PICK 22, ONE SET OF ESTIMATES (2026-08-24). A project's stated size and
  // the block the planner puts on the calendar for the same work must come
  // from the same number. Two estimators drift, and the day the project says
  // "About 2h" while Plan My Day books 45 minutes is the day both stop being
  // believed.
  it("a project's size uses the planner's own learned durations", () => {
    const src = read(SRC + "/bigger/BiggerPictureFlow.tsx");
    expect(src).toMatch(/learnedDurations\(readCommittedDurations\(\)/);
    expect(src).toMatch(/estimateFor = useCallback/);
  });

  // ONE FILLED PRIMARY PER SCREEN, EVEN WHEN A SECOND DECISION ARRIVES
  // (capsule law X). An expired hold puts "Pick It Back Up" on a page that
  // already had a red "Mark Done", and two fills is the screen shouting
  // twice. Finishing drops to the quiet tier for that one case.
  it("an expired hold does not put a second red fill on the project page", () => {
    const src = read(SRC + "/projects/ProjectDetailPage.tsx");
    expect(src).toMatch(/className=\{"btn btn-block" \+ \(expired \? "" : " btn-primary"\)\}/);
  });

  // PICK 15, HEALTH IS DERIVED AND NEVER TYPED (Dave 2026-08-22).
  // GoalData.state has said whatever the goal was created with since Session
  // 6, and nothing anywhere updates it. A self-reported dashboard decaying
  // into confident nonsense is the oldest rule on this surface, and the goal
  // header was the last place still breaking it. Behavioural: a goal whose
  // stored state claims on_track, whose date has passed and whose finish line
  // is nowhere near, must read behind.
  it("a goal's health comes from evidence, not from its stored state", () => {
    const stale = { id: "g", data: { title: "G", state: "on_track" as const, by: "2026-01-01" } };
    const ctx = {
      reach: { filedIds: [], taggedIds: [], openTagged: 0, progress: null },
      tasks: [], projects: [], samples: [], today: "2026-08-24", now: Date.parse("2026-08-24T12:00:00Z"),
    };
    const state = { done: 1, target: 12, pct: 8, met: false, line: "" };
    expect(healthOf(stale, state, { kind: "count", target: 12 }, ctx, 4)).toBe("behind");
  });

  // PICK 13, A COUNT NEVER INHERITS THE HISTORY BEHIND IT. The same exposure
  // architecture C closed from the other direction: set "read 12 books" on a
  // goal watching Reading and, without the stamp, it opens at 40 of 12.
  it("a count measure counts forward from the day it was set", () => {
    const day = Date.parse("2026-08-24T12:00:00Z");
    const base = {
      reach: { filedIds: [], taggedIds: ["x"], openTagged: 0, progress: null },
      tasks: [], projects: [], today: "2026-08-24", now: day,
      samples: [{ id: "x", t: day - 400 * 86400000 }],
    };
    expect(measureState({ kind: "count", target: 12 }, base)!.done).toBe(0);
    expect(measureState({ kind: "count", target: 12, since: "2020-01-01" }, base)!.done).toBe(1);
  });

  // PICK 17, THE REASON IS WRITTEN BEFORE THE GOAL IS MARKED. A goal marked
  // dropped with no record of why is the exact state the feature exists to
  // prevent, and it is the unrecoverable half: the same ordering rule the
  // meeting booking follows (calendar first, then the reply).
  it("dropping a goal writes its decision first", () => {
    const src = read(SRC + "/bigger/BiggerPictureFlow.tsx");
    const drop = src.slice(src.indexOf("const dropGoal"), src.indexOf("const dropGoal") + 900);
    expect(drop).toMatch(/decisionsSvc\.create/);
    expect(drop.indexOf("decisionsSvc.create")).toBeLessThan(drop.indexOf("dropped: {"));
  });

  // PICK 31, LINEAGE ONLY WHEN IT MATTERS (Dave 2026-08-22). "Moves Ship the
  // App Store Launch" under a task called "Ship the App Store Launch" is
  // furniture: it costs a line on a 390px phone, it survives truncation
  // better than the task title does, and it says nothing the reader did not
  // just read. Behavioural, because the property is about two strings.
  it("a lineage line never repeats the task it sits under", () => {
    expect(movesLine("Ship the App Store Launch", "Ship the App Store Launch today")).toBeNull();
    expect(movesLine("Ship the App Store Launch", "Draft the Coach Onboarding Email"))
      .toBe("Moves Ship the App Store Launch");
  });

  // PICK 29 (Dave 2026-08-22, filed under "Remove: pays for the rest"). The
  // Noticed whisper is off Today for good. It was not deleted: the same offer
  // lives on What JARVIS Knows, which is the page about what JARVIS noticed.
  it("the Noticed line stays off the home page", () => {
    const page = read(SRC + "/today/TodayPage.tsx");
    expect(page).not.toMatch(/\{suggestions\}/);
    const flow = read(SRC + "/today/TodayFlow.tsx");
    expect(flow).not.toMatch(/<TodaySuggestions/);
    expect(read(SRC + "/brain/strands/StrandsPage.tsx")).toMatch(/<TodaySuggestions/);
  });

  // EVERY DAY PILL DECLARES ITS LIGHT INK. The pills are the palette colour
  // on a 16% tint of THEMSELVES: in dark that composites to a near-black chip
  // and reads fine, in light it composites to a pale wash of the same hue and
  // sky measured 1.6:1 (sweep 2026-08-21). A new pill that forgets its light
  // variant repeats that bug silently, so the pairing is checked here.
  it("every day pill has a light-theme ink", () => {
    const pills = new Set([...CSS.matchAll(/^\.dp-([a-z]+)\s*\{/gm)].map((m) => m[1]!));
    const lit = new Set([...CSS.matchAll(/\[data-theme="light"\]\s*\.dp-([a-z]+)/g)].map((m) => m[1]!));
    expect([...pills].filter((p) => !lit.has(p))).toEqual([]);
  });

  // PICK 1 SURVIVES A MERGE. The Now card's second segment is the one place
  // on the home page where a single task says what it is for, and it is one
  // JSX expression deep inside a 1700-line flow that two sessions edit at
  // once. It has already survived one rebase; this is so the next one is not
  // a matter of luck. Verified end to end against the demo on 2026-08-24:
  // "About 45 min · Moves Weekly date night".
  it("the Now card still says what its task moves", () => {
    const src = read(SRC + "/today/TodayFlow.tsx");
    expect(src, "gapMoves must be derived").toMatch(/const gapMoves = .*movesLine\(/);
    expect(src, "and rendered in the Now meta").toMatch(/\{gapMoves \?\? "Fits this gap"\}/);
  });

  // A GOAL'S LINE IS DERIVED ONCE. Two passes over the same data drift: the
  // list row said "No projects yet" while the hero said "8 open in your
  // tags", and both were reading the truth from different functions. The
  // page and the detail view take the SAME reach object.
  it("the bigger picture reads a goal through reach, never a second derivation", () => {
    for (const f of ["bigger/BiggerPicturePage.tsx", "bigger/GoalDetailPage.tsx"]) {
      const src = read(SRC + "/" + f);
      expect(src, f + " must not re-derive").not.toMatch(/goalProgress\s*\(/);
      expect(src, f + " must speak through reachLine").toMatch(/reachLine\(/);
    }
  });
});

// THE TAPPABLE ROW OWNS ITS OWN AREA (2026-08-24).
//
// Two bugs from one week, both mine, both the same shape: something inside a
// row that is itself role="button" took area the row needed, and neither was
// visible in the markup.
describe("LAW: a row that is a button keeps its area", () => {
  // Dave tapped an event on Schedule and got the length editor. The until
  // button carried the standard -13px hit expansion, which every other
  // control in the app uses safely because they do not sit inside a tappable
  // row. Measured in Chromium: it reached 10px up into the title's box.
  //
  // The .row-stack[role="button"]::after revert the day before was the same
  // fact discovered the other way round, when Playwright reported ".row-stack
  // intercepts pointer events" and inline rename stopped working.
  //
  // Cap, not ban: sideways expansion costs a tappable row nothing, and a few
  // px vertically into genuinely empty space is fine. What is not fine is the
  // reflex of writing -13px because that is what the 44px law wants, in the
  // one place where 44px is not available without taking it from the row.
  it("no control nested in a tappable row reaches far vertically", () => {
    const bad: string[] = [];
    // class -> the tappable row it lives inside
    const nested: Record<string, string> = {
      "sched-until-btn": ".sched-row",
      "sched-badge-btn": ".sched-row",
    };
    for (const [cls, row] of Object.entries(nested)) {
      const m = new RegExp("\\." + cls + "::after\\s*\\{([^}]*)\\}").exec(CSS);
      if (!m) { bad.push(`.${cls} has no ::after at all`); continue; }
      const inset = /inset:\s*([^;]+)/.exec(m[1] ?? "");
      if (!inset?.[1]) { bad.push(`.${cls} expands by something other than inset`); continue; }
      const parts = inset[1].trim().split(/\s+/).map((v) => Math.abs(parseFloat(v)) || 0);
      // top right bottom left, CSS shorthand rules
      const top = parts[0] ?? 0;
      const bottom = (parts.length >= 3 ? parts[2] : parts[0]) ?? 0;
      for (const [side, v] of [["top", top], ["bottom", bottom]] as [string, number][]) {
        if (v > 6) bad.push(`.${cls} reaches ${v}px ${side} inside ${row}, which is a button`);
      }
    }
    expect(bad).toEqual([]);
  });

  // .sched-actions is the orange swipe rail, positioned to bottom:0 of its
  // containing block. While the row was the only child of .sched-swipe-wrap
  // that was the row's height. B5 added the length editor as a second child,
  // so opening it grew the wrapper and the rail grew with it: measured 218px
  // of orange behind a 68px row, painting over the duration chips.
  //
  // The rail belongs to the row, so its containing block must contain only
  // the row. Anything the row expands INTO stays outside that box.
  it("the swipe rail's box holds the row and nothing that grows", () => {
    const jsx = read(SRC + "/schedule/screens/DayRow.tsx");
    // the strip exists, and both the actions and the row are inside it
    expect(jsx).toMatch(/className="sched-strip"/);
    const strip = jsx.indexOf('className="sched-strip"');
    const acts = jsx.indexOf('className="sched-actions"');
    const editor = jsx.indexOf('className="draft-edit-body"');
    expect(strip).toBeGreaterThan(-1);
    expect(acts).toBeGreaterThan(strip);
    // the editor is rendered after the strip closes, not inside it
    expect(editor).toBeGreaterThan(acts);
    // and the strip, not the wrapper, does the clipping
    expect(CSS).toMatch(/\.sched-strip\s*\{[^}]*overflow:\s*hidden/);
    expect(CSS).not.toMatch(/\.sched-swipe-wrap\s*\{[^}]*overflow:\s*hidden/);
  });
});

// TESTED IS NOT THE SAME AS WIRED (2026-08-24).
//
// The sweep that prompted this found ai/pregen.ts: 107 lines, six passing
// tests, a documented cap and a documented gate, and zero callers since the
// day it shipped. The tests all passed the whole time. Nothing in the suite
// could tell the difference between a feature and a well-tested library that
// the app never opens, which is how roughly a thousand lines accumulated
// without anyone deciding to keep them.
//
// So: a module is either reachable from the app, reachable from a serverless
// handler, or named below with the reason it is not. Anything else fails.
// The list is meant to shrink. Adding to it is a decision someone makes on
// purpose, in a commit, with a sentence saying why.
describe("LAW: every module is reachable, or is listed as not", () => {
  // Reachable means: some non-test file under src/ or api/ mentions it in an
  // import, static or dynamic. Deliberately crude, because the alternative is
  // a resolver, and a law nobody can read is a law nobody maintains.
  const ROOTS = [SRC, join(process.cwd(), "api")];

  // Not app code at all.
  const NOT_APP = [
    "main.tsx", "testMain.tsx",            // the two entry points
    "vite.config.ts", "vitest.config.ts",  // build config
    "notesSpec.ts", "tasksSpec.ts",        // written specs, read by people
    "emailBench.tsx",                      // bench harness, run by hand
    "condBench.tsx",                       // bench harness, run by hand
    "healthBench.tsx",                     // bench harness, run by hand
    "score.ts",                            // golden-set scorer, run by hand
  ];

  // Written, tested, and NOT reachable from the running app. Each line is a
  // standing decision to keep the code, and owes a reason.
  const UNWIRED: Record<string, string> = {
    // 516 lines across four files. Pure logic for the Capacitor iOS bridge:
    // contact enrichment, EventKit and HealthKit de-duplication. The web
    // build has no bridge to call it, so it cannot be wired until there is an
    // iOS build to wire it INTO. bridge.ts is imported only by its own
    // siblings, which is what makes the folder an island rather than a
    // half-connected feature.
    "bridge.ts": "iOS only: no Capacitor bridge in the web build",
    "contactsMatch.ts": "iOS only: needs the Contacts bridge",
    "eventKitDedupe.ts": "iOS only: needs the EventKit bridge",
    "healthDedupe.ts": "iOS only: needs the HealthKit bridge",
    // (fileStorage.ts left this list on 2026-09-02: files/FileStore routes
    // every upload through it, from the clip on Notes and Money.)
    // Real, tested code with nowhere to plug in yet: HealthFlow composes
    // the Share Line and the five loggers
    // over a real HealthService, but wiring it into AppShell/destinations.tsx
    // is its own task (student-athlete health track, Track 3) and out of
    // scope for the session that built the module itself. Every screen and
    // service it composes IS reachable, through this file; this is the one
    // file with nothing above it yet.
    "HealthFlow.tsx": "Health module: not wired into AppShell yet, Track 3 follow-up",
  };

  it("nothing is written, tested, and silently unreachable", () => {
    const files: string[] = [];
    for (const r of ROOTS) { try { walk(r, files); } catch { /* api/ may not exist */ } }
    const code = files.filter((f) => /\.(ts|tsx)$/.test(f) && !isTest(f) && !/\.d\.ts$/.test(f));
    const text = files
      .filter((f) => /\.(ts|tsx)$/.test(f) && !isTest(f))
      .map((f) => ({ f, t: read(f) }));

    const orphans: string[] = [];
    for (const m of code) {
      const stem = m.replace(/^.*\//, "").replace(/\.(ts|tsx)$/, "");
      if (NOT_APP.includes(stem + (m.endsWith(".tsx") ? ".tsx" : ".ts"))) continue;
      const re = new RegExp('["\'][^"\']*[./]' + stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '["\']');
      if (text.some((s) => s.f !== m && re.test(s.t))) continue;
      const base = stem + (m.endsWith(".tsx") ? ".tsx" : ".ts");
      if (base in UNWIRED) continue;
      orphans.push(base);
    }
    expect(orphans).toEqual([]);
  });

  // The other direction, and the one that makes the list shrink instead of
  // rot: once something IS wired, its excuse has to go. Without this the list
  // becomes a place stale names live forever and stop meaning anything.
  it("nothing on the unwired list is actually wired", () => {
    const files: string[] = [];
    for (const r of ROOTS) { try { walk(r, files); } catch { /* api/ may not exist */ } }
    const text = files
      .filter((f) => /\.(ts|tsx)$/.test(f) && !isTest(f))
      .map((f) => ({ f, t: read(f) }));
    const stale: string[] = [];
    for (const base of Object.keys(UNWIRED)) {
      const stem = base.replace(/\.(ts|tsx)$/, "");
      const own = files.find((f) => f.endsWith("/" + base));
      if (!own) { stale.push(base + " is on the list but no longer exists"); continue; }
      const re = new RegExp('["\'][^"\']*[./]' + stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '["\']');
      // Its own siblings do not count as wiring: that is exactly the shape
      // src/native/ has, four files importing each other and nothing else.
      // A bench harness (NOT_APP, run by hand and never part of the
      // production build) does not count either: healthBench.tsx exists
      // SPECIFICALLY to render HealthFlow for a visual check, which is the
      // opposite of AppShell reachability, not evidence of it.
      const dir = own.slice(0, own.lastIndexOf("/") + 1);
      if (text.some((s) => !s.f.startsWith(dir) && !NOT_APP.some((n) => s.f.endsWith("/" + n)) && re.test(s.t))) {
        stale.push(base + " IS wired now, take it off the list");
      }
    }
    expect(stale).toEqual([]);
  });
});

// ONE LIST OF LENGTHS (2026-08-24).
//
// schedule/durations.ts exists because PlanDaySheet had already grown a
// private copy of the duration list once. Today the sweep found a second
// fork: EventSheet declared 30m / 1h / 2h inline while the day row and the
// plan sheet offered six. The same event had a different set of lengths
// depending on which control you reached it through, and 45 minutes existed
// on two surfaces out of three.
//
// Cheap to break and invisible when broken, because a hard-coded chip row
// looks completely correct on its own screen.
describe("LAW: every surface offers the same lengths", () => {
  // Two things are wrong and everything else is a legitimate list of minutes.
  // A first pass banned every minute array in these folders and flagged the
  // reminder ladder (60/30/15/5) and the focus-sprint lengths (10/25/45),
  // which are different questions with their own named exports in their own
  // modules. A law that fires on correct code gets muted.
  //
  // So: the shared list may not be RETYPED, and no list of minutes may appear
  // in two files at once. That is exactly the shape all three real forks had.
  it("no schedule surface retypes the shared list, or shares one with another file", () => {
    const durations = read(join(SRC, "schedule/durations.ts"));
    const canon = [...durations.matchAll(/export const (\w+) = (\[[\d, ]+\])/g)]
      .map((m) => m[2]!.replace(/\s+/g, ""));
    const bad: string[] = [];
    const seen = new Map<string, string>();
    for (const f of SOURCES) {
      const r = rel(f);
      if (!r.startsWith("schedule/") && !r.startsWith("today/") && !r.startsWith("tasks/")) continue;
      if (r === "schedule/durations.ts") continue;
      const src = read(f).replace(/\/\*[\s\S]*?\*\//g, " ").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
      const lists = new Set<string>();
      for (const m of src.matchAll(/\[\s*\d{1,3}\s*(?:,\s*\d{1,3}\s*){1,}\]/g)) lists.add(m[0].replace(/\s+/g, ""));
      // The labelled-pair form EventSheet used, which the plain scan misses.
      for (const m of src.matchAll(/\[\s*\[\s*\d{1,3}\s*,\s*"[\dhm ]+"/g)) {
        bad.push(r + ": a labelled duration list, " + m[0].replace(/\s+/g, ""));
      }
      // A file that already imports a shared list and ALSO writes its own is
      // a fork by definition, even a shorter one. Without this, replacing
      // DUR_CHOICES.map with [30, 60, 120].map while leaving the import in
      // place passes both halves of this law, which is a plausible edit.
      const importsShared = /from "[^"]*durations"/.test(src);
      for (const l of lists) {
        if (canon.includes(l)) { bad.push(r + ": retypes the shared list " + l); continue; }
        if (importsShared) { bad.push(r + ": imports the shared list and declares " + l + " anyway"); continue; }
        const first = seen.get(l);
        if (first) bad.push(r + " and " + first + " both declare " + l);
        else seen.set(l, r);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the surfaces that show lengths import the shared list", () => {
    for (const f of ["schedule/screens/EventSheet.tsx", "schedule/screens/DayRow.tsx", "schedule/screens/ProposedRow.tsx"]) {
      expect(read(join(SRC, f)), f + " must use DUR_CHOICES").toContain("DUR_CHOICES");
    }
  });
});

// A SERVICE'S SURFACE IS ITS PROMISE (2026-08-24).
//
// The module reachability law one section up catches a whole file nobody
// opens. It cannot catch a method nobody calls inside a file everybody does,
// which is the shape the strand store had: StrandsService is imported and
// rendered on the Brain page, and three of its ten methods had zero callers.
// Two of them, byDerivation and refreshEvidence, were the two halves of a
// behaviour the class comment promised out loud, "a re-derivation refreshes
// the existing strand's evidence instead of growing a twin", which therefore
// never happened. accept() returned null instead and the receipts were
// dropped, and the caller read that null as "the Brain is full" and said so
// in a toast, which was a lie every time.
//
// Scoped to named service classes rather than every exported symbol on
// purpose. A first pass over everything returned 266 hits, most of them
// constants read inside their own file, and a law with 266 exemptions is a
// list, not a law.
describe("LAW: a service method is called, or is listed as not", () => {
  const SERVICES = [
    "brain/strands/StrandsService.ts",
    "rules/LearnedRulesService.ts",
  ];

  // Written, and nothing calls it. Each owes a reason and is meant to go.
  //
  // Started at four on 2026-08-24 and reached zero the same day, which is
  // what the list is for. confirm() got the Still True button the sheet had
  // been missing. recordCorrection got two real correction points, and
  // contradict came alive with it. announceIfFirstUse was the last one, and
  // it came off exactly the way it said it would: the day resolve() got a
  // caller, and in the same commit, which is the law below.
  //
  // Empty is the goal state, not a bug in the scan. The two tests either
  // side of this object still run: the first now says every method is
  // called, the second has nothing to check.
  const UNCALLED: Record<string, string> = {};

  it("every service method is called from somewhere, or is named above", () => {
    const bad: string[] = [];
    for (const rel_ of SERVICES) {
      const file = join(SRC, rel_);
      const own = read(file);
      const cls = rel_.replace(/^.*\//, "").replace(/\.ts$/, "");
      // Two spaces of indent is a class member at the top level of the class.
      const methods = [...own.matchAll(/^ {2}(?:async )?(\w+)\s*\(/gm)]
        .map((m) => m[1]!)
        .filter((n) => n !== "constructor");
      expect(methods.length, rel_ + ": found no methods, the scan is broken").toBeGreaterThan(3);
      for (const n of methods) {
        const call = new RegExp("\\." + n + "\\s*\\(");
        // Its own file counts: a method that became a private helper of
        // another method on the same class is wired, not dead. That is what
        // refreshEvidence is now.
        const called = SOURCES.some((f) => (f === file ? call.test(own.replace(new RegExp("^ {2}(async )?" + n + "\\s*\\([\\s\\S]*?^ {2}\\}", "m"), "")) : call.test(read(f))));
        if (!called && !(cls + "." + n in UNCALLED)) bad.push(cls + "." + n);
      }
    }
    expect(bad).toEqual([]);
  });

  // The half that makes the list shrink instead of rot.
  it("nothing on the uncalled list is actually called", () => {
    const stale: string[] = [];
    for (const key of Object.keys(UNCALLED)) {
      const [cls, n] = key.split(".") as [string, string];
      const file = SERVICES.map((s) => join(SRC, s)).find((f) => f.endsWith("/" + cls + ".ts"));
      if (!file) { stale.push(key + ": no such service"); continue; }
      const call = new RegExp("\\." + n + "\\s*\\(");
      if (SOURCES.some((f) => f !== file && call.test(read(f)))) stale.push(key + " IS called now, take it off the list");
    }
    expect(stale).toEqual([]);
  });
});

// A RULE NEVER ACTS IN SILENCE (2026-08-24).
//
// rules/types.ts states the deal that licenses this whole engine: "Every rule
// announces itself on first use. Visibility is what licenses creating it
// without a tap." A rule is born from two corrections with no confirmation
// step, so the announcement is the only thing standing between "JARVIS
// learned something" and "the app changed my stuff and did not say so".
//
// Right now the engine is record-only by Dave's decision: corrections are
// observed and rules are created so they can be judged in What JARVIS
// Learned, and nothing calls resolve(), so no rule acts. That makes this law
// vacuously true today, which is exactly when it is worth writing: the moment
// someone wires resolve() to a decision point, this fails unless the
// announcement is wired in the same commit.
describe("LAW: applying a rule requires announcing it", () => {
  const svc = join(SRC, "rules/LearnedRulesService.ts");
  // Only files that actually HOLD a rules service count. Matching ".resolve("
  // alone found Promise.resolve and four unrelated services, which is the
  // kind of noise that gets a law muted.
  const holdsRules = (t: string) => /useRules\(\)|useOptionalRules\(\)|LearnedRulesService/.test(t);
  const callers = (method: string) =>
    SOURCES.filter((f) => {
      if (f === svc) return false;
      const t = read(f);
      return holdsRules(t) && new RegExp("\\." + method + "\\s*\\(").test(t);
    }).map(rel);

  it("nothing consults a rule without also announcing it on first use", () => {
    const applies = callers("resolve");
    const announces = callers("announceIfFirstUse");
    // Not "somebody somewhere announces": the file that ACTS on a rule is the
    // file that has to say so, because that is where first use happens.
    const silent = applies.filter((f) => !announces.includes(f));
    expect(silent, "these apply a learned rule without announcing it").toEqual([]);
  });

  // THE TRIGGER COMES FROM THE RAW LINE (2026-08-24).
  //
  // Both halves of the loop derive a trigger with aliasTrigger, and they have
  // to agree or a correction never matches its own lookup. They briefly did
  // not: both read `title`, which has been through titleCase, which
  // capitalises every meaningful word. "Elite Squad practice" became "Elite
  // Squad Practice" and the proper-noun heuristic then returned the ENTIRE
  // title, which is the safe-and-useless option triggers.ts explicitly
  // rejects. Nobody pastes the same full sentence twice, so no rule would
  // ever have been born.
  //
  // Nothing would have failed. No error, no warning, no wrong output: an
  // engine that quietly never learns anything, which is indistinguishable
  // from the engine being switched off.
  it("no trigger is ever derived from a title", () => {
    const bad: string[] = [];
    for (const f of SOURCES) {
      const src = read(f);
      if (!/aliasTrigger\(/.test(src)) continue;
      for (const m of src.matchAll(/aliasTrigger\(([^)]*)\)/g)) {
        const arg = m[1]!.trim();
        if (/title/i.test(arg)) bad.push(rel(f) + ": aliasTrigger(" + arg + ")");
      }
    }
    expect(bad, "titleCase destroys the capitalisation the trigger reads").toEqual([]);
  });

  // The correction points wired on 2026-08-24. Without them the engine is
  // back to where it was: a settings page that can only ever be empty.
  it("real corrections are still being recorded", () => {
    const rec = callers("recordCorrection");
    expect(rec).toContain("capture/QuickCapture.tsx");
    expect(rec).toContain("schedule/screens/PlanDaySheet.tsx");
  });

  // The announcement fires on first USE. In record-only mode nothing is ever
  // used, so nothing is ever announced, so a contradiction must die quietly:
  // "Forgot the rule X" about a rule he was never told existed is the same
  // lie as the strand toast that said the Brain was full when it was not.
  it("a rule that was never announced dies without a toast", () => {
    const src = read(svc);
    const body = /async contradict\([\s\S]*?\n  \}/.exec(src)?.[0] ?? "";
    expect(body, "contradict must guard its toast on announced").toMatch(/if\s*\(\s*rule\.data\.announced\s*\)/);
  });
});

// THE BAR HAS NO ROOM (Dave 2026-08-25: "when I do big picture wraps").
//
// A destination's page title and its tab label were one string, so naming a
// page Bigger Picture named a tab Bigger Picture, and at six tabs each one
// gets about 65px: four to seven characters at the tab type size. Fourteen
// wrapped onto two lines and pushed the bar taller than every other tab.
//
// The fix was to let the bar carry its own word. This is what stops the next
// long name from arriving without one.
describe("LAW: a tab label fits on one line", () => {
  // Measured against the bar, not guessed: six tabs across a 390px phone is
  // 65px each, and the tab type is small enough that eight characters is the
  // honest ceiling once the label has any padding at all.
  const MAX = 8;

  it("every destination's tab label is short enough for the bar", () => {
    const src = read(join(SRC, "shell/destinations.tsx"));
    const bad: string[] = [];
    for (const m of src.matchAll(/\{\s*key:\s*"(\w+)",\s*label:\s*"([^"]+)"(?:,\s*tabLabel:\s*"([^"]+)")?/g)) {
      const shown = m[3] ?? m[2]!;
      if (shown.length > MAX) bad.push(`${m[1]}: the bar would show "${shown}" (${shown.length} chars)`);
    }
    expect(bad, "give it a tabLabel").toEqual([]);
  });

  // And the bar must actually USE it. A tabLabel nothing reads is the same
  // wrap with an extra field.
  it("the bar renders the short label", () => {
    expect(read(join(SRC, "shell/TabBar.tsx"))).toContain("tabLabelOf");
  });
});

// LAW: A RECEIPT NAMES WHAT LANDED (Dave 2026-08-25, from the email audit).
//
// Six places in the mail module ran a batch of Gmail writes like this:
//
//     for (const r of hit) apiFor(r.account)?.modifyThread(r.id, [], ["INBOX"]).catch(() => {});
//     say(hit.length + " conversations archived");
//
// Every failure is swallowed by the empty catch, the number in the receipt is
// the size of the BATCH, and two of those sites feed the day's cleared count
// that this app's own copy calls "counted, never estimated". The mail comes
// back on the next load and the app never mentions it.
//
// The correct shape existed for one row (archiveRow un-hides it and says so)
// and was never generalised, so every batch written after it repeated the bug.
// settle.ts is that shape written once. This is what stops the seventh.
describe("LAW: a receipt names what landed, not what was attempted", () => {
  // The Gmail mutations. A read that fails shows an error state; a WRITE that
  // fails and is swallowed becomes a false receipt, which is the whole point.
  const MUTATIONS = /\b(modifyThread|trashThread|untrashThread|sendMessage|deleteDraft)\s*\(/;

  it("no mail write discards its failure with an empty catch", () => {
    const bad: string[] = [];
    for (const f of ALL) {
      if (isTest(f) || isBench(f)) continue;
      const r = rel(f);
      if (!r.startsWith("messages/") && !r.startsWith("today/") && !r.startsWith("connections/google/")) continue;
      const src = read(f);
      src.split("\n").forEach((line, i) => {
        // A comment quoting the bad shape is how settle.ts explains itself.
        if (/^\s*(\/\/|\*)/.test(line)) return;
        if (!MUTATIONS.test(line)) return;
        // `.catch(() => {})` on the same line, which is how all six were written.
        if (/\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(line)) {
          bad.push(`${r}:${i + 1}  ${line.trim().slice(0, 90)}`);
        }
      });
    }
    expect(bad, "run it through settleAll and report the real count").toEqual([]);
  });

  // The other half. A batch may await honestly and still print the wrong
  // number, which is what "N archived" did while N was the input length.
  it("the batch sites route their receipts through settleLine", () => {
    const src = read(join(SRC, "messages/MessagesFlow.tsx"));
    expect(src, "MessagesFlow runs batch mail writes and must count them")
      .toContain("settleAll");
    expect(src, "and must report the counted result, not the batch size")
      .toContain("settleLine");
  });
});

// LAW L1: RED IS A VERB, NEVER A STATUS (Dave 2026-08-25, the Anti-Inbox
// catalog, adopted).
//
// The red badge is the single most-studied anxiety mechanic in email: it
// exploits the brain's need for closure, it only ever counts up, and it turns
// "you have mail" into "you are behind". Red in this app means TAP ME TO ACT.
// It never means you are late, and it never counts your failures.
//
// Red marking a WIN is still red doing its job: the streak square that colors
// in on the finish screen is an accent because clearing the deck is the good
// outcome. What is banned is red attached to lateness, unreadness, or a
// count of undone things.
describe("LAW L1: red is a verb, never a status", () => {
  const EMAIL_PREFIXES = ["messages/", "today/MailNotices", "today/NoticeCard"];
  const inEmail = (f: string) => EMAIL_PREFIXES.some((p) => rel(f).startsWith(p));

  // Class names that describe a STATE OF FAILURE. If one of these is painted
  // with the accent anywhere in the stylesheet, red has become a status.
  //
  // "badge" and "count" were in this list and have been REMOVED. They named
  // a shape rather than a sin, and they cost two false positives on the day
  // the law went app-wide: `.promo-badge` is a glyph in a coloured circle,
  // and `.sched-badge` is the word "Overlaps" on a button whose aria-label
  // is "Overlaps another event, tap to fix". That second one is red doing
  // exactly its job. Red means TAP ME TO ACT, and a red thing you tap to
  // fix the problem it names is the definition, not a breach of it.
  //
  // Counts are still caught, harder than before, by the two structural
  // tests below: red plus a NUMBER at the render site, and red badge rules
  // with nobody to fill them. What is left here is the vocabulary of
  // lateness, which is a sin in any shape.
  const GUILT = /\.(?:[a-z-]*)(overdue|late|unread|behind)(?:[a-z-]*)\b[^{]*\{[^}]*(--accent|--accent-fill|--sys-red|--bad)\b/gi;

  // WIDENED APP-WIDE 2026-08-25 (Dave). L1 was written for email and scoped
  // to email, which left the same mechanic running one tab over: the Tasks
  // tab wore a permanent red pill counting overdue + due-today. That is the
  // exact object the catalog was written against, and scoping the law to the
  // surface that happened to prompt it was the mistake. A law that only
  // holds where you first noticed the problem is a preference.
  // NARROWED 2026-09-01, BY RULING. Three separate catalog decisions that day
  // put red on lateness on purpose, each with the mechanic stated:
  //   the urgency chip: "Red: past due, distance in days, then weeks, capped"
  //   the due tile:     "Neutral until something is actually late, then
  //                      amber, then red"
  //   the count badge:  "Red only when something is genuinely overdue"
  // None of them is the object this law was widened against. That object was
  // a PERMANENT red pill counting overdue plus due-today, so red fired on a
  // day when nothing was late. The ruled classes are the opposite mechanic:
  // they do not exist at all until something has actually slipped, and the
  // late tile is a tap that lands on the Overdue filter, which is the law's
  // own definition of legal red ("a red thing you tap to fix the problem it
  // names"). So the two classes are named here, one by one, and everything
  // else stays under the rule. Adding a third means writing its ruling here.
  const RULED_LATENESS = new Set([".st-late", ".u-late"]); // both scoped under .ruled in ruled.css
  it("no class anywhere paints lateness or a count in red, except the two ruled on 2026-09-01", () => {
    const bad = [...CSS.matchAll(GUILT)]
      .map((m) => m[0].split("{")[0]!.trim())
      .filter((sel) => !RULED_LATENESS.has(sel));
    expect(bad, "red means tap me, never you are behind").toEqual([]);
  });
  it("the ruled lateness classes render only when something is actually late", () => {
    // The exemption above is earned by the render condition, not by the
    // class name. Both sites must be gated in TodayPage.
    const page = readFileSync(join(SRC, "today/TodayPage.tsx"), "utf8");
    expect(page).toMatch(/summary\.overdue >= 3 \? "st-late" : "st-warn"/);
    expect(page).toMatch(/summary\.overdue > 0 && \(/);
    expect(page).toMatch(/dist\.kind === "late" \? "u-late" : "u-today"/);
  });

  // THE SIN IS RED PLUS A NUMBER, not the word "badge" in a class name.
  //
  // Widening this test app-wide first flagged seven sites, and four of them
  // were `.promo-badge`: a 52px amber or purple circle holding a GLYPH. No
  // count, no red, no status of failure. The regex was matching the name of
  // the thing rather than the thing, which is a law grading vocabulary.
  //
  // So it now requires a NUMBER to be rendered inside the badge. A glyph
  // container called a badge is a container; a badge holding a count is the
  // guilt meter, whatever it is called.
  it("nothing renders a badge holding a count", () => {
    const bad: string[] = [];
    // A number, a counted expression, or a truncated overflow ("99+").
    const COUNTY = /\{[^}]*\b(count|length|total|overdue|due|unread|pending|remaining|n)\b[^}]*\}|>\s*\d+\s*<|"\d+\+"/;
    for (const f of COMPONENTS) {
      read(f).split("\n").forEach((line, i) => {
        if (!/className=["'{`][^"'}`]*\bbadge\b/.test(line)) return;
        if (!COUNTY.test(line)) return;
        bad.push(rel(f) + ":" + (i + 1));
      });
    }
    expect(bad, "a count on a tab is a guilt meter wearing a notification costume").toEqual([]);
  });

  // The CSS half of the same idea: no rule that paints a badge red may also
  // be the one a count lands in. Checked structurally rather than by name,
  // because the class that carried this for months was called `.tab-badge`
  // and looked perfectly innocent in a stylesheet.
  it("no red badge rule survives with nothing to fill it", () => {
    const reds = [...CSS.matchAll(/\.([a-z][a-z0-9-]*badge[a-z0-9-]*)\s*\{[^}]*(?:--accent-fill|--sys-red|--on-light-red)\b[^}]*\}/gi)]
      .map((m) => m[1]!);
    const src = COMPONENTS.map((f) => read(f)).join("\n");
    const dead = reds.filter((c) => !new RegExp("\\b" + c + "\\b").test(src));
    // A red badge class with no user is a loaded gun in a drawer: the next
    // person to want a count finds it already styled and reaches for it.
    expect(dead, "delete unused red badge rules, do not leave them lying about").toEqual([]);
  });

  it("the shell hands NO tab a badge", () => {
    const shell = read(join(SRC, "shell/AppShell.tsx"));
    const m = /badges=\{\{([^}]*)\}\}/.exec(shell);
    expect(m?.[1]?.trim() ?? "", "no tab carries a count").toBe("");
  });

  it("no email copy counts unread mail at the user", () => {
    const bad: string[] = [];
    for (const f of ALL) {
      if (isTest(f) || isBench(f)) continue;
      read(f).split("\n").forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return; // a comment may name the sin
        // "UNREAD" in caps is Gmail's LABEL, passed to modifyThread. The sin
        // is the WORD shown to a person, so the check is case-sensitive on
        // the lowercase form and wants a number beside it.
        if (/\d+\s+unread|unread\s+(mail|email|message)/.test(line)) bad.push(rel(f) + ":" + (i + 1));
      });
    }
    expect(bad, "the number of unread emails is never the headline").toEqual([]);
  });
});

// LAW: A SHELL ADDS NO PADDING TO THE ROW IT CARRIES (2026-08-26).
//
// MailSwipe wraps each mail row in a .task-row so the swipe gesture and
// reveal are the one shared mechanism. But .task-row is in the shared
// row-padding rule, because in TASKS it IS the row. Stacked around a .row
// that brings its own padding, the two padded every mail row with 24px of
// black: on Dave's phone that read as a 56pt dead gap after every single
// row, down the entire inbox, and a walk that measured .row instead of the
// block that contains it reported the list healthy.
//
// The fix is the .swipe-shell modifier, and this law holds both halves of
// it together: the wrapper must wear the class, and the class must zero the
// padding. Lose either and the ghosts return.
describe("LAW: a shell adds no padding to the row it carries", () => {
  it("every mail shell's task-row wears swipe-shell", () => {
    // Both mail swipe wrappers nest a padded .row; the first version of this
    // law named only MailSwipe and the very first walk after it found
    // LetGoSwipe still carrying the ghost on the Waiting On list.
    for (const f of ["messages/MailSwipe.tsx", "messages/LetGoSwipe.tsx"]) {
      expect(read(join(SRC, f)), f).toMatch(/"task-row swipe-shell"/);
    }
  });
  it("swipe-shell zeroes the padding the shared rule adds", () => {
    const m = CSS.match(/\.task-row\.swipe-shell\s*\{([^}]*)\}/);
    expect(m, "the swipe-shell rule must exist").toBeTruthy();
    expect(m![1]).toMatch(/padding:\s*0/);
    expect(m![1]).toMatch(/min-height:\s*0/);
  });
});

// LAW L4: NO SCREEN PROMISES A SCREEN (2026-08-26).
//
// BrainFlow carried a fallback reading "This area is coming soon." It was
// unreachable in practice, because every key the Brain hub offers is handled
// by a branch above it. It was not harmless. It was read as an App Store
// blocker twice: once by a session doc, once by me, both times by grepping
// for placeholder copy and believing what came back. Two people spent real
// time on a defect that did not exist.
//
// Shipped copy is a claim about what the app does. "Coming soon" claims a
// screen has not been built, and a screen that IS built should never say so.
// If a surface genuinely is not ready, it does not get a row on a hub.
describe("LAW L4: no screen promises a screen", () => {
  const EXCUSES = /coming soon|under construction|not (?:yet )?implemented|work in progress|\bTBD\b|\bTODO\b(?=[^a-z])|placeholder text|lorem ipsum/i;

  it("no shipped copy tells a person to come back later", () => {
    const bad: string[] = [];
    for (const f of ALL) {
      if (isTest(f) || isBench(f)) continue;
      read(f).split("\n").forEach((line, i) => {
        // A comment may name the sin: this law's own history is written in
        // one, and so is the note in BrainPage that records the fix.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        // Only judge STRING LITERALS and JSX text, never identifiers.
        const copy = [
          ...[...line.matchAll(/"([^"\\]{4,120})"/g)].map((m) => m[1]!),
          ...[...line.matchAll(/>([^<>{}]{4,120})</g)].map((m) => m[1]!),
        ];
        if (copy.some((c) => EXCUSES.test(c))) bad.push(rel(f) + ":" + (i + 1) + " " + line.trim().slice(0, 60));
      });
    }
    expect(bad, "a screen that exists never says it does not").toEqual([]);
  });

  it("every area the Brain hub offers is actually routed", () => {
    // The structural version of the same rule: a hub row with nothing behind
    // it is the bug the copy was covering for. Catching it here means the
    // copy never has to exist.
    const page = read(join(SRC, "brain/BrainPage.tsx"));
    const flow = read(join(SRC, "brain/BrainFlow.tsx"));
    const keys = [...page.matchAll(/\{\s*key:\s*"([a-z]+)"/g)].map((m) => m[1]!);
    expect(keys.length, "the hub should still offer areas").toBeGreaterThanOrEqual(6);
    const unrouted = keys.filter((k) => !new RegExp('open\\.key === "' + k + '"').test(flow)
      && !new RegExp('^\\s*' + k + ':', "m").test(flow));
    expect(unrouted, "a row on the hub with nothing behind it").toEqual([]);
  });
});

// LAW L2: EVERY LIST HAS A FLOOR (Dave 2026-08-25, adopted with L1).
//
// Nothing in email scrolls forever. Every list ends with a visible line that
// says "That's everything." An edge you can reach is the difference between a
// task and an ocean, and it is the cheapest anxiety fix in the whole catalog.
describe("LAW L2: every list has a floor", () => {
  it("every email screen that renders a list also renders its floor", () => {
    const bad: string[] = [];
    for (const f of COMPONENTS) {
      const r = rel(f);
      if (!r.startsWith("messages/")) continue;
      // A SHEET is bounded by its own frame: you can see where a five-option
      // menu ends without being told. The floor is for lists you scroll, and
      // putting one under a modal's option list is noise, not reassurance.
      if (/Sheet\.tsx$/.test(r)) continue;
      const src = read(f);
      // A list surface is one that lays rows out in the flat-list container.
      if (!src.includes("list-flat")) continue;
      if (!/ListFloor|list-floor|sweep-floor/.test(src)) bad.push(r);
    }
    expect(bad, "import ListFloor and end the list with it").toEqual([]);
  });

  it("the floor's words answer 'am I done', not 'is the array empty'", () => {
    const src = read(join(SRC, "shared/ListFloor.tsx"));
    expect(src).toContain("That's everything.");
    // Judged on the CODE, not the prose: the first cut read its own comment
    // (which names the banned phrases in order to ban them) and failed.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    expect(code, "the floor answers 'am I done', not 'is the array empty'")
      .not.toMatch(/end of list|no more items|nothing to show/i);
  });
});

// GYM CATALOG §4.1, THE BACK-OFF WEEK IS NEVER "DELOAD" AND NEVER RED
// (2026-08-27). A lighter week is a plan a coach wrote on purpose, not a
// status the athlete should feel bad about -- the exact reasoning L1 already
// applied to red as a status rather than a verb. "Deload" reads as failure
// (the catalog's own ruling); the app calls it a back-off week, everywhere.
describe("LAW: a back-off week is never called deload and never rendered red", () => {
  it("no gym source ever writes the word deload as copy (comments may name the ban)", () => {
    // Comments are allowed to SAY the banned word in order to explain why it
    // is banned -- same allowance the "app never scolds" law makes above.
    // What may never happen is the word reaching a screen.
    const bad: string[] = [];
    for (const f of SOURCES.filter((x) => rel(x).startsWith("gym/"))) {
      const code = read(f)
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
      if (/deload/i.test(code)) bad.push(rel(f));
    }
    expect(bad, 'a lighter week is a "back-off week", never a "deload"').toEqual([]);
  });

  it("nothing that renders a week's back-off state pairs it with a red or danger class", () => {
    // A structural check, not a vocabulary list: any line that mentions
    // backOff and ALSO reaches for a red/danger/accent-fill class is the
    // exact bug this law exists to catch, whichever file it ships in.
    const RED = /\b(pill-red|btn-danger|--accent-fill|--danger-tx|--sys-red)\b/;
    const bad: string[] = [];
    for (const f of SOURCES.filter((x) => rel(x).startsWith("gym/") && x.endsWith(".tsx"))) {
      read(f).split("\n").forEach((line, i) => {
        if (/backOff/.test(line) && RED.test(line)) bad.push(`${rel(f)}:${i + 1} ${line.trim().slice(0, 90)}`);
      });
    }
    expect(bad, "a back-off week is a lighter plan, never a status painted red").toEqual([]);
  });

  it("the back-off tag uses the app's existing neutral pill, not a new red one", () => {
    const src = read(join(SRC, "gym/GymFlow.tsx"));
    expect(src, "back-off reads through .pill-subdued (the app's neutral pill)").toMatch(/backOff[\s\S]{0,80}pill-subdued|pill-subdued[\s\S]{0,80}week-back-off/);
  });
});

// ============================================================
// THE NOTICE LAWS (Dave 2026-08-29, after a full functional audit:
// "notifications show up on things that are already done. The buttons don't
// add any real value for the most part").
//
// The stale-notice bugs were not nine separate mistakes. They were one
// missing rule, broken nine times: a notice was built from something written
// down earlier -- a sweep receipt, a mail snapshot, a bookmark -- and then
// trusted for the rest of the day without ever asking the live data whether
// it was still true. These lock the rule in.
// ============================================================
describe("LAW: a notice proves itself before it renders", () => {
  it("the sweep receipt is never read straight into a card", () => {
    // liveMoved() is the checkpoint: it takes the receipt and the live task
    // list and drops everything since done, deleted, or re-dated. Anything
    // reaching for receipt.moved to DISPLAY, rather than through liveMoved,
    // is the bug Dave photographed coming back.
    const src = read(join(SRC, "today/TodayFlow.tsx"));
    const bad = src.split("\n")
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /sweepReceipt[?.]*\.moved/.test(l))
      // undoSweep and the welcome-back count are about what the sweep DID,
      // which is the one honest use of the raw receipt: it is history there,
      // not status.
      .filter(({ l }) => !/welcomeBack|undoSweep/.test(l))
      .map(({ l, i }) => `TodayFlow.tsx:${i + 1} ${l.trim().slice(0, 80)}`);
    expect(bad, "read the receipt through liveMoved(), never straight into a card").toEqual([]);
  });

  it("liveMoved actually checks done, existence, and the date", () => {
    const src = read(join(SRC, "tasks/autoSweep.ts"));
    const fn = src.slice(src.indexOf("export function liveMoved"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body, "a task deleted since the sweep is not news").toMatch(/if \(!t\) return false/);
    expect(body, "a task finished since the sweep is not news -- the whole complaint").toMatch(/t\.data\.done/);
    expect(body, "a task re-dated since the sweep is not today's news").toMatch(/due === today/);
  });

  it("the Where You Were bookmark can be asked whether its thing still exists", () => {
    const src = read(join(SRC, "restore/whereYouWere.ts"));
    expect(src, "restorableSpot takes an existence check").toMatch(/exists\?: \(spot: WorkSpot\) => boolean/);
    expect(src, "and honours it").toMatch(/if \(exists && !exists\(spot\)\) return null/);
    // The caller has to actually pass one, or the parameter is decoration.
    const flow = read(join(SRC, "today/TodayFlow.tsx"));
    expect(flow, "Today looks the spot's target up before offering Resume").toMatch(/notesSvc\.note\(s\.id\)/);
  });

  it("acting on a mail card outlives the tab switch", () => {
    // AppShell remounts each flow by key, so in-memory "I handled this"
    // state resurrected replies he had already sent. Handled has to persist.
    const src = read(join(SRC, "today/MailNotices.tsx"));
    expect(src, "markDone persists, it does not only setState").toMatch(/const markDone[\s\S]{0,220}dismissNotice\(key, today\)/);
    const bad = src.split("\n")
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /setDone\(\(d\) => \[\.\.\.d,/.test(l))
      .map(({ i }) => `MailNotices.tsx:${i + 1}`);
    expect(bad, "mark a card handled through markDone(), which writes it down").toEqual([]);
  });

  it("the notifications feed is given a clock, so a finished event stops notifying", () => {
    const feed = read(join(SRC, "notifications/feed.ts"));
    expect(feed, "buildFeed takes the time of day").toMatch(/nowHHMM\?: string/);
    expect(feed, "and drops events already over").toMatch(/e\.data\.end \?\? e\.data\.start\) > nowHHMM/);
    const flow = read(join(SRC, "notifications/NotificationsFlow.tsx"));
    expect(flow, "and the screen actually passes one").toMatch(/buildFeed\([\s\S]{0,120}nowHHMM/);
  });
});

describe("LAW: dismiss means only dismiss, and it expires", () => {
  it("no control labelled Dismiss performs a write", () => {
    // The sweep card's Dismiss used to run undoSweep: a swipe that silently
    // rewrote every moved task's due date back to yesterday, emptying Today
    // of work he had already seen arrive. Undo is a real action and keeps
    // its place -- under its own name, in the toast.
    const src = read(join(SRC, "today/TodayFlow.tsx"));
    const bad = src.split("\n")
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /onDismiss=/.test(l) && /undoSweep|setDue|deleteTask|setAside\(/.test(l))
      .map(({ l, i }) => `TodayFlow.tsx:${i + 1} ${l.trim().slice(0, 80)}`);
    expect(bad, "a dismiss hides a card; it never edits the user's data").toEqual([]);
  });

  it("every notice on Today can be dismissed", () => {
    // The Resume card shipped with an empty swipe rail: the only exits were
    // taking it or waiting twelve hours, and any visit older than five
    // minutes re-armed it. A notice you cannot wave off is a notice you
    // learn to resent.
    const src = read(join(SRC, "today/TodayFlow.tsx"));
    const cards = src.split(/<NoticeCard\b/).slice(1);
    const bad = cards
      // To the closing tag on its OWN line. Plain indexOf("/>") stopped at
      // the first self-closing glyph inside a prop -- icon={<TargetGlyph />}
      // -- and truncated the card before its later props were seen.
      .map((c) => { const e = c.search(/\n\s*\/>/); return e === -1 ? c : c.slice(0, e); })
      .filter((c) => /key="/.test(c))
      .filter((c) => !/onDismiss|onDelete/.test(c))
      // A receipt reports something already finished and has nothing to
      // dismiss; the failed-sweep card is an error that must not be
      // swipeable away while the failure stands.
      .filter((c) => !/key="(sweepfail|revisit)"/.test(c))
      .map((c) => (c.match(/key="([^"]+)"/) ?? [])[1] ?? "?");
    expect(bad, "these notices offer no way out").toEqual([]);
  });

  it("a dismissal is day-keyed or expiring, never permanent", () => {
    const sweep = read(join(SRC, "tasks/autoSweep.ts"));
    expect(sweep, "the offered list ages out").toMatch(/DISMISS_DAYS/);
    expect(sweep, "and stores when, not just what").toMatch(/\{ id: string; day: string \}|Offer = \{ id/);
    const feed = read(join(SRC, "notifications/feed.ts"));
    expect(feed, "notification dismissals reset with the day").toMatch(/p\.day !== today/);
  });
});

// LAW 4: RED IS RATIONED, AND NOTHING IS RED BY DEFAULT (Dave 2026-08-29,
// Wave 3 of the notice audit).
//
// L1 already says red is a verb, not a status, and B15 already says one
// filled red per screen. Neither of them looks at the NOTICE TONE, which is
// the one red on this app's most-visited surface that nothing was counting.
//
// Two holes, both found by reading NoticeCard rather than by walking a
// screen:
//
// 1. THE FALLBACK WAS RED. `tone ?? "cat-fg-red"` meant a producer who
//    forgot to pass a tone shipped an alarm. Every caller happened to pass
//    one, so no screen was wrong -- which is precisely why it survived. The
//    next notice anyone adds would have been red until Dave found it.
//
// 2. RED WAS FREE. Any producer could type it, and one had: the monthly
//    report, a pleasant optional thing, wore the colour of a fire.
//
// So red on a notice is now an allowlist with a written reason, in the same
// shape as the one-filled-red law's EXCLUSIVE map. Adding a red notice means
// arguing for it here, in front of the other two, which is the point.
describe("LAW 4: red is rationed, and nothing is red by default", () => {
  it("NoticeCard's fallback tone is not red", () => {
    const src = read(join(SRC, "today/NoticeCard.tsx"));
    expect(src, "the fallback is named once, not typed three times")
      .toMatch(/const DEFAULT_TONE = "cat-fg-(?!red)[a-z]+"/);
    expect(src, "no tone fallback may be red").not.toMatch(/tone \?\? "cat-fg-red"/);
  });

  // Each entry is a render site allowed to be red, and why. The reason has
  // to be checkable by reading the file.
  const ALLOWED: Record<string, string> = {
    "today/TodayFlow.tsx": "the failed-sweep card: an error, with Retry, that is red saying TAP ME (weight FAILING)",
    "messages/home.ts": "deadlineNotice, gated on byRank(t.by, now) <= 1, so the deadline is TODAY and nothing else reaches it",
  };

  it("no notice is red unless this law says so, by name and reason", () => {
    const bad: string[] = [];
    for (const f of SOURCES) {
      const name = rel(f);
      if (ALLOWED[name]) continue;
      read(f).split("\n").forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return; // a comment may name the sin
        if (/tone\s*[=:]\s*["']cat-fg-red["']/.test(line)) bad.push(name + ":" + (i + 1));
      });
    }
    expect(bad, "red on a notice needs an argument, not a keystroke").toEqual([]);
  });

  // A diet is a number. Two producers, and the third one has to displace a
  // current holder rather than join them.
  it("the whole app has at most two red notice producers", () => {
    let n = 0;
    for (const f of SOURCES) {
      read(f).split("\n").forEach((line) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        if (/tone\s*[=:]\s*["']cat-fg-red["']/.test(line)) n++;
      });
    }
    expect(n, "if a third red is worth having, one of the two is not").toBeLessThanOrEqual(2);
  });

  // Red claims urgency, so a red notice may not also be the calm one. The
  // failed sweep declares FAILING; anything red that declares a weight must
  // declare that band.
  it("a red notice that names a weight names the top band", () => {
    const flow = read(join(SRC, "today/TodayFlow.tsx"));
    const card = flow.slice(flow.indexOf('key="sweepfail"'));
    const end = card.search(/\n\s*\/>/);
    const props = card.slice(0, end);
    expect(props, "the one red card in TodayFlow is the failure").toMatch(/tone="cat-fg-red"/);
    expect(props, "and it carries FAILING").toMatch(/weight=\{FAILING\}/);
  });
});

// LAW 5: ONE DOOR PER DESTINATION, PER SCREEN (Dave 2026-08-29, Wave 4 of
// the notice audit: "the buttons don't add any real value for the most
// part. There's no hierarchy").
//
// A duplicate door is two visible controls, rendered at the same time, that
// call the same handler. It looks like generosity and costs like clutter:
// the second control adds no capability, takes a real slot in the visual
// hierarchy, and makes the eye ask "are these different?" every single time.
// For an ADHD user, that question is the tax.
//
// The audit found eleven pairs. All eleven were fixed by GATING the weaker
// door, never by deleting the handler, so the destination is always
// reachable: it is reached from one place at a time instead of two.
//
// This test cannot see across files (TodayPage composing YourDay, the mail
// band's head over its own foot), so those fixes are pinned by the props
// that carry the signal, which IS checkable. Within a single file, the
// duplicate-handler scan is real.
describe("LAW 5: one door per destination, per screen", () => {
  // WHAT THIS CANNOT DO, said out loud: a source scan cannot evaluate
  // branch conditions, so two calls to one handler in a file are only a
  // finding if nothing gates them apart. The gate is the thing being
  // asserted, so the check is that a gate EXISTS beside each pair, which is
  // exactly what the eleven fixes added.
  const PAIRS: { file: string; handler: RegExp; gate: RegExp; why: string }[] = [
    {
      file: "messages/MessagesFlow.tsx",
      handler: /setWaitDeck\(0\)/g,
      gate: /triageState !== "ready"|WAVE 4/,
      why: "One at a Time was a launcher row AND a head link",
    },
    {
      file: "today/TodayPage.tsx",
      handler: /onClick=\{onSeeAllTasks\}/g,
      gate: /foldedTasks <= 0/,
      why: "the evening head See All sat above a fold receipt doing the same thing",
    },
    {
      file: "upnext/UpNextFlow.tsx",
      handler: /onClick=\{startWins\}/g,
      gate: /!offerWins &&/,
      why: "the Quick Wins chip and the Deal Five block button",
    },
  ];

  it("every known duplicate pair still has the gate that separated it", () => {
    for (const p of PAIRS) {
      const src = read(join(SRC, p.file));
      const n = [...src.matchAll(p.handler)].length;
      if (n < 2) continue; // one door left: the pair was collapsed outright
      expect(src, `${p.file}: ${p.why}`).toMatch(p.gate);
    }
  });

  // The cross-file fixes each thread ONE prop whose only job is to tell the
  // outer component that the inner one is already showing the door. Delete
  // the prop and the duplicate silently returns, so the props are the law.
  it("the cross-file gates are still wired end to end", () => {
    const page = read(join(SRC, "today/TodayPage.tsx"));
    const yourDay = read(join(SRC, "today/YourDay.tsx"));
    const flow = read(join(SRC, "today/TodayFlow.tsx"));
    const mail = read(join(SRC, "today/MailNotices.tsx"));

    // Plan Tomorrow: the Tomorrow section head owns it when there is a
    // Tomorrow section to head.
    expect(yourDay, "YourDay accepts tomorrowShown").toMatch(/tomorrowShown\?: boolean/);
    expect(yourDay, "and uses it to stand down").toMatch(/onPlanTomorrow && !tomorrowShown/);
    expect(page, "TodayPage supplies it from the section it actually renders")
      .toMatch(/tomorrowShown=\{!!tomorrowSection\}/);

    // Open Inbox: the band's foot receipt owns it when there is a residual.
    expect(mail, "MailNotices reports whether it drew a residual").toMatch(/onResidualChange/);
    expect(flow, "TodayFlow listens").toMatch(/onResidualChange=\{setMailResidual\}/);
    expect(flow, "and withholds the head's door while the foot has one")
      .toMatch(/!mailEmpty && !mailResidual/);
  });

  // The overdue pill was not a duplicate handler but a duplicate
  // DESTINATION: two pills, two numbers, one unfiltered list. Fixed by
  // sending it somewhere that matches what it counts.
  it("the due and overdue pills land in different places", () => {
    const page = read(join(SRC, "today/TodayPage.tsx"));
    expect(page, "overdue has its own destination").toMatch(/onSeeAllOverdue \?\? onSeeAllTasks/);
    const shell = read(join(SRC, "shell/AppShell.tsx"));
    expect(shell, "and the shell knows the filter to land on")
      .toMatch(/setTaskFilterIntent\("overdue"\)/);
  });

  // A label may only promise what its handler performs (catalog W3). The
  // repeats empty state said "New Repeating Event" over plain onNew.
  it("no button offers a repeating event from the plain new-event handler", () => {
    const sched = read(join(SRC, "schedule/screens/SchedulePage.tsx"));
    const bad = sched.split("\n").filter((l) => !/^\s*(\/\/|\*|\{?\/\*)/.test(l)
      && /New Repeating Event/.test(l) && /onClick=\{onNew\}/.test(l));
    expect(bad, "a second door with a false sign is worse than a second door").toEqual([]);
  });
});

// LAW 6: TASKS AUDIT 2026-08-29. Four findings from a screenshot review of
// the Tasks tab, each locked in so the fix cannot silently regress.
describe("LAW 6: Pick One picks, urgency survives Start, timed beats untimed, more is signalled", () => {
  // FINDING #1. "Pick One" opened the full edit sheet -- title, category,
  // due date, project, recurrence, plan -- for a button whose entire job was
  // to remove a decision. The app already had the right tool one tap over on
  // the capture bar (the lightning bolt, AppShell's openWhatNow ->
  // RightNowSheet), and it was never wired to this button.
  it("Tasks' Pick One reaches for onWhatNow before it reaches for the edit sheet", () => {
    const flow = read(join(SRC, "tasks/TasksFlow.tsx"));
    const pickOne = flow.slice(flow.indexOf("const pickOne = () => {"));
    const body = pickOne.slice(0, pickOne.indexOf("\n  };") + 5);
    expect(body, "onWhatNow is checked first").toMatch(/if \(onWhatNow\) \{ onWhatNow\(\); return; \}/);
    // LIFE (2026-09-01): TasksFlow mounts inside LifeFlow now; the shell
    // hands the same What Now to LifeFlow, and LifeFlow passes it through.
    const shell = read(join(SRC, "shell/AppShell.tsx"));
    expect(shell, "and AppShell actually wires it to the same What Now the lightning bolt uses")
      .toMatch(/<LifeFlow[^>]*onWhatNow=\{\(\) => void openWhatNow\(\)\}/);
    const life = read(join(SRC, "life/LifeFlow.tsx"));
    expect(life, "LifeFlow passes it through untouched").toMatch(/<TasksFlow[^>]*onWhatNow=\{onWhatNow\}/);
  });

  // FINDING #2. onStartTask is passed to every row unconditionally, so the
  // urgency label (OVERDUE, TODAY) can never reach the trailing slot: Start
  // always wins. Start is worth keeping on every row (A2, 2026-08-21), so
  // the fix is not to remove it; it is to stop the trailing slot from being
  // the only place urgency could ever render.
  it("an overdue or due-today row carries its urgency tag independent of whether Start renders", () => {
    const page = read(join(SRC, "tasks/screens/TasksPage.tsx"));
    // AMENDED 2026-09-01 (the ruled row, "Together" catalog). The tag is
    // the distance chip now (TODAY, 2 DAYS LATE, ...), computed by
    // distanceFor and rendered on the second line inside .r-k, which the
    // Start button never touches. Same law, new anatomy: the chip must not
    // depend on onStart, and the trailing fallback stays narrowed to "soon"
    // so it can never double up with the line above.
    expect(page, "the chip comes from the distance ladder, gated only by the Today mute")
      .toMatch(/const chip = dist && !t\.done && !\(muteToday && dist\.kind === "today"\) \? dist : null;/);
    expect(page, "the chip renders on the second line, never in the trailing slot")
      .toMatch(/\{chip && <span className=\{"uchip " \+ \(chip\.kind === "late" \? "u-late" : "u-today"\)\}>\{chip\.label\}<\/span>\}/);
    expect(page, "the trailing fallback cannot double up with the chip")
      .toMatch(/: u && u\.kind === "soon" && <span className=\{"urgency " \+ URGENCY_CLASS\[u\.kind\]\}/);
  });

  // FINDING #3. partition() sorted by date only. Every row in "Today" shares
  // one date, so the sort was a no-op among them and an 8:30 AM if-then cue
  // could sit under three tasks with no time at all.
  it("today's list breaks a date tie by an if-then plan's time cue", () => {
    const filters = read(join(SRC, "tasks/filters.ts"));
    expect(filters, "the sort key reads the plan's time cue").toMatch(/plan\?\.cue\.kind === "time"/);
    expect(filters, "and folds it into the same key date alone used to be").toMatch(/\+ "T" \+ timeOf\(it\)/);
  });

  it("timeOf actually orders a timed task ahead of an untimed one on the same day", async () => {
    const { partition } = await import("../tasks/filters");
    const T = (id: string, due: string, time?: string) => ({
      id, data: { text: id, category: "", done: false, due, ...(time ? { plan: { cue: { kind: "time" as const, what: time }, then: "x" } } : {}) },
    });
    const items = [T("no-time-a", "2026-08-29"), T("timed", "2026-08-29", "08:30"), T("no-time-b", "2026-08-29")];
    const p = partition(items as never, "2026-08-29");
    expect(p.today.map((t) => t.id)[0], "the timed task leads its day").toBe("timed");
  });

  // FINDING #4. chip-row's own mask clips CONTENT to transparent, revealing
  // whatever sits behind it -- in dark theme, near-black behind a chip that
  // is already six-percent white on black, so the "fade" was invisible and
  // the screenshot that started this audit shows a hard cut on "Up". A
  // colour cue cannot work on that token pair; the fix was geometric.
  //
  // AMENDED 2026-09-02 (Fewer Buttons, Dave: "I don't like all those
  // floating buttons. There's way too many."; picked "One line of
  // dropdowns on the list head"). The chip rows are gone, and ChipRow with
  // them: the list head carries three menus (the view with the list's
  // count, the area, the grouping), each a shared HeadMenu whose panel is a
  // portal fixed to its capsule, so nothing overflows sideways and nothing
  // needs a "more" mark. The counts the chips carried live inside the
  // view menu, one per option.
  it("the Tasks head is three menus, not chip rows", () => {
    const page = read(join(SRC, "tasks/screens/TasksPage.tsx"));
    expect(page, "no chip row survives on the page").not.toMatch(/ChipRow|chip-row/);
    expect(page.match(/<HeadMenu/g)?.length, "three menus: view, area, group").toBe(3);
    expect(page, "the view menu leads, with the list's count and every filter's count")
      .toMatch(/lead\s+ariaLabel="Show"[\s\S]*?count=\{items\.length\}[\s\S]*?options=\{FILTERS\.map\(\(f\) => \(\{ value: f, label: FILTER_LABEL\[f\], count: counts\[f\] \}\)\)\}/);
    const menu = read(join(SRC, "shared/HeadMenu.tsx"));
    expect(menu, "the panel is a portal fixed to the capsule, never clipped by a card")
      .toMatch(/createPortal\(/);
    expect(menu).toMatch(/getBoundingClientRect\(\)/);
    expect(CSS, "the panel is position: fixed").toMatch(/\.hmenu \{ position: fixed;/);
  });
});

// LAW 7: TASKS AUDIT 2026-08-29, SECOND PASS. The three findings held back
// from the first pass: the stacked CTAs, the chrome they cost, and a tag
// wearing another category's colour.
describe("LAW 7: one question gets one row, and a colour never speaks for a category that is not its own", () => {
  const page = () => read(join(SRC, "tasks/screens/TasksPage.tsx"));

  // FINDINGS A + B. Pick One and Just This One were two full-width buttons
  // stacked above the filters, so the first thing on the Tasks screen was a
  // decision about how to look at tasks, before any task. They answer the
  // same question (both rank with theOneThing) and shared one row from
  // 2026-08-29. The audit flagged whether the page should carry both.
  //
  // AMENDED 2026-09-02 (Fewer Buttons, Dave picked "Pick One alone; Just
  // This One lives inside it"). One red button on the page, full width.
  // Just This One is an action on the What Now sheet that button opens:
  // the same ranking, one door. The pair and its class are retired here.
  it("the Tasks page carries one decision killer, full width", () => {
    const src = page();
    expect(src, "the pair is gone").not.toMatch(/cta-pair|onOverwhelmed/);
    const row = src.slice(src.indexOf('className="pad-x pick-one">\n          {/* "Pick One"'));
    const body = row.slice(0, row.indexOf("</div>"));
    expect(body, "Pick One is the fill, and it has the row").toMatch(/btn btn-primary btn-lg btn-block/);
    expect(body, "nothing sits beside it").not.toMatch(/OVERWHELM_ENTER/);
  });

  it("Just This One is an action on the What Now sheet, wired to the same flag", () => {
    const sheet = read(join(SRC, "tasks/screens/RightNowSheet.tsx"));
    expect(sheet, "the sheet offers it under the same vocabulary").toMatch(/onJustThisOne && <button className="btn btn-secondary btn-block" onClick=\{onJustThisOne\}>\{OVERWHELM_ENTER\}<\/button>/);
    const shell = read(join(SRC, "shell/AppShell.tsx"));
    expect(shell, "the shell sets the day-keyed flag and goes to the list")
      .toMatch(/onJustThisOne=\{\(\) => \{ setWhatNow\(null\); setOverwhelmed\(true, todayISO\(\)\); goLife\("tasks"\); \}\}/);
    const flow = read(join(SRC, "tasks/TasksFlow.tsx"));
    expect(flow, "a mounted Tasks page hears the write").toMatch(/subscribeOverwhelmed\(\(\) => setOverwhelmed\(loadOverwhelmed\(todayISO\(\)\)\)\)/);
  });

  // Two reds of equal weight side by side is exactly what Law 4 rations.
  // Bare `.btn` is press-3 with `color: var(--tint)` -- red text -- so the
  // secondary beside the sheet's red fill must name a neutral variant.
  it("the quiet CTA is neutral, not accent-coloured text beside a red fill", () => {
    const sheet = read(join(SRC, "tasks/screens/RightNowSheet.tsx"));
    expect(sheet, "the alternative uses the neutral variant").toMatch(/btn btn-secondary btn-block" onClick=\{onJustThisOne\}/);
    // The CSS this relies on: bare .btn really is accent text, so if that
    // ever changes this law should be revisited rather than silently kept.
    expect(CSS, "bare .btn is still accent text, which is why secondary is required")
      .toMatch(/background: var\(--press-3\); color: var\(--tint\)/);
  });

  // FINDING C. categoryLine() joined every category into one string and the
  // whole string wore `cat-fg-{primary}`, so a Health+Money task rendered
  // MONEY in Health's green: a colour making a false claim, which is worse
  // than an uncoloured tag. The 2026-08-21 rule ("the primary keeps the
  // colour; the tags ride as plain facts") was right and unimplemented.
  it("only the primary category is coloured on a task row", () => {
    const src = page();
    // AMENDED 2026-09-01 (the ruled row) and again 2026-09-02 (The Row and
    // Health): the colour is the parent's glyph at the head of the second
    // line (ParentLineGlyph, whose tone is the parent's own category), and
    // nothing else; the category words, when they render, are all one
    // plain grey. Same law, stricter: not "only the first word is coloured"
    // but "no word is coloured", so a second category can never wear a
    // colour that is not its own.
    expect(src, "the row no longer paints the whole joined line one colour")
      .not.toMatch(/className=\{"eyebrow cat-fg-" \+ catColor\(t\.category\)\}/);
    expect(src, "the parent's glyph carries the colour")
      .toMatch(/<ParentLineGlyph p=\{parent\} \/>/);
    expect(src, "no category word is coloured").not.toMatch(/cat-fg-/);
    expect(src, "the old bar is gone").not.toMatch(/r-bar/);
  });

  it("categoriesOf puts the primary first, which is what the index-0 rule leans on", async () => {
    const { categoriesOf } = await import("../tasks/categories");
    expect(categoriesOf({ category: "health", extraCategories: ["money"] })).toEqual(["health", "money"]);
    // The primary is never duplicated into the tail, so index 0 is always
    // the one that owns the colour.
    expect(categoriesOf({ category: "health", extraCategories: ["health", "money"] })).toEqual(["health", "money"]);
  });
});

// LAW 8: SCHEDULE AUDIT 2026-08-29. A proposal proves itself before it
// renders and before it commits -- the day-plan draft joins the law the
// notices learned in Wave 1.
describe("LAW 8: a proposal proves itself before it renders, and Accept never deletes work", () => {
  // THE SCREENSHOT: "Brainstorm for app design company" committed at
  // 1:54 PM (a Start Fifteen block, sourceTaskId set) AND still proposed at
  // 5:00 PM by the standing draft. The draft is deliberately not redrafted
  // intra-day, so the fix is a render/accept-time filter, not a redraft.
  it("liveBlocks drops a block whose task the day already answered", async () => {
    const { liveBlocks } = await import("../dayloop/dayLoop");
    const blocks = [
      { taskId: "brainstorm", text: "Brainstorm", category: "work", start: "17:00", end: "17:45" },
      { taskId: "closet", text: "Clean out closet", category: "personal", start: "14:00", end: "14:45" },
    ];
    const dayEvents = [{ data: { sourceTaskId: "brainstorm" } }]; // the 1:54 Start block
    const live = liveBlocks(blocks, dayEvents, []);
    expect(live.map((b) => b.taskId)).toEqual(["closet"]);
  });

  it("liveBlocks drops done and deleted tasks, but only once tasks have loaded", async () => {
    const { liveBlocks } = await import("../dayloop/dayLoop");
    const blocks = [
      { taskId: "a", text: "A", category: "", start: "10:00", end: "10:45" },
      { taskId: "b", text: "B", category: "", start: "11:00", end: "11:45" },
      { taskId: "gone", text: "G", category: "", start: "12:00", end: "12:45" },
    ];
    const tasks = [
      { id: "a", data: { done: false } },
      { id: "b", data: { done: true } },
    ];
    expect(liveBlocks(blocks, [], tasks).map((b) => b.taskId)).toEqual(["a"]);
    // Tasks not loaded yet is "unknown", not "everything is deleted": an
    // empty list must not blank the card during the first paint.
    expect(liveBlocks(blocks, [], []).map((b) => b.taskId)).toEqual(["a", "b", "gone"]);
  });

  // Both surfaces go through the checkpoint: render AND accept, Schedule AND
  // Today. The accept half is the dangerous one -- commitPlan's supersede
  // sweep deletes a task's existing plan event (isPlanEvent is true for a
  // Start Fifteen block), so committing a stale draft deletes real work.
  it("both flows render and commit the live view, never the raw cache", () => {
    const sched = read(join(SRC, "schedule/ScheduleFlow.tsx"));
    expect(sched, "Schedule renders the filtered view").toMatch(/blocks: liveDraftBlocks/);
    expect(sched, "Schedule commits the filtered view").toMatch(/svc\.commitPlan\(selected, liveDraftBlocks\.map/);
    expect(sched, "and the footer stands down when nothing is live")
      .toMatch(/standingDraft && liveDraftBlocks\.length > 0 \? \(/);

    const today = read(join(SRC, "today/TodayFlow.tsx"));
    expect(today, "Today renders the filtered view").toMatch(/blocks: liveDraftBlocks/);
    expect(today, "Today recomputes live state at accept time, not from the render closure")
      .toMatch(/const live = liveBlocks\(dayDraft\.blocks, todayEvents, taskItems\);/);
    expect(today, "and commits exactly that").toMatch(/schedule\.commitPlan\(today, live\.map/);
  });

  // THE CHROME HALF OF THE AUDIT, pinned so it cannot quietly return.
  it("Not Today is never accent text beside the red Accept fill", () => {
    for (const f of ["schedule/ScheduleFlow.tsx", "today/TodayFlow.tsx"]) {
      const src = read(join(SRC, f));
      const notToday = [...src.matchAll(/className="([^"]*)"[^>]*>Not Today</g)].map((m) => m[1]!);
      expect(notToday.length, f + " still offers Not Today").toBeGreaterThan(0);
      for (const cls of notToday) {
        expect(cls, f + ": bare .btn-sm is red text; the neutral variant is required beside a fill")
          .toMatch(/btn-secondary/);
      }
    }
  });

  // HISTORY, three chapters now. Read all of them before touching this again.
  //
  // 2026-08-29 (Schedule audit): the day count ("1 Event · 5 Proposed") was
  // rendering in accent red WITH .grp's dotted alarm rule armed, inherited
  // from the detail-page group labels (Decided, Because, Details) because
  // SchedulePage happens to wrap its plan head in a .grp too. Red announcing
  // a status is the exact shape L1 bans, and nothing had chosen it -- it was
  // collateral. Both the colour and the rule were taken away.
  //
  // 2026-08-30 morning (the red comes home, approved from rendered previews):
  // the colour returned as --accent-chrome, reasoning that the offence had
  // been the inherited alarm rule, not the hue.
  //
  // 2026-08-30 evening (RED IS A VERB, from his phone): that lasted one
  // deploy. The selector's blast radius was wider than the previews showed --
  // the Anytime strip's "ANYTIME"/"N OPEN" sit in a .plan-head too, so the
  // screen grew THREE red labels while every tappable verb on it stayed
  // white: the exact inversion of Today, the page he holds up as the law
  // ("the today page is exactly how I want headers and buttons to deal with
  // red"). Heads and counts are information; information stays quiet. Red
  // belongs to the things a thumb can press.
  //
  // The invariant that survived all three passes: the dotted alarm rule
  // never comes back to a day head.
  it("day heads are quiet information; the alarm rule stays gone", () => {
    expect(CSS, "the day count and every .plan-head label read as information")
      .toMatch(/\.grp \.plan-head > \.eyebrow \{ color: var\(--tx-3\)/);
    expect(CSS, "and the dotted alarm rule stays gone, the original offence")
      .toMatch(/\.grp \.plan-head > \.eyebrow::after \{ content: none; \}/);
  });

  it("an open gap is an invitation, not an alarm", () => {
    const gap = /\.sched-gap \{[^}]*\}/.exec(CSS)?.[0] ?? "";
    expect(gap, "no accent fill or border on empty time").not.toMatch(/--accent|255,43,60|218,0,18/);
    expect(gap, "the dashed invitation shape survives the diet").toMatch(/dashed/);
  });

  it("Schedule opens on the day, where the action is", () => {
    const sched = read(join(SRC, "schedule/ScheduleFlow.tsx"));
    expect(sched).toMatch(/useState<"day" \| "week" \| "month" \| "repeats">\("day"\)/);
  });
});

// LAW 9: EMAIL AUDIT 2026-08-29. The ask decides the action -- in EVERY
// branch, and off a classifier that actually classifies.
describe("LAW 9: the ask decides the action, in every branch", () => {
  // Dave's four real Waiting On rows, verbatim from the 2026-08-29
  // screenshot. Three of the four said "Ask To Call", which is the exact
  // complaint mailAction.ts was written to fix, still live in the one
  // branch nothing tested.
  const REAL = [
    "Fisher v JAT",
    "Invoice",
    "18u east coast battle royal",
    "Nike Strength Re: Nike Strength / Order #51161",
  ];

  it("his real inbox no longer repeats one label down the section", async () => {
    const { decide } = await import("../messages/mailAction");
    const labels = REAL.map((s) => decide(s, "", 60).primary.label);
    // Was: Ask To Call / Ask For Status / Ask To Call / Ask To Call.
    expect(labels).toEqual(["Ask Again", "Ask For Status", "Ask Again", "Open a Dispute"]);
    // Two rows sharing "Ask Again" is CORRECT and not the bug: they are
    // genuinely the same ask, and the sender line under each distinguishes
    // them. The bug was three quarters of the section reading identically.
    expect(new Set(labels).size).toBeGreaterThanOrEqual(3);
  });

  // The law "the wait sets the tone, not the words on the button" already
  // existed and only ever exercised money_in, which already obeyed. Every
  // branch answers to it now, including the fallback that did not.
  it("no ask kind changes its verb purely because the thread got old", async () => {
    const { decide, askKindOf } = await import("../messages/mailAction");
    const perKind: Record<string, string> = {
      answer: "Fisher v JAT",
      money_in: "Invoice",
      goods: "Missing Items From Order #D2565",
      they_asked: "CALL ME",
      nothing: "Reservation Receipt",
    };
    for (const [kind, subject] of Object.entries(perKind)) {
      expect(askKindOf(subject), subject).toBe(kind);
      const labels = [2, 10, 60, 200].map((d) => decide(subject, "", d).primary.label);
      // goods is the one deliberate exception and says so in its branch:
      // Escalate hardens into Open a Dispute, which is a different ACTION
      // (a formal dispute), not the same ask reworded.
      if (kind === "goods") continue;
      expect(new Set(labels).size, `${kind} changed its verb with age: ${labels.join(" / ")}`).toBe(1);
    }
  });

  // A fake channel change may not take the primary slot. A.askToCall's own
  // channel is "email", so with no phone number it is another email, not a
  // new channel, and letting it lead is what collapsed the labels.
  it("only a real dial displaces Ask Again on a dead thread", async () => {
    const { decide } = await import("../messages/mailAction");
    const withPhone = decide("Fisher v JAT", "", 60, 0, { hasPhone: true });
    expect(withPhone.primary.label).toBe("Call Them");
    expect(withPhone.primary.channel).toBe("call");

    const without = decide("Fisher v JAT", "", 60);
    expect(without.primary.label).toBe("Ask Again");
    // Still reachable, never removed: it steps back one slot.
    expect(without.alternates.map((a) => a.label)).toContain("Ask To Call");
  });

  // The classifier bug: the group's closing \b sat right after \d, so the
  // order-number rule only matched a SINGLE digit. Every real order number
  // is longer than that, so that half of the goods rule never once fired.
  it("an order number classifies as goods at any length", async () => {
    const { askKindOf } = await import("../messages/mailAction");
    for (const s of ["Order #5", "Order #51161", "order 51161", "order#7", "Re: Order #D2565"]) {
      expect(askKindOf(s), s).toBe("goods");
    }
    // And the fix stays narrow: a bare word is still not an order problem.
    expect(askKindOf("ordering lunch")).toBe("answer");
  });

  // The mode card's one-line clamp is deliberate (equal card heights). What
  // it clips must therefore be the inferable half.
  it("Clean Out leads its sub with the fact the card cannot otherwise show", () => {
    const src = read(join(SRC, "messages/MessagesFlow.tsx"));
    expect(src, "the sender count leads, so an overflow costs the filler")
      .toMatch(/mode-why">\{capAfterNumber\(senderPiles\([^)]*\)\.length \+ " senders"\) \+ " \\u00b7 In the inbox"\}/);
  });
});

// LAW 10: ONE TAXONOMY (Dave 2026-08-29, the unification: "there's just too
// much disconnect between the life, the areas of the life, the categories,
// the tasks... the way you would imagine folders are organized").
//
// The app ran TWO taxonomies for one concept. Categories: pointed at by id
// from every task, project, note, event, person and goal-tag -- 79 id-join
// sites. life_area: pointed at by exactly one optional field (Goal.areaId),
// created by no onboarding, and called "retired (state nobody maintained)"
// by GoalSheet's own comment -- while four screens labelled the CATEGORY
// picker "Area". Dave's screenshot of an Add Area sheet reading "No Areas
// Yet" beside nine categories is the disconnect photographed.
//
// The research pass (Things 3, PARA, Todoist, Linear) was unanimous: never
// two taxonomies for one concept; shallow spine (Area -> Project -> Task);
// parents optional but orphans conspicuous; empty containers never render.
// So: THE CATEGORY IS THE AREA. Your Life's frame is the same category ids
// Brain lists; the life_area entity is dereferenced from the page; the UI
// says "Area" everywhere and "Category" nowhere.
describe("LAW 10: one taxonomy -- the category is the area", () => {
  it("Your Life's frame is the categories, not a second entity", () => {
    const flow = read(join(SRC, "bigger/BiggerPictureFlow.tsx"));
    expect(flow, "the page receives the categories as its sections")
      .toMatch(/sections=\{\[\.\.\.categories\]/);
    expect(flow, "the flow no longer reads the retired area entity").not.toMatch(/useAreas/);
    expect(flow, "and no longer mounts its admin sheet").not.toMatch(/AreasSheet/);
  });

  it("a goal is homed by its first live tag, and empty areas render nothing", () => {
    const page = read(join(SRC, "bigger/BiggerPicturePage.tsx"));
    expect(page, "one home per goal: first tag that names a live section")
      .toMatch(/\(g\.data\.tags \?\? \[\]\)\.find\(\(t\) => sectionIds\.has\(t\)\)/);
    expect(page, "PARA: never ship empty containers")
      .toMatch(/if \(mine\.length === 0 && loose\.length === 0\) return null;/);
    // The guilt-render this replaces must not come back.
    expect(page).not.toMatch(/Nothing Live Here Yet/);
  });

  it("orphans are conspicuous, never forced into a parent", () => {
    const page = read(join(SRC, "bigger/BiggerPicturePage.tsx"));
    expect(page, "homeless goals float in Working Toward").toMatch(/Working Toward/);
    expect(page, "goal-less, area-less projects float in More Work").toMatch(/More Work/);
  });

  it("the UI says Area; no screen labels the concept Category any more", () => {
    const bad: string[] = [];
    // Visible strings only: JSX text nodes and the label-ish props people
    // actually read. Identifiers, imports, css classes and comments are the
    // entity's own name and stay.
    const VISIBLE = /(?:>|label">|title=\{?"|placeholder="|aria-label=\{?")\s*(?:Your )?Categor(?:y|ies)\b/;
    for (const f of COMPONENTS) {
      read(f).split("\n").forEach((line, i) => {
        if (/^\s*(\/\/|\*|\{\/\*)/.test(line)) return;
        if (VISIBLE.test(line)) bad.push(rel(f) + ":" + (i + 1));
      });
    }
    expect(bad, "one word for one concept, everywhere a user reads").toEqual([]);
  });

  it("the section head count is a count, never a score", () => {
    const page = read(join(SRC, "bigger/BiggerPicturePage.tsx"));
    const heads = page.slice(page.indexOf("sections.map"));
    const section = heads.slice(0, heads.indexOf("Working Toward"));
    // The single frame counts goals plus loose projects; the ruled lenses
    // (2026-09-02) count through catHead(c, n), one kind of thing per lens.
    expect(section, "items shown, not percent done").toMatch(/\{mine\.length \+ loose\.length\}|catHead\(c, (?:mine|loose)\.length\)/);
    expect(section).not.toMatch(/pct|%/);
  });
});

// LAW 11: THE FIVE-SCREEN SWEEP (Dave 2026-08-29, second screenshot pass).
// Five findings across Today, Tasks, Notes and Email, each with the same
// shape: a good rule already existed and one screen was quietly exempt.
describe("LAW 11: cards show their work, tags earn their shape, and no screen is exempt from the diet", () => {
  // FINDING 1. The evening check-in feeds daySizing and pattern awareness,
  // and said none of it: "does how did today feel actually provide value?"
  // is a question the card itself should have answered. The card states its
  // purpose, and the confirmation states the CONSEQUENCE of the answer
  // given -- only "under" resizes tomorrow, so only "under" may claim to.
  it("the mood card says what it is for, and the answer states its real consequence", () => {
    const src = read(join(SRC, "today/CheckIn.tsx"));
    expect(src, "the card carries its purpose line").toMatch(/sub="Shapes tomorrow's plan"/);
    expect(src, "an underwater answer confirms the lighter tomorrow")
      .toMatch(/v === "under" \? "Noted · Tomorrow runs lighter on purpose"/);
    // The claim must stay honest: daySizing only lightens on "under", so no
    // other answer may promise a change of shape.
    expect(src).not.toMatch(/"fire" \? "Noted · Tomorrow/);
  });

  // FINDING 2. The urgency tag sat at the same size and weight as the
  // category text beside it, differing only in hue: "it blends in too
  // much". Form, not colour, is what survives a fast scan, so the tag is a
  // tinted chip now -- and on the Today filter the TODAY chip does not
  // render at all, because a tag repeated on every row of a filter named
  // for it says nothing. OVERDUE still shows everywhere.
  it("the urgency tag is a chip, and TODAY never renders on the filter that already says it", () => {
    const page = read(join(SRC, "tasks/screens/TasksPage.tsx"));
    // AMENDED 2026-09-01 (the ruled row): the chip is .uchip, the same one
    // Today's dealt row wears, tinted from its own colour (warn for today,
    // the system red for late). The mute rule is unchanged.
    expect(page, "chip class on the row tag").toMatch(/"uchip " \+ \(chip\.kind === "late" \? "u-late" : "u-today"\)/);
    expect(page, "TODAY muted where redundant, LATE untouched")
      .toMatch(/!\(muteToday && dist\.kind === "today"\)/);
    expect(page, "the mute is the today filter, nothing else")
      .toMatch(/muteToday=\{filter === "today"\}/);
    expect(CSS, "the chip is a tint of the tag's own colour, not a new colour")
      .toMatch(/\.ruled \.uchip\.u-today \{ color: var\(--warn\); background: var\(--warn-tint\); \}/);
    expect(CSS).toMatch(/\.ruled \.uchip\.u-late  \{ color: var\(--sys-red\); background: var\(--red-tint\); \}/);
  });

  // FINDING 3, FOUR CHAPTERS. Read the history before changing this.
  //
  // 2026-08-24 (I3): Today's heads were quieted, "one accent head per
  // screen"; every other tab kept shouting. Search had ELEVEN red heads down
  // one screen.
  //
  // 2026-08-29 (five-screen sweep): the diet went app-wide and the only plain
  // .sh2 left was YourDay's "Now".
  //
  // 2026-08-30 morning (the red comes home): read Dave's "mirror the home
  // page red rules" as an allowlist of accent heads and gave Notes "All
  // Notes" in accent, approved from rendered previews.
  //
  // 2026-08-30 evening (RED IS A VERB, from his phone): the reference is
  // Today itself -- "the today page is exactly how I want headers and
  // buttons to deal with red laws. Apply them." Today's heads (EMAIL,
  // REMINDERS) are quiet; its red lives on the verbs (Take 1:00 PM, Draft
  // It, Ask Again, Clear All) and on the ONE sanctioned head naming the
  // screen's live moment: "Now". So: heads are quiet everywhere, "Now" is
  // the single exception, and red text belongs to tappable things (.pill-act
  // verbs, .see-all, .block-add -- all buttons, all correctly red).
  //
  // This pass also closed a hole: the old scan matched the exact string
  // className="sh2", so a head wearing a VARIANT class (sh2-caps on
  // Templates and Brain's "Your Areas", which re-stated the accent) slid
  // straight past the law. The scan now flags any .sh2 that does not carry
  // sh2-quiet, whatever else rides in the className.
  it("every section head is quiet except Today's Now; red text is for verbs", () => {
    const offenders: string[] = [];
    for (const f of COMPONENTS) {
      if (rel(f) === "today/YourDay.tsx") continue;
      read(f).split("\n").forEach((line, i) => {
        const m = line.match(/className="([^"]*\bsh2\b[^"]*)"/);
        if (m && !m[1]!.includes("sh2-quiet")) offenders.push(rel(f) + ":" + (i + 1));
      });
    }
    expect(offenders, "a head outside YourDay must carry sh2-quiet").toEqual([]);
    // The one sanctioned loud head still exists, so this cannot pass by
    // everything having gone quiet.
    expect(read(join(SRC, "today/YourDay.tsx"))).toMatch(/className="sh2"/);
    // And the variant that hid two red heads from the old scan is retired.
    expect(CSS, "sh2-caps must not come back as an accent restatement")
      .not.toMatch(/\.sh2\.sh2-caps \.t \{ color: var\(--accent-chrome\)/);
  });

  // The other half of the reversal: the large page title wears the same
  // energy line the condensed pagebar wears, so the two read as one element
  // rather than as two headers trading places on scroll.
  it("the signature stroke wears the condensed bar's exact energy line", () => {
    const line = /linear-gradient\(90deg, #FA233B, #FB5C74 55%, rgba\(251,92,116,0\)\)/;
    const stroke = /\.pagehead-title::after \{[^}]*\}/.exec(CSS)?.[0] ?? "";
    expect(stroke, "the stroke exists").not.toBe("");
    expect(stroke, "same gradient as .pagebar.on::after, not a lookalike").toMatch(line);
    expect(stroke, "same 2px weight").toMatch(/height: 2px/);
    expect(stroke, "same 64px run").toMatch(/width: 64px/);
    // Both must stay identical: if one is ever retuned, the other has to move
    // with it or the condense animation stops reading as one object.
    const bar = /\.pagebar\.on::after \{[^}]*\}/.exec(CSS)?.[0] ?? "";
    expect(bar, "the bar still wears it too").toMatch(line);
  });

  // FINDING 4. Every new note was born wearing defaultCatId -- whatever
  // category happens to sort first -- so the "color-coded" library was one
  // color: the first category's. Filing is a choice; nothing files itself.
  it("a new note is born unfiled, and an unfiled note wears yellow, not a category's colour", () => {
    const flow = read(join(SRC, "notes/NotesFlow.tsx"));
    expect(flow, "creation passes no category")
      .toMatch(/createNote\(TEMPLATE_TITLE\[key\], ""\)/);
    const list = read(join(SRC, "notes/screens/NotesList.tsx"));
    expect(list, "unfiled renders yellow; filed keeps its category's colour")
      .toMatch(/n\.category \? catColor\(n\.category\) : "yellow"/);
  });

  // FINDING 4, SECOND HALF: THE GREAT UNFILING (2026-08-30). Fixing creation
  // only helps notes written from now on. Every note written BEFORE it still
  // carried the category the bug chose (catList[0], for Dave his Family), so
  // his library stayed one uniform colour and the fix looked like it had done
  // nothing. The cleanup runs once per account on the next Notes open.
  it("the one-time unfiling runs once per account, and skips demo builds", async () => {
    const flow = read(join(SRC, "notes/NotesFlow.tsx"));
    expect(flow, "gated on the profile flag, not a local one")
      .toMatch(/if \(p && !p\.notesUnfiled\)/);
    expect(flow, "the flag is only written after the clear succeeded")
      .toMatch(/await svc\.unfileAllNotes\(\);\s*\n\s*await profile\.save\(\{ notesUnfiled: true \}\)/);
    expect(flow, "demo builds keep their deliberately filed showcase library")
      .toMatch(/!__DEMO_SEED__ && profile && !unfiled\.current/);
    const types = read(join(SRC, "profile/types.ts"));
    expect(types, "the flag rides the synced profile, so a second device cannot re-run it")
      .toMatch(/notesUnfiled\?: boolean/);

    // And it behaves: idempotent, and it never touches a note that has no
    // category to lose (the ones he has refiled by hand after a run).
    const { NotesService } = await import("../notes/NotesService");
    const { Store, InMemoryAdapter } = await import("@core");
    const svc = new NotesService(new Store(new InMemoryAdapter()), "u-law");
    await svc.createNote("Filed by the bug", "cat-family");
    await svc.createNote("Born unfiled", "");
    expect(await svc.unfileAllNotes(), "clears only what carries a category").toBe(1);
    expect(await svc.unfileAllNotes(), "a second run is a no-op").toBe(0);
  });

  // FINDING 5. The casing law ("every dot-segment leads with a capital")
  // stopped at the mode deck, where the sublines shipped as lowercase
  // fragments; and Read It to Me was the last plain card in a column of
  // launch-rows. One casing law, one launcher chassis.
  it("scorecard sublines lead capitalized, and Read It to Me rides the launcher chassis", () => {
    const flow = read(join(SRC, "messages/MessagesFlow.tsx"));
    expect(flow, "Sweep subline leads capitalized").toMatch(/"Needs you" : "Need you"/);
    expect(flow, "Clean Out subline caps its count and its tail")
      .toMatch(/capAfterNumber\(senderPiles\(unmutedRows, effTriage, vips\)\.length \+ " senders"\) \+ " \\u00b7 In the inbox"/);
    const rimIdx = flow.indexOf("Read It to Me");
    const rim = flow.slice(Math.max(0, rimIdx - 900), rimIdx + 900);
    expect(rim, "same chassis as its neighbours").toMatch(/launch-row/);
    expect(rim, "a row that performs carries a control, not a chevron").not.toMatch(/launch-chev/);
  });

  it("the sweep estimate itself leads with a capital", async () => {
    const { sweepEstimate } = await import("../messages/sweep");
    expect(sweepEstimate(6)).toBe("About 4 min");
    expect(sweepEstimate(0)).toBe("");
  });
});

// LAW 12: WHAT HE TAPS, STAYS TAPPED (Dave 2026-08-30, from his phone:
// "things aren't clearing. There's bugs with tasks and reminders. They
// eventually did but it took a couple of tries" -- with a screenshot of Your
// Move holding "Clean out closet" twice).
//
// Three findings, and the first two are the same bug seen from two sides: the
// app knew the screen was stale and could not get that knowledge onto the
// screen he was looking at.
describe("LAW 12: a write survives the refresh racing it, and one thing never renders twice", () => {
  // FINDING 1. CachedAdapter is stale-while-revalidate: a list answers from
  // cache and a refresh runs behind it. Mutations write through to the cache
  // so a flow reads its own writes -- but the refresh, when it landed, called
  // writePreload UNCONDITIONALLY with a server list it had fetched BEFORE the
  // write. Tick a task while the render's own refresh is still open and the
  // tick was overwritten; the next reload showed it undone. "A couple of
  // tries" is the signature: the second tick usually lands with nothing in
  // flight. The delete case was worse -- a deleted row came back, which is
  // the tombstone resurrection this whole rebuild exists to kill.
  it("a refresh that was overtaken by a write is dropped, never written back", () => {
    const src = read(join(SRC, "data/CachedAdapter.ts"));
    expect(src, "the counter every mutation bumps").toMatch(/private writes = 0;/);
    for (const m of [/async create\(/, /async createMany\(/, /async del\(/]) {
      const at = src.search(m);
      expect(at, "mutation exists").toBeGreaterThan(-1);
      expect(src.slice(at, at + 600), "it bumps the counter").toMatch(/this\.writes\+\+/);
    }
    expect(src, "apply bumps only on a write the backend accepted")
      .toMatch(/if \(ok\) \{ this\.writes\+\+; this\.patchCaches/);
    expect(src, "the refresh notes the counter before going out").toMatch(/const sentAt = this\.writes;/);
    expect(src, "and refuses to write back if it moved")
      .toMatch(/if \(this\.writes !== sentAt\) return;/);
  });

  it("the cold path reads the counter BEFORE its await, not after", () => {
    // Written wrong once in this very session: capturing the counter after
    // the await compares a value to itself and guards nothing, while looking
    // exactly like a guard. The order is the whole mechanism.
    const src = read(join(SRC, "data/CachedAdapter.ts"));
    const capture = src.indexOf("const coldSentAt = this.writes;");
    const await_ = src.indexOf("const fresh = await this.inner.listForUser(ownerId, entityType);", capture);
    expect(capture, "the cold guard exists").toBeGreaterThan(-1);
    expect(await_, "and the await follows it").toBeGreaterThan(capture);
  });

  // FINDING 2. useFreshLists shipped 2026-08-24 to fix "the repaint that
  // never arrived", and its own comment records that no surface had ever
  // subscribed. Tasks and Schedule were wired that day. The HOME PAGE was
  // not -- so the one screen he opens first was the one screen that never
  // repainted when the app detected it was stale.
  it("every surface that draws a cached list subscribes to the repaint", () => {
    const subscribers = COMPONENTS.filter((f) => read(f).includes("useFreshLists(")).map(rel).sort();
    expect(subscribers, "Today included, not just Tasks and Schedule").toEqual([
      "schedule/ScheduleFlow.tsx",
      "tasks/TasksFlow.tsx",
      "today/TodayFlow.tsx",
    ]);
    const today = read(join(SRC, "today/TodayFlow.tsx"));
    expect(today, "Today draws both tasks and events, so it listens for both")
      .toMatch(/useFreshLists\(\[ENTITY_TASK, ENTITY_EVENT\], reload\)/);
  });

  // FINDING 3. The Where You Were spot is a bookmark and can name any entity,
  // including one Your Move is already showing. Open a task, come back four
  // hours later, and if the ranker deals that same task you get it twice in
  // one stream wearing two different verbs: Start on the dealt row, Resume on
  // the spot card. The dealt row wins -- it is the anchor and carries the
  // completion circle, the urgency chip and the ranker's reason, against one
  // age line. The bookmark itself is untouched.
  it("the Resume offer never repeats a task the same stream already shows", async () => {
    const src = read(join(SRC, "today/TodayFlow.tsx"));
    expect(src, "the spot card is gated on it").toMatch(/spot && !spotAlreadyShown \?/);
    expect(src, "the rule is the shared pure one, not a second copy inline")
      .toMatch(/spotIsDuplicate\(spot, \{ dealtTaskId, slideTaskId \}\)/);
    // The dealt row is evening-gated in TodayPage; in the evening there is no
    // dealt row, so the Resume offer is the only mention and must survive.
    expect(src, "the evening gate is mirrored, not ignored")
      .toMatch(/const dealtTaskId = evening \? undefined : upNextRows\[0\]\?\.id;/);
    // And the rule itself behaves, not just reads right.
    const { spotIsDuplicate } = await import("../today/stream");
    expect(spotIsDuplicate({ kind: "task", id: "t1" }, { dealtTaskId: "t1" })).toBe(true);
    expect(spotIsDuplicate({ kind: "task", id: "t1" }, {})).toBe(false);
  });
});

// LAW 13: A TAB HEALS OR SPEAKS, NEVER SKELETONS FOREVER (Dave 2026-08-30,
// screenshot: the More tab frozen on the two-card Suspense skeleton while
// every other tab worked).
//
// Every tab is a lazy() chunk, and React.lazy memoizes the FIRST import
// promise for the life of the page. A chunk fetch that hangs on a bad cell
// link, or 404s because a cached index.html names hashes a deploy replaced,
// left that tab dead until a full app relaunch -- rendering a skeleton that
// looks like progress and is not. Two layers close it:
//
//   1. lazyWithRecovery: timeout -> retry -> one reload per session -> loud
//      throw to the root ErrorBoundary's Reload card. (Behaviour tested in
//      shell/chunkRecovery.test.ts; this law pins the WIRING.)
//   2. The service worker refuses to cache an SPA-fallback HTML response
//      under an /assets/ chunk URL -- cache-first-forever plus one poisoned
//      entry was a tab that could never load again without clearing site
//      data. The v5 cache-name bump purges anything the old handler kept.
describe("LAW 13: a tab heals or speaks, never skeletons forever", () => {
  it("every lazy chunk in the app goes through the recovery ladder", () => {
    const offenders: string[] = [];
    for (const f of SOURCES) {
      if (rel(f) === "shell/chunkRecovery.ts") continue;
      read(f).split("\n").forEach((line, i) => {
        if (/\blazy\(\s*\(\)\s*=>\s*import\(/.test(line)) offenders.push(rel(f) + ":" + (i + 1));
      });
    }
    expect(offenders, "bare React.lazy memoizes one failed fetch forever; use lazyWithRecovery").toEqual([]);
    // And the ladder is actually in use, not just unviolated.
    const uses = SOURCES.filter((f) => read(f).includes("lazyWithRecovery(() => import(")).map(rel);
    expect(uses.length, "the tabs really ride the ladder").toBeGreaterThanOrEqual(4);
    expect(uses).toContain("shell/AppShell.tsx");
  });

  it("the reload rung fires once per session, so a broken deploy cannot loop", () => {
    const src = read(join(SRC, "shell/chunkRecovery.ts"));
    expect(src, "the guard is read before reloading").toMatch(/alreadyReloaded = storage\?\.getItem\(RELOADED_KEY\)/);
    expect(src, "and set before reloading").toMatch(/storage\?\.setItem\(RELOADED_KEY, "1"\)/);
    expect(src, "second-time failures throw to the boundary instead").toMatch(/throw second/);
  });

  it("the service worker never caches HTML under a chunk URL", () => {
    const sw = read(join(process.cwd(), "public/sw.js"));
    expect(sw, "content-type guard on the asset cache")
      .toMatch(/res\.ok && !type\.includes\("text\/html"\)/);
    expect(sw, "v5 bump purges any entry the old handler poisoned")
      .toMatch(/ASSET_CACHE = "jarvis-assets-v5"/);
  });
});

// LAW 14: EMPTY IS A LEGAL VALUE (decision catalog 2026-08-30, "Yes, allow
// blanks"; Dave 2026-08-31 with a screenshot of his own Edit Exercise sheet
// reading "SET 2 · 0 lb × 8" on sets he never gave a weight: "Wasn't all
// this supposed to be changed?").
//
// The model was already right -- SetLog's own comment defines
// done-with-no-numbers as a valid state -- but the one renderer every gym
// surface reads through (formatSet) filled absent fields with zeros, so
// chips, ghosts, the Save line, history and PRs all spoke placeholders as
// facts. And the convenience input (uniformStrip) MINTED those zeros into
// storage from untouched Quick Setup steppers. Zero and absent read the
// same everywhere (the reading hasTarget and scoreOf always used), which is
// what heals his already-stored zeros with no migration.
describe("LAW 14: empty is a legal value; nothing manufactures a zero", () => {
  it("a set speaks only the numbers it has", async () => {
    const { formatSet, targetLine } = await import("../gym/measures");
    const lb = { kind: "weight_reps" as const, unit: "lb" };
    expect(formatSet(lb, { r: 8 })).toBe("8 reps");
    expect(formatSet(lb, { w: 0, r: 8 })).toBe("8 reps");
    expect(formatSet(lb, { done: true })).toBe("Done");
    expect(formatSet(lb, {})).toBe("Empty");
    // His screenshot's Save line, healed:
    const e = { id: "x", name: "Bench", kind: "weight_reps" as const, unit: "lb",
      sets: [{ id: "a", w: 115, r: 8 }, { id: "b", w: 0, r: 8 }, { id: "c", r: 8 }] };
    expect(targetLine(e)).toBe("115 lb × 8, 8 reps, 8 reps");
  });

  it("the convenience input never mints a zero into storage", async () => {
    const { uniformStrip } = await import("../gym/strip");
    for (const s of uniformStrip(3, { w: 0, r: 8 })) expect("w" in s).toBe(false);
  });
});

// LAW 15: A SURFACE SPEAKS ONE GRAMMAR (Dave 2026-08-31, from the 5 Day
// Program and Edit Exercise screenshots: "I want a complete reformatting of
// the health pages. Styling is random and doesn't align. Even one page has
// different styled sections." -- with the research verdict to mirror the
// Apple Health grouped-list language the design system already derives
// from).
//
// What the reformat fixed, pinned so it stays fixed: gym rows shouted their
// meta as .eyebrow caps while the app's lists speak .conn-meta; heads split
// between sec-head and sh2; two of the three in-list creates dressed as
// chevron nav rows; ReorderList hard-coded card chrome so one list floated
// as glass between full-bleed neighbours; and the set chip -- the one swipe
// row without position:relative -- let its absolutely-positioned delete
// button PAINT OVER it at rest (his screenshot's visible trash), while its
// hard-coded page-ground fill rendered as black slabs inside surface-2
// sheets.
describe("LAW 15: the gym speaks one grammar", () => {
  const gymFiles = ["GymFlow.tsx", "SessionScreen.tsx", "HistoryScreen.tsx", "ExerciseSheet.tsx", "UploadFlow.tsx", "ReceiptSheet.tsx", "ActionSheet.tsx", "LibraryPickSheet.tsx"];

  it("no gym row writes its meta as a shouting eyebrow, and no gym head is a sec-head", () => {
    const bad: string[] = [];
    for (const f of gymFiles) {
      const src = read(join(SRC, "gym", f));
      // A conn-name with an .eyebrow as the very next line is the old row
      // grammar; kickers that LEAD a block (Set N, sheet titles) stay legal.
      const lines = src.split("\n");
      for (let i = 0; i < lines.length - 1; i++) {
        if (lines[i]!.includes('className="conn-name') && /className="eyebrow"/.test(lines[i + 1]!)) {
          bad.push(`${f}:${i + 2} eyebrow riding under a conn-name`);
        }
      }
      if (src.includes("sec-head")) bad.push(`${f} still uses sec-head`);
    }
    expect(bad).toEqual([]);
  });

  // THE SAME DEFECT, EVERYWHERE ELSE (Dave 2026-09-03, pic 5: "too much
  // same color text"). The check above was written for the gym and stopped
  // at the gym, so Insights kept shouting all five of its row subs in caps
  // -- at the same grey, size and tracking as the section heads directly
  // above them, which is exactly why that page read as one flat colour. A
  // caps line is a KICKER, and a kicker sits ABOVE a title; under one it is
  // a sub, and a sub is .conn-meta or the ruled row's quiet .r-goal.
  it("no row anywhere writes its sub as a shouting eyebrow", () => {
    const bad: string[] = [];
    for (const f of COMPONENTS) {
      const lines = read(f).split("\n");
      for (let i = 0; i < lines.length - 1; i++) {
        if (!lines[i]!.includes('className="conn-name')) continue;
        // Same line or the next one: both shapes ship in this codebase.
        const after = lines[i]!.split('className="conn-name')[1] ?? "";
        if (/className="eyebrow"/.test(after) || /className="eyebrow"/.test(lines[i + 1]!)) {
          bad.push(`${rel(f)}:${i + 1} eyebrow riding under a conn-name`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("the set chip is a real swipe row: positioned, and surface-matched inside sheets", () => {
    const css = read(join(SRC, "styles", "components.css"));
    const chip = css.match(/\.set-chip\s*\{[^}]*\}/)?.[0] ?? "";
    // position:relative is what keeps the absolute delete button PAINTED
    // beneath the chip at rest -- the exact visible-trash bug in his
    // screenshot. Geometry never covered it; paint order does.
    expect(chip).toContain("position: relative");
    // SPEC MOVED 2026-09-02 (Edit All Sets screenshot: "change the entire
    // format of this container. It should be identical to the rest of the
    // app. It's the only one in this app that looks like that"): a set is a
    // grouped-table ROW now, not its own elevated surface -- reverses the
    // 2026-09-01 "chip as its own rounded card" spec. It still needs to be
    // opaque so the swipe-delete track stays hidden until revealed; the
    // default now matches the PAGE ground (SessionScreen has no card around
    // the strip), and the sheet override steps it up to match a real nested
    // card where one exists.
    // SPEC MOVED 2026-09-03 (the training skin retired): the gym sheets are
    // plain sheets now, so the one sheet rule is the whole story -- there is
    // no darker train-skin step for the chip to match any more.
    expect(chip).toContain("background: var(--bg)");
    expect(css).toMatch(/\.sheet-scrim \.set-chip\s*\{\s*background:\s*var\(--surface-3\)/);
    expect(css).not.toMatch(/\.train-skin/);
    // A set's numbers stay at the grouped-row 16px without the skin.
    expect(css).toMatch(/\.set-chip \.conn-name\s*\{\s*font-size:\s*16px/);
    // No radius, no gap, no elevation escalation inside a sheet: a set row
    // reads exactly like its neighbouring .xs-row grouped-table rows.
    expect(chip).not.toMatch(/border-radius/);
    expect(css).not.toMatch(/\.set-chip-col\s*\{[^}]*margin-bottom:\s*var\(--s-2\)/);
    // The divider between sets is the same .row + .row hairline every other
    // list gets for free -- nothing left zeroing it back out.
    expect(css).not.toMatch(/\.set-strip .*\.reorder-row \+ \.reorder-row\s*\{\s*border-top:\s*0/);
    // And the reorder wrapper sheds its card chrome where rows are the
    // surface (full-bleed lists, the strip itself).
    expect(css).toMatch(/\.list-flat \.reorder-list, \.set-strip \.reorder-list \{[^}]*background: none/);
  });

  // SPEC MOVED 2026-09-01 (THE PREVIEW IS THE SPEC): the one in-list create
  // affordance in the gym is now .row-create -- the approved health
  // preview's full-width red-text card row -- not the floating .row-act
  // pill (Dave's three editor screenshots). The law keeps its job: every
  // create wears the SAME affordance, and the chevron-nav dress stays gone.
  it("every in-list create on the program page is the one row-create affordance", () => {
    const src = read(join(SRC, "gym", "GymFlow.tsx"));
    for (const label of ["Add Day", "Upload a Program", "Add a Week", "Add Exercise"]) {
      // Same line: the arrow handler's => sits between the class and the
      // label, so the gap crosses anything but a newline.
      expect(src).toMatch(new RegExp('className="row-create"[^\\n]*>' + label.replace(/ /g, "\\s+"))); // eslint-disable-line
    }
    // The retired dresses stay retired.
    expect(src).not.toMatch(/onClick=\{\(\) => setUploadOpen\(true\)\}>\s*<div className="row-grow"/);
    for (const f of ["GymFlow.tsx", "SessionScreen.tsx", "SetStrip.tsx", "RestTimer.tsx", "ExerciseSheet.tsx"]) {
      expect(read(join(SRC, "gym", f))).not.toContain('className="row row-act"');
    }
  });

  it("the gym's long-press rows lay out as rows (the chevron never wraps under the text)", () => {
    const src = read(join(SRC, "gym", "GymFlow.tsx"));
    const wrappers = src.match(/className="row-grow row-press"/g) ?? [];
    expect(wrappers.length).toBeGreaterThanOrEqual(3);
    const css = read(join(SRC, "styles", "components.css"));
    expect(css).toMatch(/\.row-press \{[^}]*display: flex/);
  });
});

// ===========================================================================
// LAW 16: A RAMP IS NOT THE WORK, AND A SUGGESTION IS NOT AN EDIT
//
// Wave 2 of Training Catalog V2 (D3-A ramps, D6-A progression, D8-A plate
// math) adds two things the app has never had: sets it generates itself, and
// an opinion about next time. Both are dangerous in exactly one way, and it
// is the same way -- they can quietly become facts.
//
// A warm-up set is real work the athlete did, so it is logged. It is not the
// work being measured, so it must never win a record, never add tonnage, and
// never make a strip stop speaking as one line. There is exactly ONE gate
// every record path runs through (scoreOf), and this pins the exclusion
// there rather than in each caller -- the callers are the part that keeps
// getting added to.
//
// A suggestion is an offer. Only applySuggestion writes, and only a caller
// holding an explicit accept may call it. "The program updates on save" was
// Dave's own wording on D6-A, and the failure it rules out is the app moving
// someone's numbers while they were not looking.
// ===========================================================================
describe("LAW 16: derived work never becomes a fact on its own", () => {
  const gym = (f: string) => read(join(SRC, "gym", f));

  it("the one scoring gate excludes warm-ups, so no record path has to remember", () => {
    const src = gym("measures.ts");
    const fn = src.slice(src.indexOf("export function scoreOf"));
    expect(fn.slice(0, fn.indexOf("switch (kind)")), "scoreOf lets a warm-up compete")
      .toMatch(/if \(s\.warmup\) return null/);
  });

  it("tonnage and the uniformity read skip the approach too", () => {
    const src = gym("measures.ts");
    const vol = src.slice(src.indexOf("export function setVolume"), src.indexOf("export function scoreOf"));
    expect(vol, "a warm-up adds tonnage").toMatch(/s\.warmup/);
    const uni = src.slice(src.indexOf("export function isUniformStrip"));
    expect(uni.slice(0, 400), "a ramp breaks the plan line").toMatch(/warmup/);
  });

  it("the ramp is derived, never stored in a program", () => {
    const sheet = gym("ExerciseSheet.tsx");
    expect(sheet, "the editor saves generated warm-up sets into the plan")
      .not.toMatch(/setSets\([^)]*rampFor/);
    expect(gym("ramp.ts"), "the ramp module writes state").not.toMatch(/localStorage|writeGymSettings/);
  });

  it("only applySuggestion writes a plan, and only behind an explicit accept", () => {
    const prog = gym("progression.ts");
    const suggest = prog.slice(prog.indexOf("export function suggestFor"), prog.indexOf("export function applySuggestion"));
    expect(suggest, "suggestFor assigns into the exercise").not.toMatch(/ex\.sets\s*=|ex\.sets\.(push|splice|sort|reverse)/);
    const flow = gym("GymFlow.tsx");
    expect(flow).toMatch(/onAcceptSuggestion=\{/);
    expect([...flow.matchAll(/applySuggestion\(/g)].length,
      "applySuggestion is called from more than the accept path").toBe(1);
  });

  it("a suggestion says what it is moving from, so it can never be silent", () => {
    expect(gym("progression.ts"), "a suggestion carries no reason").toMatch(/why:/);
    expect(gym("SessionScreen.tsx"), "the offer does not show its evidence").toMatch(/suggestion\.why/);
  });

  it("plate math says nothing rather than a wrong answer", () => {
    const src = gym("ramp.ts");
    const fn = src.slice(src.indexOf("export function platesPerSide"));
    expect(fn.slice(0, fn.indexOf("\n}")), "an unbuildable weight is rounded instead of refused")
      .toMatch(/return null/);
  });
});

// ===========================================================================
// LAW 17: THE FIT IS A STANCE, NEVER AN EDIT -- AND ESTIMATES NAME THEIR
// EVIDENCE
//
// Wave 3 of Training Catalog V2 (D4-C pins + the door, D5-C fit + live pace)
// gives the app a clock and a calendar claim, and both invite the same two
// sins. The first: "fitting" a session by quietly editing the program --
// Fitbod's move, the one the catalog explicitly rejects. Every lever
// (rest cut, superset, trim, skip cool-down) lives on the LIVE SESSION and
// dies with it; fit.ts must never import the program-writing door, and the
// trim may never touch the day's first exercise -- "never the top set of
// your main lift" is Dave's approved wording. The second: an estimate that
// dresses a default up as a measurement. Every pace is either learned from
// logged stamps or named a default, out loud, every time.
//
// And the calendar side inherits the gameCategoryId doctrine: the schedule
// never GUESSES which block is the gym. Only the athlete's own hand (the
// event sheet's switch -> editGymDoor) marks a door, and a stamp lands only
// on an event that is one.
// ===========================================================================
describe("LAW 17: the fit is a stance, never an edit", () => {
  const gym = (f: string) => read(join(SRC, "gym", f));

  it("fit.ts prices; it never writes -- no service, no program door, no storage", () => {
    const src = gym("fit.ts");
    expect(src, "fit.ts reaches a write door").not.toMatch(/GymService|updateProgram|saveDays|localStorage|writeLive/);
  });

  it("the trim never touches the day's first exercise", () => {
    const src = gym("fit.ts");
    const fn = src.slice(src.indexOf("export function trimTargets"));
    expect(fn.slice(0, fn.indexOf("\n}")), "trimTargets can name the main lift")
      .toMatch(/i === 0/);
    const next = src.slice(src.indexOf("export function nextLever"));
    expect(next, "the catch-up banner can trim the main lift").toMatch(/i >= 1/);
  });

  it("a lever is applied only by the athlete's own tap, through the one door", () => {
    const screen = gym("SessionScreen.tsx");
    // The banner's apply path exists and goes through onFit; nothing in the
    // session screen writes the program when a lever lands.
    expect(screen).toMatch(/applyLever/);
    expect(screen.slice(screen.indexOf("const applyLever")), "a lever edits the program")
      .not.toMatch(/updateProgram|saveDays/);
  });

  it("every estimate names its evidence: learned, or a default that says so", () => {
    expect(gym("pacing.ts"), "the honesty line lost its default wording")
      .toMatch(/default pace · improves as you log/);
    expect(gym("pacing.ts"), "the honesty line lost its learned wording")
      .toMatch(/learned from your last/);
    expect(gym("FitSheet.tsx"), "the fit sheet hides where its estimate came from")
      .toMatch(/default pace · improves as you log/);
  });

  it("pacing never learns from a backdated session's stamps", () => {
    const fn = gym("pacing.ts").slice(gym("pacing.ts").indexOf("export function workGaps"));
    expect(fn.slice(0, fn.indexOf("\n}")), "typed-in times teach the pace model")
      .toMatch(/backdated/);
  });

  it("the calendar never guesses which block is the gym", () => {
    const svc = read(join(SRC, "schedule", "ScheduleService.ts"));
    const stamp = svc.slice(svc.indexOf("async stampTrained"));
    expect(stamp.slice(0, stamp.indexOf("\n  }")), "a stamp can land on a non-door event")
      .toMatch(/!e\.gym/);
    const sheet = read(join(SRC, "schedule", "screens", "EventSheet.tsx"));
    expect(sheet, "the door is not the athlete's own switch").toMatch(/setGym/);
    expect(sheet, "the sheet guesses the gym from the title").not.toMatch(/title\.(match|includes)\([^)]*[Gg]ym/);
  });
});

// ===========================================================================
// LAW 18: WHEN IS A FACT, WHY IS NEVER CLAIMED (Training Catalog V2, Wave 4:
// D9-A trend charts, D10-B metrics, D11-C correlation, D12-A/C lift and
// training goals, D13-A/C plateau flags and the published range row --
// approved 2026-08-31, riding the health doctrine override Dave signed off
// verbatim: "Take out that ban... plenty of high school students who can
// track their physical data in a healthy way," with everything ELSE in the
// override doc -- opt-in, hide-never-delete, no score, no calories, honest
// correlation -- unmoved). A flat e1RM, a muscle's weekly set count, a
// metric's own logged value: all facts, all computable. A REASON one of
// those moved is not computable from one person's logs, and nothing in this
// wave is allowed to imply it found one.
// ===========================================================================
describe("LAW 18: when is a fact, why is never claimed", () => {
  const gym = (f: string) => read(join(SRC, "gym", f));

  it("muscle mapping is never guessed from an exercise's name", () => {
    // Exercise.muscleGroup (gym/types.ts) is a hand-set field, the same
    // never-guess doctrine as gameCategoryId. insights.ts's own program join
    // must read that field and nothing else -- no keyword match standing in
    // for it.
    const src = gym("insights.ts");
    const fn = src.slice(src.indexOf("export function muscleMapFromProgram"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body, "muscleMapFromProgram infers a muscle from the exercise name instead of reading the hand-set field")
      .not.toMatch(/\.name\.(match|includes|toLowerCase\(\)\.includes)/);
    expect(body, "muscleMapFromProgram lost the hand-set field read").toMatch(/ex\.muscleGroup/);
  });

  it("every correlation card ends its own line honestly", () => {
    const src = gym("insights.ts");
    const fn = src.slice(src.indexOf("export function correlate"));
    expect(fn.slice(0, fn.indexOf("\nfunction round1")), "a correlation card can render without its own disclaimer")
      .toMatch(/Correlation, not cause/);
  });

  it("a plateau's what-changed receipt never grows a field for the reason", () => {
    const src = gym("insights.ts");
    expect(src, "WhatChangedRow grew a field naming the reason something changed")
      .not.toMatch(/interface WhatChangedRow[^}]*\b(why|reason|because|cause)\b/i);
    for (const screen of ["gym/LiftDetailScreen.tsx", "brain/CategoryDetail.tsx"]) {
      const s = read(join(SRC, screen));
      expect(s, screen + " renders a plateau card without the correlation-not-cause line")
        .toMatch(/Correlation, not cause/);
    }
  });

  it("zero hard sets is a verdict: the range row renders nothing, never a 0", () => {
    const src = gym("insights.ts");
    const fn = src.slice(src.indexOf("export function hardSetRows"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body, "hardSetRows stopped filtering out muscles with zero sets this week")
      .toMatch(/\(totals\.get\(m\) \?\? 0\) > 0/);
  });

  it("a metric can be hidden, never deleted", () => {
    const src = read(join(SRC, "gym", "MetricsService.ts"));
    expect(src, "MetricsService grew a way to delete a metric definition")
      .not.toMatch(/deleteDef|removeDef|delete\([^)]*ENTITY_METRIC_DEF/);
    expect(src, "MetricsService lost hide (updateDef with a hidden patch)").toMatch(/updateDef/);
  });

  it("the metric library is opt-in: nothing pre-enables a preset on its own", () => {
    // METRIC_PRESETS is read-only data; a def is only ever created from the
    // athlete's own tap (AddMetricSheet's onEnablePreset/onCreateCustom ->
    // MetricsService.createDef), never seeded by the provider on init.
    const providerSrc = read(join(SRC, "data", "NotesProvider.tsx"));
    expect(providerSrc, "NotesProvider seeds a metric definition on its own")
      .not.toMatch(/metrics\.createDef|MetricsService[^;]*createDef/);
  });

  it("no composite health or readiness score, ever", () => {
    for (const f of ["gym/metrics.ts", "gym/insights.ts", "gym/MetricsCard.tsx"]) {
      const src = read(join(SRC, f));
      expect(src, f + " computes a composite/readiness score").not.toMatch(/composite[A-Z]?[Ss]core|readiness[A-Z]?[Ss]core|healthScore/);
    }
  });
});

// ===========================================================================
// LAW 17: THE SCHEDULE TOP (A Cleaner Top, Dave 2026-09-02, from one
// screenshot: "This looks extremely sloppy. Send me an updated preview of a
// much cleaner look for the top of this page and beginning of the
// schedule").
//
// Counted on that screenshot, before the first block: the title, the
// segment, the date beside two circular steppers, a caps eyebrow of counts
// floating on the page ground, and a right-aligned row of two buttons. Then
// the day opened on a dashed box offering to fill an hour that had ended
// four hours earlier, over rows each carrying a red "Set Length" capsule
// and a red address.
//
// His three picks, and his two notes, are what this law holds in place.
// ===========================================================================
describe("LAW 17: the Schedule head is two rows, the day starts at Now, and the row spends no red", () => {
  const page = () => read(join(SRC, "schedule/screens/SchedulePage.tsx"));
  const dayRow = () => read(join(SRC, "schedule/screens/DayRow.tsx"));

  // PICK 1: "The date leads, the counts sit under it". Plus his note, which
  // is the real ruling here: "Does the count at the top really have value? I
  // don't think the user cares how many open blocks there are". The block
  // count is visible by looking at the list, so it never renders. Open time
  // is the one number the page cannot show by existing: it is the sum of
  // every gap, and it is the same number the Week head carries.
  it("the head states open time, never a block count", () => {
    const src = page();
    expect(src, "the caps count eyebrow is gone").not.toMatch(/eyebrow count-line/);
    expect(src, "the head is the date and the arrows").toMatch(/<div className="sc-head">/);
    expect(src, "open time leads the fact line")
      .toMatch(/if \(openMin > 0\) countLine\.push\(<span key="o"><b>\{gapLabel\(openMin\)\}<\/b> open<\/span>\);/);
    const facts = src.slice(src.indexOf("const countLine"), src.indexOf("return ("));
    expect(facts, "a block count is never pushed onto the line").not.toMatch(/blockCount\}<\/b>/);
    // On today the number counts FORWARD: an hour that has gone is not open.
    expect(src, "open time is summed over what is ahead, not the whole day")
      .toMatch(/const openMin = ahead\.filter\(\(en\) => en\.kind === "gap"\)/);
  });

  // The head carries ONE action and it is not a fill. Running Late? and Copy
  // Yesterday left the head for the two places they are actually about.
  it("the head carries one action, in the ghost pill, and the other two moved", () => {
    const src = page();
    expect(src, "Plan My Day is the head action pill").toMatch(/<button className="see-all pill-action" onClick=\{onPlanDay\}>Plan My Day<\/button>/);
    expect(src, "the schedule head spends no accent fill").not.toMatch(/plan-cta/);
    expect(src, "the button row is gone").not.toMatch(/plan-head-acts/);
    expect(src, "Running Late? rides the Now rule").toMatch(/className=\{"sched-late"[^}]*\}[\s\S]{0,220}Running Late\?/);
    expect(src, "Copy Yesterday lives in the empty state").toMatch(/empty-state[\s\S]{0,600}Copy Yesterday/);
  });

  // PICK 2: "Everything behind you folds to one line, and the day starts at
  // Now." Two halves, and the second is the one that matters: an open slot
  // that has gone is not an offer, so it never renders at all.
  it("the morning folds to one line and a past gap never renders", () => {
    const src = page();
    expect(src, "the fold and the rule ride the entry list").toMatch(/\| \{ kind: "earlier"; n: number; s: number \}/);
    expect(src, "and the rule with it").toMatch(/\| \{ kind: "now"; s: number \}/);
    expect(src, "past gaps are dropped, past events are kept")
      .toMatch(/const pastShown = pastEntries\.filter\(\(en\) => en\.kind !== "gap"\);/);
    expect(src, "the fold names what it holds, and claims nothing about how it went")
      .toMatch(/Earlier<span className="n">\{en\.n\} \{en\.n === 1 \? "block" : "blocks"\}<\/span>/);
    expect(src, "the fold is shut on arrival").toMatch(/const \[earlierOpen, setEarlierOpen\] = useState\(false\)/);
    // Only on today: on another date nothing is behind you and nothing is now.
    expect(src, "the fold is a today-only shape, on every mode that draws the day")
      .toMatch(/const foldable = isToday && mode !== "week" && mode !== "repeats";/);
    // A gap you are standing in the middle of is trimmed to now, or dropped.
    expect(src, "a straddling gap is trimmed to now").toMatch(/const from = Math\.ceil\(nowMin \/ 15\) \* 15;/);
  });

  it("the Now rule is a hairline and a word, never a fill", () => {
    expect(CSS, "the rule paints a 1px line in the system red")
      .toMatch(/\.ruled \.sched-now \.l \{ flex: 1; height: 1px; background: var\(--sys-red\)/);
    expect(CSS, "and Running Late? beside it stays neutral")
      .toMatch(/\.ruled \.sched-late \{[^}]*background: var\(--press-3\); color: var\(--tx-1\)/);
  });

  // PICK 3: "In the one grey meta line", with his note: "I would like the
  // same functionality as the option you recommended as well" -- the
  // recommended shape set the length by tapping the time, and that reach is
  // what makes the red capsule removable.
  it("a block with no length says nothing, and the time popover sets both", () => {
    const src = dayRow();
    // The words may survive in the comments that record why they went; what
    // must not survive is a rendered capsule or the class that painted it.
    expect(src, "the Set Length capsule is retired").not.toMatch(/>Set Length<|: "Set Length"|sched-until-empty"/);
    expect(CSS, "and its rule with it").not.toMatch(/\.sched-until-empty\s*\{/);
    expect(src, "the length renders only when there is one").toMatch(/\{mins != null && \(/);
    expect(src, "and it is the span, not the end time").toMatch(/>\{durLabel\(mins\)\}<\/button>/);
    const pop = src.slice(src.indexOf('<div className="time-pop">'));
    expect(pop, "the time popover carries the length too").toMatch(/time-pop-durs/);
    expect(pop, "and its chips write an end time").toMatch(/onSetEnd\(endFor\(e\.data\.start, d\)\)/);
    expect(src, "and says so").toMatch(/"Change time or length, currently "/);
  });

  it("the place is a fact on the meta line, not an accent link on its own", () => {
    const src = dayRow();
    const meta = src.slice(src.indexOf('<div className="sched-cat">'), src.indexOf("{attach && ("));
    expect(meta, "the location sits inside the meta line").toMatch(/sched-loc truncate/);
    expect(src, "the pin glyph went with the line it led").not.toMatch(/<PinGlyph \/>/);
    expect(CSS, "and it is quiet there").toMatch(/\.ruled \.sched-cat \.sched-loc \{ color: var\(--tx-3\)/);
  });
});

// ============================================================================
// LAW: THE FOOT OF A LIST (Dave 2026-09-03, pics 3 and 4: "the spacing at the
// bottom of the screen is awful" / "add goal looks ridiculous")
//
// Two defects, one cause: a block at the END of a ruled page has no caps head
// above it, and the ruled system had only ever spaced cards BY their heads.
//
//   1. A trailing card landed flush against the card above it, one hairline of
//      black apart, so the two read as one card broken in half. The Life
//      lenses showed it; the drift sweep found the same shape on all twenty-
//      one health screens, where a hero card is followed straight away by its
//      list, and again wherever a button follows a list.
//   2. A create row alone in a card is one line of red text inside a 14px
//      glass slab with a rim and a shadow -- the pill in a pill that
//      .row-create was introduced to stop being. Empty area pages showed it
//      twice each, once for Add Project and once for Add Task.
//
// Both are fixed structurally rather than call site by call site, because no
// call site can know at write time whether its list will be empty or what
// will follow it. :has() knows at paint time, and covers the screens nobody
// has written yet.
describe("LAW: the foot of a list", () => {
  it("a block following a card gets the breath a head would have given it", () => {
    expect(CSS, "the general rule: anything after a card, with no head between")
      .toMatch(/\.ruled \.pad-x:has\(> \.card\) \+ \.pad-x \{ margin-top: var\(--s-4\); \}/);
    expect(CSS, "and the named one, for a tail whose previous sibling is a wrapper")
      .toMatch(/\.ruled \.list-tail \{ margin-top: var\(--s-4\); \}/);
  });

  it("a create row alone in a card loses the card, not the row", () => {
    const rule = CSS.match(/\.ruled \.card:has\(> \.row-create:only-child\) \{[^}]*\}/)?.[0] ?? "";
    expect(rule, "the ground goes").toContain("background: transparent");
    expect(rule, "the corner goes").toContain("border-radius: 0");
    expect(rule, "the shadow and rim go").toContain("box-shadow: none");
    // Light theme paints .ruled .card with its own shadow at equal
    // specificity, so this rule only wins by sitting after it. If someone
    // moves it up the file, light mode keeps the slab and nothing fails.
    const light = CSS.indexOf('[data-theme="light"] .ruled .card {');
    const strip = CSS.indexOf(".ruled .card:has(> .row-create:only-child)");
    expect(light, "the light-theme card rule is present").toBeGreaterThan(-1);
    expect(strip, "and the strip comes after it, or light keeps the slab").toBeGreaterThan(light);
    // The hairline exists to divide a row from the rows above it. Alone,
    // there is nothing to divide.
    expect(CSS, "and the hairline with it")
      .toMatch(/\.ruled \.card:has\(> \.row-create:only-child\) > \.row-create \{ border-top: 0; \}/);
  });
});

// LAW: A TAB'S CRASH IS ITS OWN, NEVER THE SHELL'S (S3-Q19, 2026-09-04).
//
// Before this law, AppShell had exactly one ErrorBoundary in the whole app
// (main.tsx, wrapping AuthProvider itself), so a render crash anywhere in any
// tab took the entire app down to one generic card -- Reload was the only
// way out, even though nine of the ten tabs were still fine underneath it.
//
// The fix wraps the tab-content block in its own ErrorBoundary, keyed on the
// active tab. Checked structurally rather than by rendering AppShell (its
// provider tree -- NotesProvider, AuthProvider, GoogleSessionProvider, AI --
// is expensive to stand up and beside the point of what this law protects);
// ErrorBoundary's own reset-on-key-change mechanism is proven directly, with
// no such tree, in monitoring/ErrorBoundary.test.tsx.
describe("LAW: a tab's crash is its own, never the shell's", () => {
  it("the tab content is wrapped in an ErrorBoundary keyed on the active tab", () => {
    const shell = read(join(SRC, "shell/AppShell.tsx"));
    expect(shell, "a per-tab boundary, remounted (and so reset) on every tab switch")
      .toMatch(/<ErrorBoundary key=\{active\}>/);
  });

  it("VoiceBar and TabBar sit outside that boundary, so a crashed tab can't take them down", () => {
    const shell = read(join(SRC, "shell/AppShell.tsx"));
    const boundaryOpen = shell.indexOf("<ErrorBoundary key={active}>");
    const boundaryClose = shell.indexOf("</ErrorBoundary>");
    expect(boundaryOpen, "the boundary must exist").toBeGreaterThan(-1);
    expect(boundaryClose, "and close").toBeGreaterThan(boundaryOpen);
    const voiceBar = shell.indexOf("<VoiceBar ");
    const tabBar = shell.indexOf("<TabBar ");
    expect(voiceBar, "VoiceBar renders").toBeGreaterThan(-1);
    expect(tabBar, "TabBar renders").toBeGreaterThan(-1);
    expect(voiceBar > boundaryClose, "VoiceBar is a sibling after the boundary closes, not inside it").toBe(true);
    expect(tabBar > boundaryClose, "TabBar is a sibling after the boundary closes, not inside it").toBe(true);
  });

  it("the root boundary in main.tsx still stands, for crashes before the shell exists", () => {
    const main = read(join(SRC, "main.tsx"));
    expect(main, "Sign In and onboarding have no tab bar yet, so they still need the outermost catch")
      .toMatch(/<ErrorBoundary>/);
  });
});
