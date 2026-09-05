import type { KeyboardEvent } from "react";

// PRESSABLE (2026-09-05). The app builds a lot of its rows out of divs, because
// a <button> cannot always carry the row anatomy the catalog rules. A div that
// takes a tap has to say so three ways: role="button" so a screen reader
// announces it, tabIndex 0 so a keyboard can reach it, and a key handler so
// Enter and Space do what the tap does. The first two were copied everywhere
// from the first ruled row; the third was not.
//
// The browser walk of 2026-09-05 counted the result: 60 rows across brain,
// decisions, people, review, routine, messages, money, notes and health that
// Tab can reach and neither Enter nor Space can activate (BRAIN-F-21,
// EMAIL-F-31, HMN-F-24, SCHED-F-19, SHARED-F-22, BROWSER-F-13). VoiceOver was
// never affected, because it dispatches a real click; a hardware keyboard, a
// switch control and the iPad were.
//
// Spread it onto the element instead of writing the three props again:
//
//   <div className="row" {...pressable(() => open(id))}>
//
// Space is preventDefault'ed because on a focused element the browser's own
// default for Space is to scroll the page, which would fire the row AND jump
// the list.

export interface Pressable {
  role: "button";
  tabIndex: number;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
}

export function pressable(onClick: () => void, opts?: { disabled?: boolean }): Pressable {
  return {
    role: "button",
    // -1 keeps the row out of the tab order without taking its role away, for
    // a cell that is rendered but not choosable (a day outside the month).
    tabIndex: opts?.disabled ? -1 : 0,
    onClick: () => { if (!opts?.disabled) onClick(); },
    onKeyDown: (e: KeyboardEvent) => {
      if (opts?.disabled) return;
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      // A row nested inside another pressable row activates ONE of them, the
      // inner one, exactly as a click does: the click path stops at the inner
      // handler because the outer never sees a click it did not receive, and
      // the key path has to be told. Without this, Enter on a held block
      // inside a routine row would open the block AND the row under it.
      e.stopPropagation();
      onClick();
    },
  };
}

/** The same keys, for an element that already declares its own role (a radio,
    a switch, a chip that reports aria-pressed). */
export function onPressKey(onClick: () => void): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    onClick();
  };
}
