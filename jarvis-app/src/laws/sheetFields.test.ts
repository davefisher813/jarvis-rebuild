import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

// LAW: A SHEET'S CALL SITES LOAD AND SAVE EVERY FIELD THE SHEET SHOWS
// (2026-09-19, written after the same bug shipped three times in one day).
//
// One editor sheet, several screens that open it. Each screen builds the
// draft by hand on the way in and writes it back field by field on the way
// out, so every field the sheet gains is a field each screen has to be told
// about. Miss one and the control lies in whichever direction was missed:
// left out of `initial`, the box opens empty on a record that HAS the value;
// left out of the save, whatever was typed is discarded on Save.
//
// The history this law exists to end:
//   - B1-4 (2026-09-04) fixed it for project, extra area and if-then plan,
//     and its own comment says "Same sheet, same fields, both ends."
//   - UP-CORE-10's url and notes reached EventSheet later. Today's copy of
//     the event editor never learned them, so a stored Zoom link opened as
//     an empty field and anything typed there went nowhere (2026-09-19).
//   - `notes` reached TaskSheet after B1-4, and Today and Schedule never
//     learned it, reopening the exact subset B1-4 had closed.
//   - CategoryDetail's new-task call passed 8 of TaskSheet's 13 fields, so a
//     length set on the Life Area page was thrown away, and a task with no
//     length is not startable at all.
//
// Every one of those was a hand-maintained enumeration going stale. This is
// the enumeration, checked.

const SRC = resolve(__dirname, "..");

/**
 * Sheet component -> [the Draft it round-trips, the module that declares it].
 *
 * The module matters: gym/GymFlow renders its OWN component called
 * BlockSheet, which takes blocks and minutes and has no draft at all. Two
 * unrelated components share a name, so a tag alone cannot say which is
 * which and every call site is resolved through its import.
 */
const PAIRS: Record<string, [draft: string, from: string]> = {
  TaskSheet: ["TaskDraft", "tasks/screens/TaskSheet"],
  EventSheet: ["EventDraft", "schedule/screens/EventSheet"],
  BlockSheet: ["BlockDraft", "schedule/screens/BlockSheet"],
  CategorySheet: ["CategoryDraft", "categories/screens/CategorySheet"],
  BillSheet: ["BillDraft", "money/BillSheet"],
  PersonSheet: ["PersonDraft", "people/screens/PersonSheet"],
};

/**
 * Fields a call site may legitimately not carry, each with the reason it is
 * not a bug. Anything not listed here is a bug, not a choice -- that is the
 * whole point of the law, so an addition here is a claim someone has to be
 * able to defend.
 */
type Check = "load" | "save" | "both";
const EXEMPT: { key: string; files: RegExp; check: Check; why: string }[] = [
  // Google owns the guest list and the coverage map forbids writing it back,
  // so nothing saves it and only screens that show guests load it.
  { key: "EventSheet attendees", files: /.*/, check: "both", why: "read-only, Google's list (UP-CORE-10)" },
  // Set only by the sheet's own Forget row. A call site that wrote it on an
  // ordinary save would erase the place's remembered travel time.
  { key: "EventSheet forgetTravel", files: /.*/, check: "both", why: "sheet-internal, never round-tripped" },
  // Not a stored field at all: it is the sheet's own "Close Task" offer,
  // true for exactly one save and never read back off a task.
  { key: "TaskSheet closeNow", files: /.*/, check: "load", why: "an action, not a stored value" },
  { key: "TaskSheet closeNow", files: /BiggerPictureFlow|CategoryDetail/, check: "save", why: "new-task sites cannot close a task that does not exist yet" },
  // THE HIDDEN-ROW RULE. A row that renders only when the call site passes
  // its list must not be saved where the list is not passed: saving a field
  // whose control is not on screen writes its empty default over a real
  // value -- which is exactly how BiggerPictureFlow came to erase notes. So
  // for a hidden row the honest answer is to touch neither end.
  // AMENDED 2026-09-26 (pass-off): the Person and Event exemptions are gone.
  // Dave (2026-09-16): "They should all have the same 5 options", so the task
  // sheet's five Where rows render on every screen that opens it, the lists
  // come from one builder (tasks/screens/sheetLinks.ts, schedule/sheetEvents.ts),
  // and BiggerPictureFlow and CategoryDetail load and save personId and
  // eventId like every other site. Only the event sheet's attach rows are
  // still gated on their list.
  { key: "EventSheet taskIds", files: /CategoryDetail/, check: "both", why: "no attachTasks prop: the attach rows do not render here" },
  // This sheet edits a STAGED IMPORT ROW before anything is created, not an
  // event record. The row carries only the columns a parsed schedule has.
  { key: "EventSheet *", files: /ScheduleUploadFlow/, check: "load", why: "edits a parsed import row, which has no meeting, travel or attachments yet" },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== "node_modules") walk(p, out); }
    else if (/\.tsx$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}

