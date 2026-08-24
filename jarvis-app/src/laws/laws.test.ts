import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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
    // The one legitimate use is the scrubber that REMOVES them.
    const allowed = ["ai/suggestions.ts"];
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
  // Tokens only. The single legitimate exception is a live drag position,
  // which cannot be expressed as a class.
  it("style={{ }} appears only for dynamic geometry", () => {
    const bad: string[] = [];
    for (const f of COMPONENTS) {
      read(f).split("\n").forEach((line, i) => {
        if (!/style=\{\{/.test(line)) return;
        if (/transform|left:|top:|width:|height:/.test(line)) return; // geometry
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
      for (const m of src.matchAll(/<button[^>]*>\s*([A-Za-z][^<>{}\n]{2,40}?)\s*<\/button>/g)) {
        const t = m[1]!.trim();
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
      // The chip (Daylight parity pass, 2026-08-22) is an 18% wash of the
      // ink over whatever is behind it, which is DARKER than the page, so
      // it is the worst surface a kicker ever sits on: the first vivid ink
      // set passed the page check while quietly reading 3.9-4.3 on-chip.
      // The mix here mirrors components.css exactly (color-mix in srgb,
      // currentColor 18%); change the wash there and this recomputes.
      const l = txVar("light", slot, "tx");
      if (!l) { bad.push(`${slot}: no --cat-tx-${slot} light text variant`); continue; }
      const rl = ratio(l, "#F2F2F7");
      if (rl < 4.5) bad.push(`${slot} (light text): ${l} on #F2F2F7 is ${rl.toFixed(2)}:1`);
      const ch = (i: number) => Math.round(
        parseInt(l.slice(1 + 2 * i, 3 + 2 * i), 16) * 0.18 +
        parseInt("F2F2F7".slice(2 * i, 2 * i + 2), 16) * 0.82,
      );
      const chip = "#" + [ch(0), ch(1), ch(2)].map((v) => v.toString(16).padStart(2, "0")).join("");
      const rc = ratio(l, chip);
      if (rc < 4.5) bad.push(`${slot} (light text on own chip): ${l} on ${chip} is ${rc.toFixed(2)}:1`);
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
  // Started at four on 2026-08-24 and is down to one the same day, which is
  // what the list is for. confirm() got the Still True button the sheet had
  // been missing; recordCorrection got two real correction points, and
  // contradict came alive with it because recordCorrection calls it.
  const UNCALLED: Record<string, string> = {
    // The last one, and it is inert BY DECISION rather than by neglect. Dave
    // chose record-only for the learned-rules engine: corrections are
    // observed and rules are created so they can be judged in What JARVIS
    // Learned, but nothing calls resolve(), so no rule ever acts. A rule that
    // never acts has no first use to announce.
    //
    // This comes off the list the day resolve() gets a caller, and not before.
    "LearnedRulesService.announceIfFirstUse": "record-only: nothing applies a rule, so there is no first use",
  };

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
