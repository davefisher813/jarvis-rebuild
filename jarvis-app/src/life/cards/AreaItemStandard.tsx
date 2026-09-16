import { catIcon } from "../../categories/icons";
import type { ColorSlot } from "../../categories/types";
import { Nums } from "../../bigger/GoalRowRuled";

// AREAS TAB (2026-09-16, LIFE_AREAS_TAB_HANDOFF) -- CORRECTED to the row
// anatomy the rest of Life already wears (Dave, on the first pass: "needs a
// complete visual overhaul and you need to follow the design catalog"). An
// area row is not a Brain nav row (that was the mistake: .lib-row/.lib-disc
// is the NAV LIST language, and cards/glyph-tiles are retired from lists,
// catalog J3). It is a CONTENT row, so it wears exactly what GoalRowRuled
// and ProjectRowRuled already do: the 24px gm-slot glyph in the area's own
// colour, the name, and one quiet r-k fact line -- never a chip, which the
// catalog reserves for choosers and filters (G3), not inert counts.
export interface AreaCounts { taskCount: number; goalCount: number; projectCount: number }
export interface AreaSummary { id: string; name: string; color: ColorSlot; icon?: string }

function statLine(n: number, singular: string, plural: string): string | null {
  if (n <= 0) return null;
  return `${n} ${n === 1 ? singular : plural}`;
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
    <div className="task-row p2 area-row-ruled" role="button" tabIndex={0} onClick={onOpen}>
      <div className="task-check-tap"><span className={"gm-slot cat-fg-" + area.color}>{catIcon(area.icon)}</span></div>
      <div className="task-title">
        <span className="task-name">{area.name}</span>
        {stats.length > 0 && (
          <div className="r-k">
            <span className="r-goal"><Nums text={stats.join(" · ")} /></span>
          </div>
        )}
      </div>
      <div className="chev" />
    </div>
  );
}
