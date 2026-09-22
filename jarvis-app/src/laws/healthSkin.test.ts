import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";

// THE HEALTH SKIN LAWS (Dave's picks 2026-09-12; Health Build Master section
// 7, items 1 to 3). Three rulings the approved harness
// (JARVIS_HEALTH_PREVIEW_2026_09_12.html) draws by, written as tests the same
// session the skin landed, so the next pass over these screens cannot quietly
// undo them -- two of the three are reversals of reasoning that was written
// down and sounded good, which is exactly the kind of decision that gets
// re-derived back into the code a month later by someone reading the old
// comment.
//
// Each was proven to bite before it shipped: a violation was planted, the law
// went red naming it, the planted violation was removed. The commit says so.

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
const RULED = read(join(SRC, "styles/ruled.css"));
const COMPONENTS_CSS = read(join(SRC, "styles/components.css"));
const TOKENS = read(join(SRC, "styles/jarvis-design-system.css"));
const COMPONENTS = walk(SRC).filter(
  (f) => f.endsWith(".tsx") && !/\.test\.tsx$/.test(f) && !f.includes("/bench/") && !f.includes("/testpanel/"),
);

const RAMP = ["lime", "cyan", "pink", "amber", "violet", "blue"] as const;

// ---------------------------------------------------------------------------
// LAW 1 (R1). THE PRIMARY MOVE IN HEALTH IS THE APP'S RED.
//
// The 09-10 pass painted Start, Log a set and Finish with the ramp's lime,
// reasoning that every workout app makes "go" green. Overruled 09-12: the
// ramp is how DATA reads at a glance on these screens, and a button wearing a
// data hue spends the one colour that was carrying meaning. Lime is logged
// work. Red is the thing you tap, in Health exactly as everywhere else.
// ---------------------------------------------------------------------------
describe("HEALTH law 1: the Health primary is Jarvis red, and no primary wears the ramp", () => {
  it(".ruled.health-ruled .btn-primary resolves to the accent fill", () => {
    const m = RULED.match(/\.ruled\.health-ruled \.btn-primary \{([^}]*)\}/);
    expect(m, ".ruled.health-ruled .btn-primary is missing from ruled.css").toBeTruthy();
    expect(m![1]).toMatch(/background:\s*var\(--accent-fill\)/);
    expect(m![1], "the Health primary must not wear a ramp hue").not.toMatch(/--hl-/);
  });

  it("no .btn-primary rule anywhere resolves to an --hl-* value", () => {
    const bad: string[] = [];
    for (const [name, css] of [["ruled.css", RULED], ["components.css", COMPONENTS_CSS]] as const) {
      const re = /([^}]*\.btn-primary[^{}]*)\{([^}]*)\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(css))) {
        if (/--hl-/.test(m[2]!)) bad.push(`${name}: ${m[1]!.trim()} { ${m[2]!.trim()} }`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the hero's Start pill no longer paints itself off the ramp either", () => {
    const m = RULED.match(/\.ruled \.h-hero \.pill-act \{([^}]*)\}/);
    expect(m, ".ruled .h-hero .pill-act is missing from ruled.css").toBeTruthy();
    expect(m![1], "the hero's primary must not wear a ramp hue").not.toMatch(/--hl-/);
  });
});

// ---------------------------------------------------------------------------
// LAW 2 (R7). THE K.3 HEALTH EXCEPTION, AND WHAT IT DOES NOT EXCUSE.
//
// Astra law 4 allows one coloured fact per .facts line. Health is exempt (the
// scan in astra.test.ts skips health surfaces) because a health row shows six
// readings at once and the ramp exists so they read apart.
//
// What the exception does NOT cover is which WORDS may take a hue. A hue on
// these screens means "this is the datum" -- a number, a time, a unit, or a
// state word. Put it on a label or a connective and the line stops being data
// with labels and becomes a line of highlighters, which is the exact failure
// the ramp was added to fix. Labels stay --tx-2.
// ---------------------------------------------------------------------------

// Words that ARE the datum even with no digit in them. Short and closed on
// purpose: a new one is a ruling, added here deliberately. Load mode (Each,
// Total) counts because it is what the number MEANS -- "135, each hand" is a
// different fact from "135 total", and the word carries that rather than
// labelling it.
const UNIT_WORDS = ["EACH", "TOTAL", "LB", "KG", "MG", "IU", "REPS", "SETS", "GLASSES", "PR", "PRS"];

