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
  /** The Area's colour ref. May be absent: an unfiled item still gets a card,
   *  in the neutral slot, rather than being left out. The area's NAME is not
   *  here on purpose -- the shelf the card sits in is headed by it, and
   *  printing it a third time on every tile was the "Elite Squ..." the head
   *  above it had already said in full. */
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
  kind, title, areaRef, lead, foot, progress, onOpen, onMenu, menuLabel,
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
        <span className="bp-card-spring" />
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

      {/* THE TITLE IS TWO LINES, ALWAYS (2026-09-18). It was three, taking
          whatever the card had left -- and on a 160pt tile that is less than
          three lines, so the clamp never fired and the browser sliced the
          last line through the middle of the letters instead. Two lines fit
          the square at every text size, so a long name ellipses cleanly and
          the count and bar sit at the same height on every card in the row.
          The type does not shrink. */}
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
// save vertical space. Just make sure there's an arrow so users know", then
// "They should all be organized by category in each row and scroll to the
// right hand of the user... Reference the formatting of Apple Music it's
// perfect").
//
// So: ONE SHELF PER AREA, each with its name over it, each scrolling
// sideways on its own. That is the Apple Music page shape -- Recently Played,
// Stations for You, Golden Age Hip-Hop -- and it is also the grouping the
// ruled list beside it has used since "the category should be the main
// organizer" (2026-09-09). The two views now say the same thing in two
// shapes instead of disagreeing about the order of the page.
//
// The head is a real button where there is somewhere to go: tapping an area's
// name cuts the page to that area, which is what the chevron promises. The
// catch-all shelves (More Work, Working Toward) have no area to open, so they
// carry no chevron rather than a dead one.
//
// The arrows are driven by measurement, not by a count: scrollWidth against
// clientWidth after every scroll, resize and change of children. When the
// cards already fit, neither arrow exists.
// ---------------------------------------------------------------------------
export function CardShelf({ title, onOpen, children }: {
  title: string;
  /** Cuts the page to this area. Absent on a catch-all shelf. */
  onOpen?: () => void;
  children: ReactNode;
}) {
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
    <section className="bp-sec">
      {onOpen ? (
        <button type="button" className="bp-shelf-head" onClick={onOpen}>
          <span className="t">{title}</span>
          <ChevronRight className="ic" />
        </button>
      ) : (
        <div className="bp-shelf-head"><span className="t">{title}</span></div>
      )}
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
    </section>
  );
}
