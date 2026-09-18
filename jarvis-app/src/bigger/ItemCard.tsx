import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Target } from "../shared/icons";
import { FolderOpenGlyph } from "../shared/glyphs";
import { catColor } from "../shared/categories";

// ---------------------------------------------------------------------------
// THE CARD (Dave 2026-09-18, with an approved mockup: "Follow Apple Music's
// smaller square album tiles, not its large featured cards or tall Replay
// cards... Apple Music's small album-card scale, with the approved JARVIS
// design and all information contained inside").
//
// ONE COMPONENT, TWO VARIANTS, because a project and a goal are the same
// OBJECT here -- a thing with a name, an area, and something true about how
// far along it is -- and the handoff asks for exactly that: "Add one reusable
// card component with Project and Goal variants."
//
// WHAT THE GRADIENT IS MADE OF. Every card has to work "for any subject
// without photos or custom artwork", so there is nothing to colour it by
// except the item's own Area. Dave then asked for "the coloring and shading
// identical to the pic I sent", so the four areas in his mockup carry the
// pairs sampled straight off it and every other colour slot carries its own
// hue at that family's saturation and lightness. The pairs live in ruled.css,
// one per slot; this only picks the slot.
//
// WHAT A GOAL MAY NOT CLAIM. "Do not treat linked task completion as outcome
// progress. For example, finishing fundraising tasks does not mean money has
// been raised." So a goal's bar is drawn ONLY from a Measure -- a count, a
// cadence, a dollar amount, milestones, a lift, a reading -- each of which is
// derived from dated evidence the app already holds. A goal with no measure
// shows what it honestly has (its linked projects) and NO bar at all. This is
// the one rule in the handoff that is about truth rather than looks, and
// laws/itemCard.test.ts holds it.
// ---------------------------------------------------------------------------

/** How far along, when there is an honest denominator. Never invented. */
export interface CardProgress {
  done: number;
  total: number;
  pct: number;
}

export interface ItemCardProps {
  kind: "project" | "goal";
  title: string;
  /** The Area's name and its colour ref. Both may be absent: an unfiled item
   *  still gets a card, in the neutral slot, rather than being left out. */
  areaName?: string | null;
  areaRef?: string | null;
  /** The line under the title. A project's next action, a goal's measure
   *  line. One line; the card clamps it rather than growing. */
  lead?: string | null;
  /** The count, as words the row already uses ("8 of 10 tasks", "3 linked
   *  projects"). Never a percentage beside a count that already says it --
   *  the handoff is explicit, and the bar underneath says the same thing a
   *  third time. */
  foot?: string | null;
  /** Drawn only when it is earned. For a goal that means a Measure. */
  progress?: CardProgress | null;
  onOpen: () => void;
  /** The overflow keeps the actions the row already had. */
  onMenu?: () => void;
  menuLabel?: string;
}

export default function ItemCard({
  kind, title, areaName, areaRef, lead, foot, progress, onOpen, onMenu, menuLabel,
}: ItemCardProps) {
  const slot = catColor(areaRef ?? undefined);
  return (
    <div
      className={"bp-card bp-card-" + slot}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
    >
      <div className="bp-card-top">
        <span className="bp-card-ic" aria-hidden="true">
          {kind === "goal" ? <Target className="ic" /> : <FolderOpenGlyph />}
        </span>
        {/* The area names itself. It is the only place the card's colour is
            explained, so it is never dropped even when the name is long. */}
        <span className="bp-card-area">{areaName ?? "Unfiled"}</span>
        {onMenu && (
          <button
            type="button"
            className="bp-card-more"
            aria-label={menuLabel ?? "More"}
            onClick={(e) => { e.stopPropagation(); onMenu(); }}
          >
            <span aria-hidden="true">···</span>
          </button>
        )}
      </div>

      {/* THE TITLE WRAPS (the handoff: "Allow titles to wrap naturally.
          Handle unusually long titles without overlapping metadata or
          shrinking text excessively"). It takes the middle of the card and
          clamps at three lines, so a long name eats its own space and never
          the count and bar below it. The type does not shrink. */}
      <div className="bp-card-title">{title}</div>

      <div className="bp-card-foot">
        {lead && <div className="bp-card-lead">{lead}</div>}
        {foot && <div className="bp-card-n">{foot}</div>}
        {progress && progress.total > 0 && (
          <div
            className="bp-card-bar"
            role="img"
            aria-label={`${progress.done} of ${progress.total}`}
          >
            <i style={{ width: Math.max(2, Math.min(100, progress.pct)) + "%" }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// THE SHELF (Dave 2026-09-18: "They can scroll laterally like Apple Music to
// save vertical space. Just make sure there's an arrow so users know").
//
// One sideways row instead of a grid, so a lens with twenty projects costs
// the same height as one with two. The next card peeks past the right edge,
// which is the usual hint, and Dave said the hint is not enough on its own --
// hence a real arrow, shown only while there is somewhere to go that way, and
// tappable rather than decorative.
//
// The arrows are driven by measurement, not by a count: scrollWidth against
// clientWidth after every scroll, resize and change of children. When the
// cards already fit, neither arrow exists.
// ---------------------------------------------------------------------------
export function CardGrid({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [more, setMore] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const room = el.scrollWidth - el.clientWidth;
    const at = el.scrollLeft;
    setMore((p) => {
      const next = { left: at > 4, right: room - at > 4 };
      return p.left === next.left && p.right === next.right ? p : next;
    });
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, children]);

  // A page is most of a screenful, which lands near a card boundary and lets
  // the scroll-snap finish the job.
  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el || typeof el.scrollBy !== "function") return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <div className="bp-shelf">
      <div className="bp-grid" ref={ref} onScroll={measure}>{children}</div>
      {more.left && (
        <button type="button" className="bp-shelf-arrow bp-shelf-arrow-l"
          aria-label="Scroll back" onClick={() => page(-1)}>
          <ChevronLeft className="ic" />
        </button>
      )}
      {more.right && (
        <button type="button" className="bp-shelf-arrow bp-shelf-arrow-r"
          aria-label="Scroll for more" onClick={() => page(1)}>
          <ChevronRight className="ic" />
        </button>
      )}
    </div>
  );
}