function carriesData(text: string): boolean {
  const t = text.trim();
  if (t === "") return false;
  if (/\d/.test(t)) return true; // a number, a time, a weight, a date
  return UNIT_WORDS.includes(t.toUpperCase());
}

describe("HEALTH law 2: a hue lands on the datum, never on a label", () => {
  it("the one-coloured-fact scan exempts health surfaces, and says why", () => {
    const astra = read(join(SRC, "laws/astra.test.ts"));
    expect(astra, "astra law 4 must skip health surfaces").toMatch(/isHealthSurface\(f\)/);
    expect(astra, "and must name the ruling that exempted them").toMatch(/R7/);
  });

  it("the ramp is available as a fact variant on health surfaces only", () => {
    for (const hue of ["lime", "cyan", "amber", "violet", "hblue", "pink"]) {
      expect(RULED, `.fact.${hue} is missing from the health block`).toContain(`.ruled.health-ruled .fact.${hue}`);
    }
    // Outside .health-ruled the ramp is not a fact colour: the app's intent
    // colours are, and Astra's law counts those.
    const loose = COMPONENTS_CSS.match(/^\.fact\.(lime|cyan|amber|violet|hblue|pink)\b/gm) ?? [];
    expect(loose, "a ramp fact variant escaped the health block").toEqual([]);
  });

  it("no literal .fact in the ramp's hues carries a label or a connective word", () => {
    const bad: string[] = [];
    const hues = ["lime", "cyan", "amber", "violet", "hblue", "pink"].join("|");
    // State words are the fourth thing allowed to take a hue, and they are
    // already a closed set pinned by Astra law 5, which owns .fact.st. This
    // scan is about the other three, so an .st fact is that law's business.
    // Literal classNames with a literal text child. A hue chosen at runtime
    // cannot be read from the source; the same limit Astra law 5 carries, and
    // the same reason -- a law that guesses is a law that lies.
    const re = new RegExp(`className="fact (?!st\\b)(?:[a-z]+ )*(?:${hues})"[^>]*>([^<{]+)<`, "g");
    for (const f of COMPONENTS) {
      const src = read(f);
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const text = m[1]!.trim();
        if (!carriesData(text)) bad.push(`${rel(f)}: "${text}" is a label wearing a data hue`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LAW 3 (R3 / H-03). THE LIGHT RAMP IS THE DARK RAMP.
//
// Light used to darken the six ramp hues until they cleared AA as text on a
// white card -- measured, documented, and overruled 09-12: the ramp means one
// thing or it means nothing, and a hue that changes value between themes is
// two hues. The trade is written in full at the token block. This law exists
// because the reasoning that was overruled is still persuasive: without it,
// the next contrast pass re-derives the darkened values and nobody notices
// the ruling was reversed.
// ---------------------------------------------------------------------------
describe("HEALTH law 3: the light activity ramp equals the dark one", () => {
  const block = (sel: string) => {
    const i = TOKENS.indexOf(sel);
    expect(i, `${sel} is missing from the token file`).toBeGreaterThan(-1);
    // To the next top-level block opener, which is how the file is laid out.
    const rest = TOKENS.slice(i + sel.length);
    const next = rest.search(/\n(?::root|\[data-theme)/);
    return next === -1 ? rest : rest.slice(0, next);
  };
  const ramp = (css: string) => {
    const out: Record<string, string> = {};
    const re = /--hl-([a-z]+(?:-tint|-ink)?):\s*([^;]+);/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css))) out[m[1]!] = m[2]!.trim();
    return out;
  };

  it("all six hues and all six tints are byte-identical across the themes", () => {
    const dark = ramp(block('[data-theme="dark"] {'));
    const light = ramp(block('[data-theme="light"] {'));
    for (const hue of RAMP) {
      expect(dark[hue], `dark --hl-${hue} is missing`).toBeTruthy();
      expect(light[hue], `light --hl-${hue} is missing`).toBeTruthy();
      expect(light[hue], `light --hl-${hue} was darkened away from dark`).toBe(dark[hue]);
      expect(light[`${hue}-tint`], `light --hl-${hue}-tint drifted from dark`).toBe(dark[`${hue}-tint`]);
    }
  });

  // THE INK TWIN (2026-09-22). The ruling above says the vivid six are
  // "never body copy, never a label", and by the first light audit that could
  // reach Health they were both: "1 of 12 Sets" in lime on a white card at
  // 1.24:1. Words read --hl-*-ink now. In dark the twin IS the vivid value,
  // so nothing Dave picked changes there; in light it is each hue driven down
  // until it clears AA on white. Both halves are pinned: dark equal, light
  // readable, measured here rather than trusted.
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  // The rule is not "equal to the vivid six" -- that was the first draft, and
  // measuring it showed three of the six miss 4.5 as words on their OWN tint
  // even in dark (violet 3.95, pink 4.10, blue 3.85). The rule is that a word
  // in this hue is readable on the two grounds words sit on: the hue's tint
  // wash, and the raised surface. Measured here, per theme, rather than
  // asserted.
  const over = (hex: string, a: number, bg: string) => {
    const f = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const b = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));
    return "#" + [0, 1, 2].map((i) => Math.round(f[i]! * a + b[i]! * (1 - a)).toString(16).padStart(2, "0")).join("");
  };
  const ratio = (a: string, b: string) => {
    const [la, lb] = [lum(a), lum(b)];
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  it("a word in a ramp hue clears 4.5:1 on its own tint and on the raised surface, in both themes", () => {
    for (const [theme, card, raised] of [["dark", "#1c1c1e", "#2b2b2c"], ["light", "#ffffff", "#e4e4e5"]] as const) {
      const t = ramp(block('[data-theme="' + theme + '"] {'));
      for (const hue of RAMP) {
        const ink = t[`${hue}-ink`];
        expect(ink, `${theme} --hl-${hue}-ink is missing`).toMatch(/^#[0-9A-Fa-f]{6}$/);
        const alpha = Number((t[`${hue}-tint`] ?? "").match(/([\d.]+)\)$/)?.[1] ?? "0.16");
        const onTint = ratio(ink!, over(t[hue]!, alpha, card));
        const onRaised = ratio(ink!, raised);
        expect(onTint, `${theme} --hl-${hue}-ink reads ${onTint.toFixed(2)}:1 on its own tint`).toBeGreaterThanOrEqual(4.5);
        expect(onRaised, `${theme} --hl-${hue}-ink reads ${onRaised.toFixed(2)}:1 on the raised surface`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("and no other stylesheet re-darkens one behind the token file's back", () => {
    // The token file's light block is where the six legitimately live, and
    // the test above pins them equal. Anywhere ELSE, assigning a ramp token
    // inside a light-only block is the per-theme override this law exists to
    // stop. Reading one (var(--hl-*)) is fine and is most of what these
    // files do.
    const bad: string[] = [];
    for (const [name, css] of [["ruled.css", RULED], ["components.css", COMPONENTS_CSS]] as const) {
      const re = /\[data-theme="light"\][^{}]*\{([^}]*)\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(css))) {
        for (const a of m[1]!.match(/--hl-[a-z-]+:\s*[^;]+/g) ?? []) bad.push(`${name}: ${a.trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LAW 4 (R2). NO OPACITY ON A ROW OR CARD THAT CARRIES TEXT, IN HEALTH.
//
// The 09-10 pass dimmed ghost chips to 0.75, warm-up chips to 0.72, tile
// labels to 0.9 and the chip's own label to 0.75 on top of ink that was
// already quiet: two dims stacked, read at arm's length in a gym. R2's rule
// is that a state is said with a word or a colour and never by half-erasing
// the text. Only a press state (:active) may fade, and the delete control
// hidden under a swiped chip is a control, not text.
// ---------------------------------------------------------------------------
describe("HEALTH law 4: no opacity on a health row or card that carries text", () => {
  it("no health selector fades outside a press state", () => {
    const bad: string[] = [];
    for (const [name, css] of [["ruled.css", RULED], ["components.css", COMPONENTS_CSS]] as const) {
      const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of bare.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const sel = (m[1]!.trim().split("\n").pop() ?? "").trim();
        if (!/\.(set-chip|se-|ht-|h-)/.test(sel)) continue;
        if (!/(^|[^-\w])opacity\s*:/.test(m[2]!)) continue;
        if (/:active/.test(sel)) continue;
        if (/\.task-del/.test(sel)) continue;
        bad.push(`${name}: ${sel}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LAW 5 (R8 / H-11). THE SHELL'S CHROME IS HIDDEN WHILE A SESSION IS LIVE.
//
// One sticky Log bar owns the bottom edge of a live session, the note
// editor's geometry, and the tab bar and the capture dock step aside for it.
// Structural rather than rendered: AppShell's provider tree is expensive to
// stand up and beside the point; gym/sessionChrome.test.ts proves the store.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// LAW 6 (Dave 2026-09-16, on the Exercises page: "This looks good. But it's
// not consistent throughout. Uniform everything so it looks like a real app.
// Everything should follow rules and be uniformed").
//
// ONE ROW ANATOMY. The rule was already written and the gym was the only
// place not keeping it: .facts is "the row's second line as facts, not a
// sentence" (G3, G6, components.css), the CSS draws the middot so no string
// ever carries one, and K.3 -- extended for health by law 2 above -- governs
// which of them may take a hue. All Data, Insights, the Exercises page he
// approved: all of them obey it. The gym had invented a second answer for the
// same job, filled .se-chip capsules inside a .r-k slot, so two lists a
// scroll apart said the same kind of thing in two different shapes.
//
// CAPSULES ARE NOT BANNED. They keep the job they are for: a classification
// you can tap (.ex-chip on the Exercises page) and a card's own face, which
// is not a row. What they may not do is stand in for a row's values.
//
// .r-k is the TASK row's right slot and belongs to Contract 4.1. A gym row is
// not a task row, so borrowing its container was the tell.
// ---------------------------------------------------------------------------
describe("HEALTH law 6: every browsing row wears the one anatomy", () => {
  const ROWS = ["gym/GymFlow.tsx", "gym/SessionScreen.tsx", "gym/HistoryScreen.tsx", "gym/LibraryPage.tsx", "insights/AllDataPage.tsx", "insights/InsightsPage.tsx"];

  it("no gym or insights row builds its second line out of capsules", () => {
    const bad: string[] = [];
    for (const f of ROWS) {
      const src = read(join(SRC, f));
      // The container is the tell: .r-k is the task row's right slot, and a
      // .se-chip inside one is a capsule doing a fact's job.
      const re = /<div className="r-k"[\s\S]{0,600}?<\/div>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        if (/se-chip|r-goal/.test(m[0])) bad.push(`${f}: a .r-k slot carrying ${/se-chip/.test(m[0]) ? "capsules" : "a goal line"}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("and the contract they wear instead is the one components.css writes down", () => {
    expect(COMPONENTS_CSS, "the middot is the CSS's, never a string's")
      .toMatch(/\.fact \+ \.fact::before \{ content: "\\00B7"/);
    // Every row file that shows a value shows it as a fact.
    for (const f of ROWS) {
      expect(read(join(SRC, f)), `${f} has no .facts line at all`).toMatch(/className="facts"/);
    }
  });

  // The other half of the same contract, and the one I broke myself on the
  // first pass: "Adjacent facts are separated by a middle dot the CSS draws,
  // so no string ever carries one." A fact that punctuates itself is a
  // sentence again, which is the whole thing .facts replaced.
  it("no fact carries the separator the CSS is there to draw", () => {
    const bad: string[] = [];
    for (const f of walk(SRC).filter((x) => /\/(gym|insights)\//.test(x) && x.endsWith(".tsx") && !/\.test\./.test(x))) {
      const src = read(f);
      const re = /className="fact[^"]*"[^>]*>\{?([^<]{0,140})/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        if (m[1]!.includes("\u00b7") || m[1]!.includes("\\u00b7")) bad.push(`${rel(f)}: "${m[1]!.trim().slice(0, 60)}"`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("a capsule still does the job a capsule is for", () => {
    // The Exercises page's classification chips: tappable, and a real button.
    expect(read(join(SRC, "gym/LibraryPage.tsx"))).toMatch(/className=\{"ex-chip"/);
    expect(RULED, "and they are drawn").toMatch(/\.ruled \.ex-chip \{/);
  });
});

describe("HEALTH law 5: the shell hides its chrome while a session is live", () => {
  it("AppShell reads the session store and its tab bar follows it", () => {
    const shell = read(join(SRC, "shell/AppShell.tsx"));
    expect(shell, "the shell must read the store").toMatch(/const sessionOpen = useSessionOpen\(\)/);
    expect(shell, "and hide the tab bar on it").toMatch(/const showTabBar = [^;]*!sessionOpen/);
    expect(shell, "the dock follows the tab bar").toMatch(/const showCapture = showTabBar && /);
  });
  it("the gym says so on enter and takes it back on park, finish or unmount", () => {
    const gym = read(join(SRC, "gym/GymFlow.tsx"));
    expect(gym).toMatch(/setSessionOpen\(!!live\)/);
    expect(gym).toMatch(/setSessionOpen\(false\)/);
    const screen = read(join(SRC, "gym/SessionScreen.tsx"));
    expect(screen, "the session screen renders the Log bar").toMatch(/className="logbar"/);
  });

  // ADDED 2026-09-16 (Dave, four photographs of a live set: the red button
  // "renders all fucked up. Like it's behind the Apple bar, the clear bar. So
  // you can't even see it."). Owning the bottom edge is worth nothing if the
  // bottom edge is under the keyboard, and typing a weight is the one moment
  // the Log button is wanted. It rides the foot of the VISIBLE band, the
  // writing bar's own answer since 2026-09-15.
  it("and the Log bar sits at the foot of what you can see, not of the layout", () => {
    const rule = RULED.match(/\.ruled\.health-ruled \.logbar \{[^{}]*\}/)?.[0] ?? "";
    expect(rule, "the Log bar rule must exist").toBeTruthy();
    expect(rule, "bottom: 0 is the layout floor, which is under the keys").not.toMatch(/bottom:\s*0/);
    expect(rule).toMatch(/top:\s*calc\(var\(--vv-top,[^)]*\) \+ var\(--vv-h,[^)]*\)\)/);
    expect(rule, "and pulled up by its own height").toMatch(/translateY\(-100%\)/);
    // The room under the screen has to grow by the same amount, or the last
    // set cannot be scrolled clear of the bar that just moved up over it.
    expect(RULED).toMatch(/\.screen-session \{ padding-bottom: calc\(104px \+ var\(--vv-bot, 0px\)\)/);
  });

  // ADDED 2026-09-16 (Dave mid-set: "if I'm trying to log something, I don't
  // even know what I'm logging, whether it's the exercise before or the
  // exercise after"). The head over the set strip said SETS. The lift's name
  // was a screen above it, past the warm-up card, the suggestion card and the
  // superset row, and the list of every OTHER exercise in the session sits
  // directly below the strip.
  // WARM MEANS WARM EVERYWHERE IT IS DRAWN (Dave 2026-09-13 "that should not
  // be a warm color... a blue that fades out", and 2026-09-16 "you actually
  // took the color out of warm up and cool down sections").
  //
  // There are THREE surfaces that draw a warm-up or a cool-down, not one: the
  // workout day's BlockList, and the live session's own two checklists. The
  // day screen has worn the tones since September and the session has been
  // plain grey the whole time -- so a block that was amber on the page you
  // planned it on was grey on the page you stood in front of at the rack,
  // which is worse than either answer chosen on purpose. This law is the
  // three of them agreeing.
  it("every warm-up and cool-down wears its tone, on the day AND in the session", () => {
    const flow = read(join(SRC, "gym/GymFlow.tsx"));
    const screen = read(join(SRC, "gym/SessionScreen.tsx"));
    // The day's BlockList: one component, both tones, card and label.
    expect(flow, "the BlockList card takes the tone").toMatch(/tone === "cool" \? " banner-cool" : " banner-warn"/);
    expect(flow, "and so does its eyebrow").toMatch(/tone === "cool" \? " eyebrow-cool" : " eyebrow-warn"/);
    // The session's two checklists, each named so a failure says which.
    expect(screen, "the session's warm-up card").toMatch(/className="card list-card-ruled banner-warn">\s*<div className="grp"><div className="eyebrow eyebrow-warn">Warm-Up/);
    expect(screen, "the session's cool-down card").toMatch(/className="card list-card-ruled banner-cool">\s*<div className="grp"><div className="eyebrow eyebrow-cool">Cool-Down/);
    // And the tones themselves are still the ruling: warm is amber, cool is a
    // blue that fades out rather than a flat fill.
    expect(RULED).toMatch(/\.banner-warn \{[^{}]*--hl-amber-tint/);
    expect(RULED).toMatch(/\.banner-cool \{[^{}]*linear-gradient\(180deg, var\(--hl-blue-tint\), transparent/);
  });

  it("and the strip's own head names the lift being logged", () => {
    const screen = read(join(SRC, "gym/SessionScreen.tsx"));
    expect(screen, "the set strip's head takes the exercise's name")
      .toMatch(/<div className="sh2 sh2-quiet"><span className="t">\{exercise\.name\}<\/span>/);
    expect(screen, "and the noun rides the count, so neither fact is lost")
      .toMatch(/\$\{workLogged\} of \$\{planEx\.sets\.length\} \$\{noun\.toLowerCase\(\)\}/);
  });
});
