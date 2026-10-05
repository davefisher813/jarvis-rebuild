// THE CATALOG, CHECKED ON WHAT IS DRAWN (Dave 2026-10-05: "Earlier 2 blocks"; docs/jarvis-unified/VISUAL-CATALOG-GATE.md).
//
// A static scan reads source, and source cannot see a count that a component
// interpolates in JSX (`{n} {n === 1 ? "block" : "blocks"}`), which is how a
// lowercase word behind a leading number reached the live Schedule page. This
// reads the rendered DOM instead. Every test that mounts a screen runs it
// (laws/catalogSetup.ts), and the tap sweep runs the same rule in the browser.
//
// THE RULE: in any phrase that opens with a number, the word behind the number
// is capitalized ("2 Blocks", "5 Email Items", "45 Min"). A phrase is a run of
// text between middle dots, line breaks and element edges; b, strong, i and em
// are part of the phrase around them (`<b>3</b> Open`), every other element is
// an edge (each `.fact` is its own phrase). A small word that joins two numbers
// ("2 of 5") is part of the quantity. Sentence-case surfaces (chat, note
// bodies, a typed field, mail he received) are not checked: mark them
// data-sentence.
import { capAfterNumber } from "../shared/casing";

const SKIP = "script,style,textarea,input,select,[contenteditable],[data-sentence],[data-user-text]";
const INLINE = new Set(["B", "STRONG", "I", "EM"]);

// The phrases of one element, as drawn: its own text, with inline children read
// through and every other child an edge.
function phrasesOf(el: Element, into: string[]): void {
  let run = "";
  const flush = () => {
    if (run.trim()) into.push(run);
    run = "";
  };
  const walk = (n: Node) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === 3) run += c.nodeValue ?? "";
      else if (c.nodeType === 1) {
        const ce = c as Element;
        if (ce.matches(SKIP)) flush();
        else if (INLINE.has(ce.tagName)) walk(ce);
        else flush();
      }
    }
  };
  walk(el);
  flush();
}

// One violation per distinct phrase, spelled the way it was drawn.
export function numberCaseViolations(root: ParentNode | Element): string[] {
  const out = new Set<string>();
  const els: Element[] = [];
  if ((root as Element).nodeType === 1) els.push(root as Element);
  els.push(...Array.from(root.querySelectorAll("*")));
  for (const el of els) {
    if (el.closest(SKIP) || INLINE.has(el.tagName)) continue;
    const runs: string[] = [];
    phrasesOf(el, runs);
    for (const run of runs) {
      for (const seg of run.split(/[·\n]/)) {
        // A narrow no-break space (the clock's "9 AM") is a space to the reader.
        const t = seg.replace(/\s+/g, " ").trim();
        if (!/^[^A-Za-z]*\d/.test(t)) continue;
        if (capAfterNumber(t) !== t) out.add(t.slice(0, 80));
      }
    }
  }
  return [...out];
}

// A CARD WITH NOTHING IN IT BUT AN ACTION CAPSULE (Dave 2026-10-05: "Add a Reminder" in a grey rectangle). A plate whose
// whole text is one button's label is a box round a button; the capsule stands by itself. A card with rows, or with
// words of its own beside the button, is not this.
export function loneActionBoxes(root: ParentNode | Element): string[] {
  const out = new Set<string>();
  const cards = Array.from(root.querySelectorAll(".card, .list-card-ruled, .empty-state"));
  if ((root as Element).matches?.(".card, .list-card-ruled, .empty-state")) cards.push(root as Element);
  for (const c of cards) {
    const acts = c.querySelectorAll(".row-act, .pill-act");
    if (acts.length !== 1) continue;
    const norm = (t: string | null) => (t ?? "").replace(/\s+/g, " ").trim();
    if (norm(c.textContent) && norm(c.textContent) === norm(acts[0]!.textContent)) out.add(norm(c.textContent));
  }
  return [...out];
}

// NO CAPSULE INSIDE A ROW OR A CARD (Dave 2026-10-05, locked: "Clean rows, no pills anywhere"). A row is a door: tap
// opens its sheet, swipe left is its quickest action, swipe right completes, long press is the menu. A section-level
// action (Add, Plan My Day, Copy Yesterday, Add Account) lives in the section head, never in a card. The completion
// checkbox stays on the row (state, not a command). Reports `label @ container` for each capsule found in a card, a
// list, or a row. A capsule in a section head (.sh2), a sheet's own bar or foot, a notice or promo card's action row
// (.notice-actions) or a menu is where actions belong.
const CAPSULE = ".pill-act, .row-act, .btn-sm, .quiet-action";
const HOMES = ".sh2, .bar, .sheet-bar, .sheet-foot, .action-sheet, .notice-clear-row, .head-actions, .pagehead, .promo-actions, .notice-actions";
export function capsulesInCards(root: ParentNode | Element): string[] {
  const out = new Set<string>();
  const found = Array.from(root.querySelectorAll(CAPSULE));
  if ((root as Element).matches?.(CAPSULE)) found.push(root as Element);
  for (const b of found) {
    if (b.closest(HOMES)) continue;
    const box = b.closest(".card, .list-card-ruled, .row, .rem-row, .task-row, .conn, .grp");
    if (!box) continue;
    const label = (b.textContent ?? "").replace(/\s+/g, " ").trim() || (b.getAttribute("aria-label") ?? "?");
    out.add(`${label} @ ${(box.getAttribute("class") ?? "").split(" ")[0]}`);
  }
  return [...out];
}
