import { catIcon } from "../../categories/icons";
import type { ColorSlot } from "../../categories/types";
import { pressable } from "../../shared/pressable";
import { lineCase } from "../../shared/casing";

// AREAS TAB (2026-09-16). Restyled to Dave's reference the same day (his
// screenshot of the ChatGPT mock: "I love the new style for the life areas
// page"): every area is its own card, led by a flat colour tile wearing the
// category's glyph in white (the tile is flat on purpose: "eliminate the
// shading on the icons"), the name over its counts, a chevron at the right.
// The whole card is the door. A departure from J3's "no glyph tiles in
// lists", stated in the commit: Dave asked for this shape by name.
export interface AreaCounts { taskCount: number; goalCount: number; projectCount: number }
export interface AreaSummary { id: string; name: string; color: ColorSlot; icon?: string }

// Cased the way the Health card beside it says "5 Sections" (lineCase).
function statLine(n: number, singular: string, plural: string): string | null {
  if (n <= 0) return null;
  return lineCase(`${n} ${n === 1 ? singular : plural}`);
}

export default function AreaItemStandard({ area, counts, onOpen, health = false }: {
  area: AreaSummary;
  counts: AreaCounts;
  onOpen: () => void;
  /** Health is an area like the rest (Dave 2026-10-05, "Clean rows, no pills anywhere"): its five sections (Track, Train,
   *  Reports, Meds, Privacy) were a row of capsules inside this card, and they are the doors on its own page now. It
   *  keeps its place at the head of the list and its class, and draws exactly what every area draws. */
  health?: boolean;
}) {
  const stats = [
    statLine(counts.taskCount, "task", "tasks"),
    statLine(counts.goalCount, "goal", "goals"),
    statLine(counts.projectCount, "project", "projects"),
  ].filter((s): s is string => s !== null);

  return (
    <div className={"card area-card" + (health ? " area-card-health" : "")} {...pressable(onOpen)}>
      <div className={"area-tile cat-bg-" + area.color}>{catIcon(area.icon)}</div>
      <div className="area-stack">
        <div className="area-name">{area.name}</div>
        {/* Each count is its own fact, so the dot between them is drawn by
            .facts and never sits in the string. The counts are the row's
            subtext: 14px, regular, the one grey, under a title that is bold
            (Dave 2026-10-05, the round-2 review: the counts were bold and
            near-white, as loud as the area's name, so the title and its line
            differed only by size). A count with no state of its own is not
            emphasis; the area leads.
            The line's job is to show every count, so it is the wrapping,
            unclamped meta line, not the one-line .facts (2026-09-26): there,
            "2 Projects" was cut to "2 ..." at type scale 1.4. */}
        {stats.length > 0 && (
          <div className="conn-meta">
            {stats.map((s) => <span className="fact" key={s}>{s}</span>)}
          </div>
        )}
        {health && <div className="area-sections">Track · Train · Reports · Meds · Privacy</div>}
      </div>
      <div className="area-chev"><div className="chev" /></div>
    </div>
  );
}
