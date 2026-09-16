import { catIcon } from "../../categories/icons";
import type { ColorSlot } from "../../categories/types";
import { Nums } from "../../bigger/GoalRowRuled";
import { pressable } from "../../shared/pressable";

// AREAS TAB (2026-09-16, LIFE_AREAS_TAB_HANDOFF). CORRECTED AGAIN (Dave,
// 2026-09-16, showing the old Brain "Your Areas" screenshot: "it originally
// looked like this and still should for the most part"). The first pass
// read J3 ("cards and glyph tiles are retired from lists") as covering
// .lib-disc and rebuilt the row on GoalRowRuled's plain gm-slot -- wrong:
// a category's glyph is locked to the colour disc wherever it appears
// (catalog "a category becomes a color disc with a white glyph -- .lib-disc",
// and G4's "a category is a coloured dot plus plain text, never coloured
// text"). gm-slot is GoalRowRuled's own target-icon language, not a
// category's. The row anatomy that survives from Brain is .lib-row / lib-ico
// lib-disc / lib-stack (lib-name + lib-sub), the exact shape Templates.tsx
// already uses for a name plus a quiet second line. "For the most part"
// is the one real change: Brain's row was name-only, this one adds the
// task/goal/project counts the handoff asked for, as the lib-sub line.
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
    <div className="lib-row" {...pressable(onOpen)}>
      <div className={"lib-ico lib-disc cat-bg-" + area.color}>{catIcon(area.icon)}</div>
      <div className="lib-stack">
        <div className="lib-name">{area.name}</div>
        {stats.length > 0 && <div className="lib-sub"><Nums text={stats.join(" · ")} /></div>}
      </div>
      <div className="chev" />
    </div>
  );
}
