import { catIcon } from "../../categories/icons";
import type { ColorSlot } from "../../categories/types";
import { pressable } from "../../shared/pressable";
import { capAfterNumber } from "../../shared/casing";

// AREAS TAB (2026-09-16). Restyled to Dave's reference the same day (his
// screenshot of the ChatGPT mock: "I love the new style for the life areas
// page"): every area is its own card, led by a flat colour tile wearing the
// category's glyph in white (the tile is flat on purpose: "eliminate the
// shading on the icons"), the name over its counts, a chevron at the right.
// The whole card is the door. A departure from J3's "no glyph tiles in
// lists", stated in the commit: Dave asked for this shape by name.
export interface AreaCounts { taskCount: number; goalCount: number; projectCount: number }
export interface AreaSummary { id: string; name: string; color: ColorSlot; icon?: string }

// Cased the way the Health card beside it says "5 Sections" (capAfterNumber).
function statLine(n: number, singular: string, plural: string): string | null {
  if (n <= 0) return null;
  return capAfterNumber(`${n} ${n === 1 ? singular : plural}`);
}

export default function AreaItemStandard({ area, counts, onOpen }: {
  area: AreaSummary;
  counts: AreaCounts;
  onOpen: () => void;
}) {
  const stats = [
    statLine(counts.taskCount, "task", "tasks"),
    statLine(counts.goalCount, "goal", "goals"),
    statLine(counts.projectCount, "project", "projects"),
  ].filter((s): s is string => s !== null);

  return (
    <div className="card area-card" {...pressable(onOpen)}>
      <div className={"area-tile cat-bg-" + area.color}>{catIcon(area.icon)}</div>
      <div className="area-stack">
        <div className="area-name">{area.name}</div>
        {/* Each count is its own fact, so the dot between them is drawn by
            .facts and never sits in the string. A count with no state is a
            white number (§AM), the whole count, so the line spends no grey. */}
        {stats.length > 0 && (
          <div className="facts">
            {stats.map((s) => <span className="fact" key={s}><b>{s}</b></span>)}
          </div>
        )}
      </div>
      <div className="area-chev"><div className="chev" /></div>
    </div>
  );
}
