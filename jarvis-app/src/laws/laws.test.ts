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
});
