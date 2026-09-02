import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { haptics } from "./haptics";
import { Check } from "./icons";

// THE DROPDOWN (Fewer Buttons, Dave 2026-09-02: "I don't like all those
// floating buttons. There's way too many. Think of a completely different
// layout. Dropdowns or something else might work." Picked: "One line of
// dropdowns on the list head").
//
// Closed, it is one capsule that states the current value. Tapped, a menu
// drops from it: every option, the current one ticked, a count beside any
// option that has one. The tap on an option is the pick and the close; a
// tap anywhere else closes it unchanged. Two chip rows and a group-by pill
// became three of these on one line, and every count the chips carried is
// still one tap away, inside the menu.
//
// The panel is a portal fixed to the capsule's own box, so no card, scroll
// container or sticky header can clip it; it anchors to whichever edge of
// the screen the capsule is nearer.

export interface MenuOption {
  value: string;
  label: string;
  count?: number;
  /** A category dot, in its colour name (cat-bg-*). */
  dot?: string;
}

export default function HeadMenu({
  value,
  options,
  onPick,
  ariaLabel,
  label,
  count,
  lead = false,
  variant = "capsule",
  off = false,
  multi = false,
  picked,
}: {
  value: string;
  options: MenuOption[];
  onPick: (value: string) => void;
  ariaLabel: string;
  /** What the closed capsule says; the current option's label by default. */
  label?: string;
  /** A count after the capsule's word (the lead menu shows the list's). */
  count?: number;
  /** The lead capsule is the head's own word: brighter, a touch larger. */
  lead?: boolean;
  /** "value": worn as a grouped-table row's trailing value, no capsule. */
  variant?: "capsule" | "value";
  /** A value that means nothing is set (Off, None) reads in the quiet ink. */
  off?: boolean;
  /** MANY AT ONCE (the task sheet's areas, 2026-09-02): every option in
      `picked` wears a tick, a tap toggles one and leaves the menu open,
      and only the clearing option (value "") closes it. The caller keeps
      the list and says what the closed value reads (`label`). */
  multi?: boolean;
  picked?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; bottom: number; left: number; right: number; fromRight: boolean; up: boolean; maxH: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);
  const word = label ?? current?.label ?? "";

  useLayoutEffect(() => {
    if (!open) { setBox(null); return; }
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const fromRight = r.left + r.width / 2 > vw / 2;
    // Drops down by default; opens upward when the room is below the fold
    // and there is more of it above (a menu at the foot of a tall sheet).
    const want = options.length * 44 + 12;
    const below = vh - r.bottom - 12, above = r.top - 12;
    const up = want > below && above > below;
    setBox({ top: r.bottom + 6, bottom: vh - r.top + 6, left: r.left, right: vw - r.right, fromRight, up, maxH: Math.max(132, Math.min(want, up ? above : below)) });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const isOn = (v: string) => (multi ? (v === "" ? (picked?.length ?? 0) === 0 : (picked ?? []).includes(v)) : v === value);
  const pick = (v: string) => {
    haptics.selection();
    if (!multi || v === "") setOpen(false);
    if (multi || v !== value) onPick(v);
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={"dd" + (lead ? " dd-lead" : "") + (variant === "value" ? " dd-value" : "") + (off ? " dd-off" : "") + (open ? " dd-open" : "")}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { haptics.selection(); setOpen((o) => !o); }}
      >
        {current?.dot && <span className={"cat-dot cat-bg-" + current.dot} />}
        <span className="dd-w">{word}</span>
        {count != null && <span className="dd-n">{count}</span>}
        <span className="dd-cv" aria-hidden="true" />
      </button>
      {open && box && createPortal(
        <div className="hmenu-scrim" onClick={() => setOpen(false)}>
          <div
            className={"hmenu" + (box.fromRight ? " hmenu-right" : "") + (box.up ? " hmenu-up" : "")}
            role="menu"
            aria-label={ariaLabel}
            style={{ ...(box.up ? { bottom: box.bottom } : { top: box.top }), ...(box.fromRight ? { right: box.right } : { left: box.left }), maxHeight: box.maxH }}
            onClick={(e) => e.stopPropagation()}
          >
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                className={"hmenu-item" + (isOn(o.value) ? " on" : "")}
                role={multi ? "menuitemcheckbox" : "menuitemradio"}
                aria-checked={isOn(o.value)}
                onClick={() => pick(o.value)}
              >
                <span className="hmenu-tick">{isOn(o.value) && <Check className="ic" />}</span>
                {o.dot && <span className={"cat-dot cat-bg-" + o.dot} />}
                <span className="hmenu-l">{o.label}</span>
                {o.count != null && <span className="hmenu-n">{o.count}</span>}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
