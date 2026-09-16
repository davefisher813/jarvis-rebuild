import { catIcon } from "../../categories/icons";
import type { ColorSlot } from "../../categories/types";
import { pressable } from "../../shared/pressable";

// AREAS TAB (2026-09-16, LIFE_AREAS_TAB_HANDOFF): one row per area, the same
// disc-glyph-plus-name anatomy the Brain hub's nav rows used to wear, now
// with what the area actually holds instead of a bare chevron. Stats ride as
// quiet chips (not colored facts: three would break the "one colored fact
// per sub" law), one per count that isn't zero, so an area with nothing
// filed reads as a plain name rather than "0 tasks · 0 goals · 0 projects".
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
    <div {...pressable(onOpen)} className="row area-row">
      <div className={"lib-ico lib-disc cat-bg-" + area.color}>{catIcon(area.icon)}</div>
      <div className="row-grow">
        <div className="conn-name">{area.name}</div>
        {stats.length > 0 && (
          <div className="area-stats">
            {stats.map((s) => <span className="chip" key={s}>{s}</span>)}
          </div>
        )}
      </div>
      <div className="chev" />
    </div>
  );
}
