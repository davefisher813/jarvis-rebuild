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
    const segsOk = (t: string) =>
      t.split("·").every((seg) => {
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
      for (const cls of ["conn-meta", "lib-sub", "promo-sub", "restore-meta", "tip-sub", "empty-sub"]) {
        for (const m of src.matchAll(new RegExp('className="' + cls + '(?: [a-z-]+)*"[^>]*>\\s*([^<>{}\\n]{3,80}?)\\s*<', "g"))) {
          const t = m[1]!.trim();
          if (!segsOk(t)) bad.push(rel(f) + " [" + cls + "]: " + t);
        }
      }
      for (const m of src.matchAll(/message:\s*"([^"{}]{3,80}?)"/g)) {
        const t = m[1]!.trim();
        if (!segsOk(t)) bad.push(rel(f) + " [toast]: " + t);
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
});
