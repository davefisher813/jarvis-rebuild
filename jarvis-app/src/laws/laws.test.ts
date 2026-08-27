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
  const SMALL = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
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
    const passes = (t: string) => {
      if (t.includes("?")) return true; // interrogative talk
      const words = t.split(/\s+/).filter(Boolean);
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
      "schedule/screens/ScheduleUploadFlow.tsx": "phase machine; one phase renders",
      "capture/QuickCapture.tsx": "dupAge ternary, plus a separate saved-phase screen",
      "people/CallPrepSheet.tsx": "Call and Save Note are exclusive on `dialed`",
      "schedule/screens/PlanDaySheet.tsx": "count === 0 ternary: replan or commit, never both",
      "schedule/ScheduleFlow.tsx": "the Anytime guard is a modal over the page, not a second button in it",
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
    // The upload pipeline for Supabase Storage. The app's current adapters do
    // not store files, so there is no upload path to route through it yet.
    // Track 3 work, kept because the size gate and the type gate in it are
    // the part that is easy to get wrong twice.
    "fileStorage.ts": "Supabase Storage: no upload surface in this build yet",
    // Same shape as fileStorage.ts above: real, tested code with nowhere to
    // plug in yet. HealthFlow composes the Share Line and the five loggers
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
      const dir = own.slice(0, own.lastIndexOf("/") + 1);
      if (text.some((s) => !s.f.startsWith(dir) && re.test(s.t))) {
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
  it("no class anywhere paints lateness or a count in red", () => {
    const bad = [...CSS.matchAll(GUILT)].map((m) => m[0].split("{")[0]!.trim());
    expect(bad, "red means tap me, never you are behind").toEqual([]);
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
