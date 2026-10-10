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

// NO CAPSULE IN A LIST ROW, NOR AT THE FOOT OF A LIST CARD (Dave 2026-10-05, locked: "Clean rows, no pills anywhere").
// `capsulesInCards` above is the wide net the screens' own tests use; THIS is the law every jsdom test runs
// (laws/catalogSetup.ts), measured over the whole suite before it was set (CATALOG_REPORT). A list row is a door: tap
// opens its sheet, swipe left is its quickest verb, swipe right completes, long press is the menu, and the one quiet verb
// a due row shows is `RowCtxAction`, which is text and not a capsule. A section's action (Add, Plan My Day, Copy
// Yesterday, Add Account) is its head's capsule, never a row at the foot of a card. The completion checkbox is state, not
// a command, and is not a capsule.
//
// A LIST ROW is a .task-row, .rem-row, .rem-card, .sched-row, .lib-row, .conn, or a .row inside a .list-card-ruled, plus
// the row classes the rebuilt screens use for the same job (.msg-row, .anytime-row, .lifemap-row, .conn-row, .offer-row).
// A LIST CARD is a .list-card-ruled or .card that holds at least one such row beside the capsule. A capsule is a
// .pill-act, .row-act, .btn-sm or .quiet-action. One in a list row is reported `label @ row-class`; one at the foot of a
// list card, outside any row, is reported `label @ foot of card-class`.
//
// THE SETTLED HOMES (CAPSULE_HOMES) are where a capsule belongs and are never reported: a section head (.sh2); a sheet's
// own bar, foot or action line; an action sheet; a notice or promo card, which has its own words and its own action (and
// NoticeCard's offer form); a toast and its Undo; a card with its own words and its own actions (the goal check-in
// outcome row, the reminder Advice strip, the send-hold card with Undo and Edit, the meeting card, the waiting card); a
// live control card (the rest timer); and an empty state with its own title, whose one quiet escape is its answer.
// An exception that is not a home is a per-file entry in catalogRoster.ts CAPSULE_ROSTER, each with a reason.
export const CAPSULE_ROW = [
  ".task-row", ".rem-row", ".rem-card", ".sched-row", ".lib-row", ".conn",
  ".list-card-ruled .row",
  ".msg-row", ".anytime-row", ".lifemap-row", ".conn-row", ".offer-row",
].join(", ");
export const CAPSULE_HOMES = [
  ".sh2", // a section head: the one place a section's action lives
  ".sheet-bar, .sheet-foot, .sheet-actions, .bar", // a sheet's own bar and foot
  ".action-sheet", // the long-press menu and its kin
  ".notice-card, .notice-actions, .notice-clear-row, .promo-card, .promo-actions", // a card with its own words and its own action
  // 2026-10-10: the Email tab's own cards, the same shape as .notice-card --
  // own words beside own actions -- surfaced here only now that Astra's
  // Message sheet wraps the whole screen in one .card, which a candidate
  // card (.email-card, its saved receipt .email-receipt-line) and the
  // screen's one-line notice (.email-note: Remote Images Off, a failed
  // mark-read's Retry, an attachment over the size cap) never sat inside
  // before.
  ".email-note, .email-card, .email-receipt-line",
  ".toast, .toast-dock", // a toast and its Undo
  ".dec-outcome-acts, .xs-strip, .send-hold, .msg-summary, .wait-card-acts", // cards with their own words and actions
  ".rest-acts", // a live control card, the rest timer
  ".empty-state", // an empty state with its own title and its one quiet escape
].join(", ");

export type CapsuleSite = { label: string; where: "row" | "foot"; box: string; chain: string };

const firstClass = (e: Element) => (e.getAttribute("class") ?? "").split(" ")[0] || e.tagName.toLowerCase();

/** Every capsule that sits in a list row or at the foot of a list card and is not in `homes`, with where it was found
 *  and its ancestor chain (nearest first), which is what the roster and the measurement read. */
export function capsuleSites(root: ParentNode | Element, homes: string = CAPSULE_HOMES): CapsuleSite[] {
  const out: CapsuleSite[] = [];
  const found = Array.from(root.querySelectorAll(CAPSULE));
  if ((root as Element).matches?.(CAPSULE)) found.push(root as Element);
  for (const b of found) {
    if (b.closest(homes)) continue;
    const label = (b.textContent ?? "").replace(/\s+/g, " ").trim() || (b.getAttribute("aria-label") ?? "?");
    const chain: string[] = [];
    for (let e = b.parentElement; e && e !== document.body && chain.length < 7; e = e.parentElement) chain.push(firstClass(e));
    const row = b.closest(CAPSULE_ROW);
    if (row) {
      out.push({ label, where: "row", box: firstClass(row), chain: chain.join(" < ") });
      continue;
    }
    const card = b.closest(".list-card-ruled, .card");
    if (card && Array.from(card.querySelectorAll(CAPSULE_ROW)).some((r) => !r.contains(b)))
      out.push({ label, where: "foot", box: firstClass(card), chain: chain.join(" < ") });
  }
  return out;
}

/** `label @ row-class` for a capsule in a list row, `label @ foot of card-class` for one at a list card's foot. */
export function capsulesInRows(root: ParentNode | Element, homes: string = CAPSULE_HOMES): string[] {
  return [...new Set(capsuleSites(root, homes).map((s) => `${s.label} @ ${s.where === "foot" ? "foot of " : ""}${s.box}`))];
}
