import { createContext, useContext, useEffect, type ReactNode } from "react";

// WHERE YOU CAME FROM (Dave 2026-09-21: "I need you to FULLY audit back
// buttons on every single page and the logic. There are a bunch that take you
// to other pages and not the previous page. It should always be the previous
// page").
//
// WHAT THE AUDIT FOUND. Ninety-one back controls, and the labelled ones are
// not lying: every page that names a destination ("Settings", "Brain",
// "Notes") is mounted by exactly one parent, and that parent IS what its
// label says. The failure is one level up. The shell can drop you INTO a flow
// from another tab -- Start Now on Today opens the Tasks flow's start screen,
// Email's Connections row opens the More tab's connections page, a search hit
// opens a task in Life -- and the flow has no idea it was entered from
// outside. So its back does the only thing it knows: return to its own root.
// Email -> Connections -> back lands on Settings. Today -> Start Now -> back
// lands on All Tasks. Neither is the previous page.
//
// WHY THIS IS NOT A HISTORY STACK. A stack would be consulted by every back
// control in the app, including the ones that are already right: Settings ->
// Advanced -> back must go to Settings, not to whatever tab you were on
// before you opened Settings. The origin is not a property of the app, it is
// a property of the ONE page a cross-tab jump opened, so it is carried with
// that jump and read only by that page. A back control that nothing jumped
// into never sees it and never changes.
//
// It is consumed once. Going back clears it, so a second back press falls
// through to the flow's own behaviour rather than bouncing between tabs.

export interface NavOrigin {
  /** The destination key jumped from ("today", "messages", ...). */
  key: string;
  /** What to call it on the button: the destination's own label. */
  label: string;
}

export interface NavOriginValue {
  /** Set only while a cross-tab jump's page is still open. */
  origin: NavOrigin | null;
  /** Restore it, and clear. Returns false when there was nowhere to go. */
  back: () => boolean;
  /** A page whose own back control offers the way home CLAIMS the origin
   *  while it is mounted, so the shell does not draw a second one beside it.
   *  Returns the release. */
  claim: () => () => void;
  /** True while some mounted page is claiming it. */
  claimed: boolean;
  /** RELEASE the origin without going anywhere. For the page a jump opened,
   *  the moment it closes to its own root: the origin was "the way home from
   *  that page", and once the page is gone there is nothing for the shell's
   *  return pill to be the way home from (Alfred 2026-10-04, a stray "< Life"
   *  over Your Routine). Stable across renders. Idempotent. A claim only HIDES
   *  the origin while a page is mounted and leaves it live behind; this ends
   *  it, so it is the one to use when the page is closing for good. */
  clear: () => void;
}

/**
 * THE SCREEN YOU ACTUALLY CAME FROM (the ship-blocker review, 2026-10-05: a
 * project or goal opened from the Life tab wore a "Brain" return pill).
 *
 * An area's own page is the Brain tab's screen (BrainFlow draws it), but when
 * the person reached it from the Life tab's Areas lens the shell lights Life
 * in the tab bar and Life is where they believe they are. A jump made from
 * that page must carry the Life origin, not the Brain one: the pill names the
 * screen they came from, and going back lands on the tab they were using.
 * `areaFromLife` is the shell's own flag for exactly that case.
 */
export function originPlace(active: string, areaFromLife: boolean): string {
  return active === "brain" && areaFromLife ? "life" : active;
}

const Ctx = createContext<NavOriginValue>({ origin: null, back: () => false, claim: () => () => {}, claimed: false, clear: () => {} });

export function NavOriginProvider({ value, children }: { value: NavOriginValue; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The page a cross-tab jump opened reads this; nothing else does. */
export function useNavOrigin(): NavOriginValue {
  return useContext(Ctx);
}

/**
 * The label and handler a back control should use.
 *
 * `own` ALWAYS runs, and that is the whole point of the shape: a page's own
 * back handler is rarely just navigation. StartScreen's writes the stop
 * point; a flow's clears the route it was on. Swapping it out for the origin
 * would silently drop that work, which is a worse bug than the one this
 * fixes. So the page closes itself exactly as it always did, and THEN, if a
 * cross-tab jump is what opened it, the shell returns you to where you were.
 *
 * `label` is what the button says when nothing jumped into it.
 */
export function useLeaveVia(label: string, own: () => void): { label: string; onBack: () => void } {
  const nav = useNavOrigin();
  const live = !!nav.origin;
  // While this page is on screen AND a jump is what opened it, the way home
  // is this button, so the shell's own return pill stands down.
  //
  // `claim` is deliberately the only dependency besides `live`: the context
  // VALUE is a fresh object on every shell render, so depending on it would
  // release and re-claim forever -- and since claiming sets shell state, that
  // is an infinite loop, not just churn. AppShell hands out a stable claim.
  const { claim } = nav;
  useEffect(() => {
    if (!live) return;
    return claim();
  }, [live, claim]);
  return {
    label: nav.origin ? nav.origin.label : label,
    onBack: () => { own(); nav.back(); },
  };
}
