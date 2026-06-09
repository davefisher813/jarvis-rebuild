import { useCallback, useEffect, useState } from "react";
import { useAreas, useGoals } from "../data/NotesProvider";
import type { Area, Goal, AreaData, GoalData } from "./types";
import LifeMapPage from "./LifeMapPage";
import AreaSheet from "./AreaSheet";
import GoalSheet from "./GoalSheet";
import AreaDetailPage from "./AreaDetailPage";

type Sheet =
  | { kind: "closed" }
  | { kind: "area-new" } | { kind: "area-edit"; id: string }
  | { kind: "goal-new" } | { kind: "goal-edit"; id: string };

export default function LifeMapFlow() {
  const areasSvc = useAreas();
  const goalsSvc = useGoals();
  const [areas, setAreas] = useState<Area[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sheet, setSheet] = useState<Sheet>({ kind: "closed" });
  const [detailId, setDetailId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [a, g] = await Promise.all([areasSvc.list(), goalsSvc.list()]);
    setAreas(a); setGoals(g);
  }, [areasSvc, goalsSvc]);
  useEffect(() => { void reload(); }, [reload]);

  const editingArea = sheet.kind === "area-edit" ? areas.find((a) => a.id === sheet.id) : undefined;
  const editingGoal = sheet.kind === "goal-edit" ? goals.find((g) => g.id === sheet.id) : undefined;

  const saveArea = async (d: AreaData) => {
    if (sheet.kind === "area-new") await areasSvc.create(d);
    else if (sheet.kind === "area-edit") await areasSvc.update(sheet.id, d);
    setSheet({ kind: "closed" }); await reload();
  };
  const saveGoal = async (d: GoalData) => {
    if (sheet.kind === "goal-new") await goalsSvc.create(d);
    else if (sheet.kind === "goal-edit") await goalsSvc.update(sheet.id, d);
    setSheet({ kind: "closed" }); await reload();
  };

  const detailArea = detailId ? areas.find((a) => a.id === detailId) : undefined;
  if (detailId && !detailArea && areas.length) setDetailId(null);
  if (detailArea) {
    return (
      <>
        <AreaDetailPage area={detailArea} goals={goals}
          onBack={() => setDetailId(null)}
          onEdit={() => setSheet({ kind: "area-edit", id: detailArea.id })}
          onOpenGoal={(id) => setSheet({ kind: "goal-edit", id })}
          onAddGoal={() => setSheet({ kind: "goal-new" })} />
        {(sheet.kind === "area-edit") && (
          <AreaSheet mode="edit" initial={editingArea?.data} onSave={saveArea}
            onDelete={async () => { await areasSvc.remove(sheet.id); setSheet({ kind: "closed" }); setDetailId(null); await reload(); }}
            onCancel={() => setSheet({ kind: "closed" })} />
        )}
        {(sheet.kind === "goal-new" || sheet.kind === "goal-edit") && (
          <GoalSheet mode={sheet.kind === "goal-new" ? "new" : "edit"} areas={areas} initial={editingGoal?.data} onSave={saveGoal}
            onDelete={sheet.kind === "goal-edit" ? async () => { await goalsSvc.remove(sheet.id); setSheet({ kind: "closed" }); await reload(); } : undefined}
            onCancel={() => setSheet({ kind: "closed" })} />
        )}
      </>
    );
  }


  return (
    <>
      <LifeMapPage
        areas={areas}
        goals={goals}
        onAddArea={() => setSheet({ kind: "area-new" })}
        onAddGoal={() => setSheet({ kind: "goal-new" })}
        onOpenArea={(id) => setDetailId(id)}
        onOpenGoal={(id) => setSheet({ kind: "goal-edit", id })}
      />
      {(sheet.kind === "area-new" || sheet.kind === "area-edit") && (
        <AreaSheet
          mode={sheet.kind === "area-new" ? "new" : "edit"}
          initial={editingArea?.data}
          onSave={saveArea}
          onDelete={sheet.kind === "area-edit" ? async () => { await areasSvc.remove(sheet.id); setSheet({ kind: "closed" }); await reload(); } : undefined}
          onCancel={() => setSheet({ kind: "closed" })}
        />
      )}
      {(sheet.kind === "goal-new" || sheet.kind === "goal-edit") && (
        <GoalSheet
          mode={sheet.kind === "goal-new" ? "new" : "edit"}
          areas={areas}
          initial={editingGoal?.data}
          onSave={saveGoal}
          onDelete={sheet.kind === "goal-edit" ? async () => { await goalsSvc.remove(sheet.id); setSheet({ kind: "closed" }); await reload(); } : undefined}
          onCancel={() => setSheet({ kind: "closed" })}
        />
      )}
    </>
  );
}