function parse(file: string) {
  const src = readFileSync(file, "utf8");
  return { src, sf: ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) };
}

/** Every Draft interface in the app -> its field names. */
function draftFields(files: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of files.concat(walk(SRC).filter((x) => x.endsWith(".ts")))) {
    if (!/\.tsx?$/.test(f)) continue;
    const { src, sf } = parse(f);
    void src;
    const visit = (n: ts.Node): void => {
      if (ts.isInterfaceDeclaration(n) && PAIRS_VALUES.has(n.name.text)) {
        out.set(n.name.text, n.members.filter(ts.isPropertySignature).map((m) => m.name.getText(sf)));
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}
const PAIRS_VALUES = new Set(Object.values(PAIRS).map(([d]) => d));

interface Site { file: string; line: number; sheet: string; mode: string; initial: string; save: string; wholesale: boolean }

/** Every <XxxSheet> element that is handed a draft or a save handler. */
function callSites(files: string[]): Site[] {
  const sites: Site[] = [];
  for (const file of files) {
    const { src, sf } = parse(file);
    // Local function bodies, so onSave={handler} resolves to what it runs.
    // Body plus the draft parameter's name: a handler that hands the whole
    // draft onward (applyFix(i, draft), editBlockBasics(r, id, draft)) never
    // names a single field and is carrying all of them.
    const fns = new Map<string, { body: string; param: string }>();
    const paramOf = (f: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration) =>
      f.parameters[0] && ts.isIdentifier(f.parameters[0].name) ? f.parameters[0].name.text : "";
    const collect = (n: ts.Node): void => {
      if (ts.isFunctionDeclaration(n) && n.name && n.body) fns.set(n.name.text, { body: src.slice(n.body.getStart(sf), n.body.getEnd()), param: paramOf(n) });
      if (ts.isVariableDeclaration(n) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) && n.initializer.body) {
        fns.set(n.name.getText(sf), { body: src.slice(n.initializer.body.getStart(sf), n.initializer.body.getEnd()), param: paramOf(n.initializer) });
      }
      ts.forEachChild(n, collect);
    };
    collect(sf);

    // What this file imported each sheet name FROM, resolved against the
    // module each pair names, so a same-named local component is not mistaken
    // for the shared sheet.
    const imported = new Set<string>();
    const imports = (n: ts.Node): void => {
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.importClause?.name) {
        const name = n.importClause.name.text;
        const pair = PAIRS[name];
        if (pair && n.moduleSpecifier.text.replace(/^[./]+/, "").endsWith(pair[1].split("/").pop()!)) imported.add(name);
      }
      ts.forEachChild(n, imports);
    };
    imports(sf);

    // WHERE THE DRAFT IS ACTUALLY BUILT. It is almost never at the tag -- the
    // sheet renders from state (`initial={sheet.initial}`) that some opener
    // filled in (`setSheet({ mode: "edit", initial: { ... } })`). A first
    // version of this law pooled every `initial:` literal in the file, which
    // silently passed TodayFlow: its EVENT draft mentions notes, so the TASK
    // draft beside it read as covered while dropping them. Each literal is
    // filed under the state it belongs to, by setter name.
    const byState = new Map<string, string[]>();
    const gather = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && /^set[A-Z]/.test(n.expression.text)) {
        const state = n.expression.text.slice(3, 4).toLowerCase() + n.expression.text.slice(4);
        for (const arg of n.arguments) {
          const lit = ts.isObjectLiteralExpression(arg) ? arg
            : (ts.isArrowFunction(arg) && arg.body && ts.isObjectLiteralExpression(arg.body) ? arg.body : null);
          if (!lit) continue;
          for (const pr of lit.properties) {
            if (ts.isPropertyAssignment(pr) && pr.name.getText(sf) === "initial") {
              byState.set(state, [...(byState.get(state) ?? []), src.slice(pr.getStart(sf), pr.getEnd())]);
            }
          }
        }
      }
      ts.forEachChild(n, gather);
    };
    gather(sf);

    const visit = (n: ts.Node): void => {
      const open = ts.isJsxElement(n) ? n.openingElement : (ts.isJsxSelfClosingElement(n) ? n : null);
      if (open) {
        const tag = open.tagName.getText(sf);
        if (PAIRS[tag] && imported.has(tag)) {
          const props: Record<string, string> = {};
          for (const a of open.attributes.properties) {
            if (ts.isJsxAttribute(a) && a.name) props[a.name.getText(sf)] = a.initializer ? src.slice(a.initializer.getStart(sf), a.initializer.getEnd()) : "true";
          }
          let save = props.onSave ?? "";
          let param = (save.match(/\(?\s*([A-Za-z_$][\w$]*)\s*(?::[^)]*)?\)?\s*=>/) ?? [])[1] ?? "";
          const ref = save.match(/^\{([A-Za-z_$][\w$]*)\}$/);
          let named = false;
          if (ref && fns.has(ref[1]!)) { const r = fns.get(ref[1]!)!; save = r.body; param = r.param; named = true; }
          // The draft used as a bare value, not drilled into: carried whole.
          // Measured on the BODY only -- the parameter's own declaration,
          // `(draft) =>`, is a bare mention that means nothing.
          // A named handler is already just its body; an inline one still
          // carries `(draft) =>` in front of it, and only that leading
          // declaration has to be cut away.
          const body = !named && save.includes("=>") ? save.slice(save.indexOf("=>") + 2) : save;
          const wholesale = !!param && new RegExp("\\b" + param + "\\b(?!\\s*\\.)").test(body);
          const inlineInitial = props.initial ?? "";
          sites.push({
            file: file.slice(SRC.length + 1),
            line: sf.getLineAndCharacterOfPosition(open.getStart(sf)).line + 1,
            sheet: tag,
            mode: props.mode ?? "",
            // `{{ ... }}` is the draft itself; `{sheet.initial}` names the
            // state whose opener built it.
            initial: /^\{\{/.test(inlineInitial)
              ? inlineInitial
              : (byState.get((inlineInitial.match(/\{\s*([A-Za-z_$][\w$]*)[.?]/) ?? [])[1] ?? "") ?? []).join("\n"),
            save, wholesale,
          });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return sites;
}

const exemptFor = (sheet: string, field: string, file: string, check: Check) =>
  EXEMPT.some((e) => (e.key === sheet + " " + field || e.key === sheet + " *")
    && e.files.test(file) && (e.check === "both" || e.check === check));

describe("LAW: a sheet's call sites load and save every field it shows", () => {
  const files = walk(SRC);
  const fields = draftFields(files);
  const sites = callSites(files);

  it("knows what it is checking", () => {
    for (const [draft] of Object.values(PAIRS)) expect(fields.get(draft), draft + " not found").toBeTruthy();
    expect(sites.length).toBeGreaterThan(10);
  });

  it("every field is written back by every call site that can save it", () => {
    const bad: string[] = [];
    for (const s of sites) {
      if (!s.save || s.wholesale) continue;
      for (const f of fields.get(PAIRS[s.sheet]![0]) ?? []) {
        if (exemptFor(s.sheet, f, s.file, "save")) continue;
        if (!new RegExp("\\b" + f + "\\b").test(s.save)) bad.push(`${s.file}:${s.line} (${s.sheet}) never saves "${f}"`);
      }
    }
    expect(bad, "a field the sheet shows but this screen drops on Save; add it, or exempt it with a reason").toEqual([]);
  });

  it("every field is read into the draft by every call site that edits", () => {
    const bad: string[] = [];
    for (const s of sites) {
      // A new record has nothing to load.
      if (/"new"/.test(s.mode) || !s.initial) continue;
      for (const f of fields.get(PAIRS[s.sheet]![0]) ?? []) {
        if (exemptFor(s.sheet, f, s.file, "load")) continue;
        if (!new RegExp("\\b" + f + "\\b").test(s.initial)) bad.push(`${s.file}:${s.line} (${s.sheet}) never loads "${f}"`);
      }
    }
    expect(bad, "a field the sheet shows but this screen opens empty; add it to initial, or exempt it with a reason").toEqual([]);
  });
});
