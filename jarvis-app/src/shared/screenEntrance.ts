// THE FIRST OPEN (Dave 2026-10-11, visual catalog, Motion: "Use New").
//
// On the FIRST open of a screen in a launch, its cards rise 4px and fade in over 220ms, 40ms apart in document order,
// the stagger capped at five steps so the last card starts by 200ms (components.css, THE FIRST OPEN). A return visit
// to a screen in the same launch does not animate, and nothing re-animates on a tab visit: the standing law of
// 2026-07-29 ("content never re-animates on a tab switch") still holds for every open after the first.
//
// How a screen is known: the shell's tab plus the screen's own title (its page bar or large title), falling back to
// the screen element's classes. The memory is this module's, so it lasts exactly one launch.
//
// Which cards: the page cards of the screen, in document order, that arrive within a short window after the screen
// opens (the data behind a screen lands a beat after its frame). A card inside a card is a row, and a sheet is not
// part of the screen, so neither is marked. Each card's mark comes off when its entrance lands, so a later render, a
// press or a swipe never sees it. Off under Reduce Motion, the phone's or the app's own (html[data-motion="reduce"]).

const seen = new Set<string>();

/** For tests: forget every screen, as a fresh launch would. */
export function resetScreenEntrances(): void {
  seen.clear();
}

/** True the first time a screen key is opened in this launch, false every time after. */
export function claimFirstOpen(key: string): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

export const ENTER_CLASS = "card-enter";
export const STAGGER_CAP = 5;
/** How long after a screen opens its arriving cards still take the entrance. */
export const ENTER_WINDOW_MS = 400;

export function motionReduced(doc: Document = document): boolean {
  if (doc.documentElement.getAttribute("data-motion") === "reduce") return true;
  const mm = doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)");
  return !!mm && mm.matches;
}

/** The screen's name for this purpose: its title if it shows one, else its classes. */
export function screenKey(tab: string, screen: Element): string {
  const title = screen.querySelector(".pagebar-title, .pagehead-title")?.textContent?.trim();
  return tab + "|" + (title || screen.className);
}

function isPageCard(el: Element): boolean {
  return el.classList.contains("card") && !el.parentElement?.closest(".card") && !el.closest(".sheet-scrim");
}

function pageCards(root: Element): Element[] {
  const out: Element[] = [];
  if (isPageCard(root)) out.push(root);
  root.querySelectorAll(".card").forEach((c) => { if (isPageCard(c)) out.push(c); });
  return out;
}

function topScreens(root: Element): Element[] {
  const all: Element[] = [];
  if (root.classList.contains("screen")) all.push(root);
  root.querySelectorAll(".screen").forEach((s) => all.push(s));
  return all.filter((s) => !s.parentElement?.closest(".screen") && !s.closest(".sheet-scrim"));
}

/**
 * Watch a scroller for screens opening. Returns a stop function.
 * `tab` is read at the moment a screen appears, so the shell can pass its current tab.
 */
export function watchScreenEntrances(scroller: HTMLElement, tab: () => string, now: () => number = () => Date.now()): () => void {
  const known = new WeakSet<Element>();
  const marked = new WeakSet<Element>();
  // A screen that is entering, the time it opened and how many cards it has marked so far.
  const entering = new Map<Element, { at: number; n: number }>();

  const mark = (card: Element, screen: Element) => {
    const e = entering.get(screen);
    if (!e || marked.has(card)) return;
    marked.add(card);
    const el = card as HTMLElement;
    el.style.setProperty("--enter-i", String(Math.min(e.n, STAGGER_CAP)));
    e.n += 1;
    el.classList.add(ENTER_CLASS);
    const done = () => {
      el.classList.remove(ENTER_CLASS);
      el.style.removeProperty("--enter-i");
      el.removeEventListener("animationend", done);
    };
    el.addEventListener("animationend", done);
    // A card that never animates (hidden, or a test without layout) still loses its mark.
    setTimeout(done, 700);
  };

  const openScreen = (screen: Element) => {
    if (known.has(screen)) return;
    known.add(screen);
    const first = claimFirstOpen(screenKey(tab(), screen));
    if (!first || motionReduced(scroller.ownerDocument)) return;
    entering.set(screen, { at: now(), n: 0 });
    for (const c of pageCards(screen)) mark(c, screen);
  };

  const visit = (node: Node) => {
    if (!(node instanceof Element)) return;
    for (const s of topScreens(node)) openScreen(s);
    // Cards arriving inside a screen that is still in its entrance window.
    const host = node.closest(".screen");
    if (host) {
      const top = topScreens(host.ownerDocument.body).find((s) => s.contains(host)) ?? host;
      const e = entering.get(top);
      if (e && now() - e.at <= ENTER_WINDOW_MS) for (const c of pageCards(node)) mark(c, top);
    }
  };

  visit(scroller);
  const obs = new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach(visit);
  });
  obs.observe(scroller, { childList: true, subtree: true });
  return () => obs.disconnect();
}
