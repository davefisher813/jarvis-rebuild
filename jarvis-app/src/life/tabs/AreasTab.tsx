import { useCallback, useEffect, useState } from "react";
import { useCategories, useTasks, useProjects, useGoals } from "../../data/NotesProvider";
import { isIn } from "../../tasks/categories";
import { buildGoalIndex, liveGoals } from "../../bigger/reach";
import { effectiveKind } from "../../categories/kinds";
import type { CategoryKind } from "../../categories/types";
import PageHeader from "../../shared/PageHeader";
import HealthMiniAppCard from "../cards/HealthMiniAppCard";
import AreaItemStandard, { type AreaCounts, type AreaSummary } from "../cards/AreaItemStandard";

// AREAS, FIRST (LIFE_AREAS_TAB_HANDOFF, 2026-09-16, from Dave's Brain
// audit: a fact, a task, a decision all carry an Area, but the one place
// that browsed areas by hand lived buried in the Brain tab, one row among
// eight unrelated nav rows). This is the same category data Brain's "Your
// Areas" read (BrainPage.tsx), moved to where browsing an area actually
// belongs -- Life, as the tab you land on -- and given what an area list
// was missing: what's actually filed in each one, not just its name.
//
// Money-kind categories stay excluded (BrainPage's own rule, 2026-08-10:
// Money is the Money tab, not a second door to it). Health is pulled out of
// the ordered list and rendered first, via its own mini-app card: it is a
// dashboard with subsystems, not a task/goal/project collection, and the
// approved visual leads with it for exactly that reason.
const OTHER_KIND_ORDER: Exclude<CategoryKind, "money" | "health">[] = ["org", "people", "plain"];

interface AreaRow extends AreaSummary { kind: CategoryKind; counts: AreaCounts }

export default function AreasTab({ segments, onOpenCategory }: {
  segments: React.ReactNode;
  onOpenCategory: (id: string) => void;
}) {
  const catsSvc = useCategories();
  const tasksSvc = useTasks();
  const projectsSvc = useProjects();
  const goalsSvc = useGoals();
  const [loaded, setLoaded] = useState(false);
  const [health, setHealth] = useState<AreaRow | null>(null);
  const [areas, setAreas] = useState<AreaRow[]>([]);

  const reload = useCallback(async () => {
    const [cats, tasks, projects, goals] = await Promise.all([
      catsSvc.list(),
      tasksSvc.listTasks(),
      projectsSvc.list(),
      goalsSvc.list(),
    ]);
    // The same reach a category's own detail page counts by (CategoryDetail's
    // Up Next and Goals Here): open tasks that carry this category anywhere,
    // open projects filed to it, and goals that watch it through a tag. A
    // count here that used a different rule than the page it points to is
    // exactly the "numbers disagree on adjacent screens" defect the Brain
    // audit found in Insights; this reuses the same primitives so it can't.
    const goalIdx = buildGoalIndex(projects, liveGoals(goals));
    const countsFor = (categoryId: string): AreaCounts => ({
      taskCount: tasks.filter((t) => !t.data.done && isIn(t.data, categoryId)).length,
      projectCount: projects.filter((p) => p.data.category === categoryId && p.data.status !== "done").length,
      goalCount: goalIdx.byCategory.get(categoryId)?.length ?? 0,
    });

    let healthRow: AreaRow | null = null;
    const rows: AreaRow[] = [];
    for (const c of cats) {
      const kind = effectiveKind(c.data);
      if (kind === "money") continue;
      const row: AreaRow = {
        id: c.id, name: c.data.name, color: c.data.color, icon: c.data.icon,
        kind, counts: countsFor(c.id),
      };
      if (kind === "health" && !healthRow) healthRow = row;
      else rows.push(row);
    }
    rows.sort((a, b) => OTHER_KIND_ORDER.indexOf(a.kind as typeof OTHER_KIND_ORDER[number])
      - OTHER_KIND_ORDER.indexOf(b.kind as typeof OTHER_KIND_ORDER[number]));
    setHealth(healthRow);
    setAreas(rows);
    setLoaded(true);
  }, [catsSvc, tasksSvc, projectsSvc, goalsSvc]);

  useEffect(() => { void reload(); }, [reload]);

  const total = (health ? 1 : 0) + areas.length;

  return (
    <div className="screen ruled">
      <PageHeader title="Life" />
      {segments}
      {loaded && total > 0 && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Areas</span><span className="n">{total}</span></div>
          <div className="pad-x area-cards">
            {health && <HealthMiniAppCard category={health} onOpen={() => onOpenCategory(health.id)} />}
            {areas.map((a) => (
              <AreaItemStandard key={a.id} area={a} counts={a.counts} onOpen={() => onOpenCategory(a.id)} />
            ))}
          </div>
        </>
      )}
      {loaded && total === 0 && (
        <div className="pad-x"><div className="empty-state">
          <div className="empty-title">No Areas Yet</div>
          <div className="empty-sub">Add one in Settings &gt; Categories</div>
        </div></div>
      )}
      <div className="screen-foot" />
    </div>
  );
}
