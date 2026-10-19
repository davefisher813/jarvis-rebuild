import type { ReactNode } from "react";
import { catColor, catName } from "./categories";

// THE UNIFIED CHIP (Dave 2026-10-09, the pass-off, item 14: "all of it now").
// A row's area is a small chip in the area's own colour, and the words that
// belong beside it sit right next to it: on a task, the project (or event) it
// is filed under; on a note, the note's own first line. This replaces the
// coloured dot ahead of the area's name ("Option A"). A row with no area shows
// no chip at all, and a line with neither a chip nor words is not drawn.
//
// One component for both, so a task row and a note row cannot drift apart.
// The outer span is the line's "where it lives" fact (.r-goal.r-parent), so it
// keeps the floor and the truncation that fact already has on the task row's
// one-line clamp; the words are the row's one grey and are cut with an
// ellipsis; the chip never shrinks.

/** The area a chip names, or null when the reference has no live name. */
export function chipArea(ref: string | null | undefined): { name: string; slot: string } | null {
  const name = ref ? catName(ref) : "";
  return name ? { name, slot: catColor(ref!) } : null;
}

/** The chip alone, for a row that sets it beside its own title (a note row, Dave 2026-10-11). No area, no chip. */
export function CatChip({ category, empty }: { category?: string | null; /** The words of a muted chip when there is no area (Notes: "No Area"), so a row's rhythm never breaks. Absent: no area, no chip. */ empty?: string }) {
  const area = chipArea(category);
  if (!area && empty) return <span className="cat-chip cat-chip-none"><span className="cat-chip-dot cat-chip-dot-none" aria-hidden="true" />{empty}</span>;
  // THE APPROVED CHIP (unified-chip-system-mockup-2026-10-09, .chip): a quiet pill, the area's colour as a dot, and the
  // area's name in plain case beside it.
  return area ? <span className="cat-chip"><span className={"cat-chip-dot cat-bg-" + area.slot} aria-hidden="true" />{area.name}</span> : null;
}

export default function CatChipLine({ category, text, sentence = false }: {
  /** A category id. Absent, unknown or nameless: no chip. */
  category?: string | null;
  /** The words beside the chip: a project's name, a note's first line. */
  text?: ReactNode;
  /** The words are his own sentence (a note's body), drawn as written, so the catalog's casing check leaves them be. */
  sentence?: boolean;
}) {
  const area = chipArea(category);
  const words = typeof text === "string" ? text.trim() : text;
  if (!area && !words) return null;
  return (
    <span className="r-goal r-parent">
      {area && <CatChip category={category} />}
      {words ? <span className="r-goal-t" {...(sentence ? { "data-sentence": "" } : {})}>{words}</span> : null}
    </span>
  );
}
