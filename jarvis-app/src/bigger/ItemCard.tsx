import type { ReactNode } from "react";
import { Target } from "../shared/icons";
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
// without photos or custom artwork", so there is nothing to sample a colour
// from except the item's own Area. The two stops are derived from that one
// category token with color-mix, which means all thirteen colour slots get a
// card without anyone hand-picking thirteen pairs, and a slot added later
// gets one for free. The deepening is what makes white text legible on it:
// the flat category colours are light enough that the app writes BLACK on
// them (.cat-bg-* sets --on-fill-dark), so a card using them raw would have
// failed the contrast floor browserWalk measures.
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

/** The grid the cards sit in: two equal columns, square tiles, one gap. */
export function CardGrid({ children }: { children: ReactNode }) {
  return <div className="pad-x"><div className="bp-grid">{children}</div></div>;
}
