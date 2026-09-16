// THE WHOLE ROW IS THE DOOR (Dave 2026-09-15, photographed Today and
// Schedule: "I want all rows clickable. How is the first thing that renders
// on the app not clickable? It seems like throughout the app rows with
// buttons tend to not be clickable. I want a FULL sweep of this and all of
// them to be fixed").
//
// The pattern he found: a row carries a pill (Start, Drop, Ask Again, Reply)
// and the pill is the only thing on it that answers a tap. The words, the
// glyph, the padding and the gaps are dead. This scanner walks every TSX
// file with the TypeScript parser and finds each element wearing a row class
// that holds an interactive control, then asks whether the row itself takes
// a tap. A row that holds a control and takes no tap is the bug.
//
// A row that is deliberately not a door says why, in a comment on the line
// above its opening tag or inside it: `row-tap: <reason>`. The reason is
// the ruling; an empty one does not count.
import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Classes that draw a list row. Layout rows (chip-row, btn-row, xs-row)
 *  and row PARTS (row-grow, row-act, row-glyph) are not rows. */
export const ROW_CLASSES = new Set([
  "row", "task-row", "trow", "ins-row", "lib-row", "strand-row", "note-row",
  "budget-row", "sched-row", "person-row-ruled", "goal-row-ruled",
  "proj-row-ruled", "proj-row", "notif-row", "mrow", "file-row", "focus-row",
  "suggestion-row", "offer-row", "connect-row", "conn-row", "doc-find-row",
  "dup-row", "win-row", "p3-row", "msg-row", "lm-row", "lifemap-row",
  "settings-row", "cat-row", "set-row",
  // "hl" was here while the dealt task had a bespoke row of its own. It is
  // the notice row's markup now (2026-09-16) and .hl marks the .pad-x that
  // wraps it, so the row this scan must hold to being a door is the .row
  // inside, which it already finds.
]);

/** A row whose only content is a control that already fills it. */
const FILLING = new Set(["row-signout", "row-act", "row-create", "row-create-bare", "row-press", "hl-verbs", "row-ghost"]);

/** Shared row components and the prop that makes their body a door. */
export const ROW_COMPONENTS: Record<string, string> = { NoticeCard: "onOpen", TaskRow: "onOpen" };

const TAP_PROPS = new Set(["onClick", "onPointerUp", "onTap"]);
const CONTROL_TAGS = new Set(["button", "input", "select", "textarea", "a"]);

export interface RowFinding { file: string; line: number; classes: string; }

function classTokens(attr: ts.JsxAttribute): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(...n.text.split(/\s+/));
    else if (ts.isTemplateExpression(n)) {
      out.push(...n.head.text.split(/\s+/));
      n.templateSpans.forEach((s) => { visit(s.expression); out.push(...s.literal.text.split(/\s+/)); });
    } else ts.forEachChild(n, visit);
  };
  if (attr.initializer) visit(attr.initializer);
  return out.filter(Boolean);
}

function attrs(el: ts.JsxOpeningLikeElement): Map<string, ts.JsxAttribute> {
  const m = new Map<string, ts.JsxAttribute>();
  for (const p of el.attributes.properties) if (ts.isJsxAttribute(p)) m.set(p.name.getText(), p);
  return m;
}

function hasSpread(el: ts.JsxOpeningLikeElement): boolean {
  return el.attributes.properties.some((p) => ts.isJsxSpreadAttribute(p));
}

/** A spread that is known to carry a tap: pressable(...), rowDoor(...), a
 *  swipe/long-press bag, or a conditional of those. A bare `{...props}` or an
 *  empty `{...{}}` proves nothing (an empty spread hid LibraryPage's dead
 *  exercise row from the first cut of this scan). */
const DOOR_SPREAD = /(pressable|rowdoor|door|press|handlers|swipe)/i;
function spreadTaps(el: ts.JsxOpeningLikeElement): boolean {
  return el.attributes.properties.some((p) => ts.isJsxSpreadAttribute(p) && DOOR_SPREAD.test(p.expression.getText()));
}

function isControl(el: ts.JsxOpeningLikeElement): boolean {
  const tag = el.tagName.getText();
  if (CONTROL_TAGS.has(tag)) return true;
  const a = attrs(el);
  if ([...TAP_PROPS].some((p) => a.has(p))) return true;
  const role = a.get("role")?.initializer;
  if (role && ts.isStringLiteral(role) && /^(button|checkbox|switch|link)$/.test(role.text)) return true;
  // Components that render a control: Toggle, Switch, *Button, *Pill.
  return /^(Toggle|Switch|[A-Z]\w*(Button|Pill|Btn))$/.test(tag);
}

function opening(n: ts.Node): ts.JsxOpeningLikeElement | null {
  if (ts.isJsxElement(n)) return n.openingElement;
  if (ts.isJsxSelfClosingElement(n)) return n;
  return null;
}

function containsControl(n: ts.Node, self: ts.Node): boolean {
  let found = false;
  const visit = (c: ts.Node) => {
    if (found) return;
    const o = opening(c);
    if (o && c !== self && isControl(o)) { found = true; return; }
    ts.forEachChild(c, visit);
  };
  ts.forEachChild(n, visit);
  return found;
}

function exempt(src: string, sf: ts.SourceFile, node: ts.Node): boolean {
  const startLine = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
  const o = opening(node)!;
  const endLine = sf.getLineAndCharacterOfPosition(o.getEnd()).line;
  const lines = src.split("\n");
  const from = Math.max(0, startLine - 3);
  const text = lines.slice(from, endLine + 1).join("\n");
  return /row-tap:[ \t]*[A-Za-z][^\n]{2,}/.test(text);
}

export function scanFile(abs: string, rel: string): RowFinding[] {
  return scanSource(readFileSync(abs, "utf8"), rel);
}

export function scanSource(src: string, rel: string): RowFinding[] {
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: RowFinding[] = [];
  const visit = (n: ts.Node) => {
    const o = opening(n);
    if (o) {
      const cls = attrs(o).get("className");
      const tokens = cls ? classTokens(cls) : [];
      const isRow = tokens.some((t) => ROW_CLASSES.has(t)) && !tokens.some((t) => FILLING.has(t));
      const tag = o.tagName.getText();
      // Row COMPONENTS whose door is an optional prop: a call site that hands
      // the row a verb must also hand it the door.
      const doorProp = ROW_COMPONENTS[tag];
      if (doorProp) {
        const a = attrs(o);
        const hasVerb = a.has("action") || a.has("alt") || a.has("onToggle");
        if (hasVerb && !a.has(doorProp) && !spreadTaps(o) && !exempt(src, sf, n)) {
          out.push({ file: rel, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, classes: `<${tag}> without ${doorProp}` });
        }
      }
      const selfTaps = isControl(o) || spreadTaps(o) || tag === "label";
      if (isRow && !selfTaps && ts.isJsxElement(n) && containsControl(n, n) && !exempt(src, sf, n)) {
        out.push({ file: rel, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, classes: tokens.join(" ") });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

export function scanTree(root: string): RowFinding[] {
  const out: RowFinding[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!f.endsWith(".tsx") || /\.test\.tsx$/.test(f)) continue;
      // Windows joins with backslashes; the exclusion and the reported path
      // are read with forward slashes on every platform (the Windows pass,
      // 2026-09-15: testpanel/TestBench.tsx was reported as a dead row here).
      const slashed = p.replace(/\\/g, "/");
      if (/\/(bench|testpanel)\//.test(slashed)) continue;
      out.push(...scanFile(p, relative(root, p).replace(/\\/g, "/")));
    }
  };
  walk(root);
  return out;
}
