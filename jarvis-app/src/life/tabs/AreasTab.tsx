import { useCallback, useEffect, useState } from "react";
import { useCategories, useTasks, useProjects, useGoals } from "../../data/NotesProvider";
import { isIn } from "../../tasks/categories";
import { buildGoalIndex, liveGoals } from "../../bigger/reach";
import { effectiveKind } from "../../categories/kinds";
import type { CategoryKind } from "../../categories/types";
import PageHeader from "../../shared/PageHeader";
import CategorySheet, { type CategoryDraft } from "../../categories/screens/CategorySheet";
import { attemptWrite } from "../../shared/guard";
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
// the ordered list and rendered first, because the approved visual leads
// with it. It is drawn as every other area is (Dave 2026-10-05: the five
// section capsules it carried inside its card are gone, no pills in a card).
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
  const [adding, setAdding] = useState(false);

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

  // THE ADD IS THE HEAD'S (Dave 2026-10-05, locked: a section-level action lives in the section head; the perfect bar:
  // the Areas head held a bare count and the page offered no way to make an area). The same create the Areas page in
  // Settings does, so an area made here is an area made there.
  const addArea = async (draft: CategoryDraft): Promise<boolean> => {
    const ok = await attemptWrite(async () => {
      const id = await catsSvc.create(draft.name, draft.color, draft.icon);
      if (id && (draft.kind !== "plain" || draft.season || draft.workHours)) {
        await catsSvc.update(id, { kind: draft.kind, season: draft.season, workHours: draft.workHours });
      }
    });
    if (!ok) return false;
    setAdding(false);
    await reload();
    return true;
  };

  return (
    <div className="screen ruled">
      <PageHeader title="Life" />
      {segments}
      {loaded && <div className="sh2 sh2-quiet"><span className="t">Areas</span><button className="see-all pill-action" onClick={() => setAdding(true)}>Add Area</button></div>}
      {loaded && total > 0 && (
        <>
          <div className="pad-x area-cards">
            {health && <AreaItemStandard area={health} counts={health.counts} onOpen={() => onOpenCategory(health.id)} health />}
            {areas.map((a) => (
              <AreaItemStandard key={a.id} area={a} counts={a.counts} onOpen={() => onOpenCategory(a.id)} />
            ))}
          </div>
        </>
      )}
      {loaded && total === 0 && (
        <div className="pad-x"><div className="empty-state">
          <div className="empty-title">No Areas Yet</div>
          <div className="empty-sub">Add One in Settings &gt; Categories</div>
        </div></div>
      )}
      <div className="screen-foot" />
      {adding && <CategorySheet mode="new" onSave={addArea} onCancel={() => setAdding(false)} />}
    </div>
  );
}
