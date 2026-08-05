import { useCallback, useEffect, useState } from "react";
import { useCategories } from "../data/NotesProvider";
import type { Category } from "./types";
import CategoriesPage from "./screens/CategoriesPage";
import CategorySheet, { type CategoryDraft } from "./screens/CategorySheet";

type SheetState = { kind: "closed" } | { kind: "new" } | { kind: "edit"; id: string };

export default function CategoriesFlow({ onBack }: { onBack: () => void }) {
  const categories = useCategories();
  const [list, setList] = useState<Category[]>([]);
  const [sheet, setSheet] = useState<SheetState>({ kind: "closed" });

  const reload = useCallback(async () => {
    setList(await categories.list());
  }, [categories]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const editing = sheet.kind === "edit" ? list.find((c) => c.id === sheet.id) : undefined;

  const onSave = async (draft: CategoryDraft) => {
    if (sheet.kind === "new") {
      const id = await categories.create(draft.name, draft.color, draft.icon);
      if (id && (draft.kind !== "plain" || draft.season || draft.workHours)) {
        await categories.update(id, { kind: draft.kind, season: draft.season, workHours: draft.workHours });
      }
    } else if (sheet.kind === "edit") {
      await categories.update(sheet.id, { name: draft.name, color: draft.color, icon: draft.icon, kind: draft.kind, season: draft.season, workHours: draft.workHours });
    }
    setSheet({ kind: "closed" });
    await reload();
  };

  const onDelete = async () => {
    if (sheet.kind !== "edit") return;
    await categories.remove(sheet.id);
    setSheet({ kind: "closed" });
    await reload();
  };

  return (
    <>
      <CategoriesPage
        categories={list}
        onEdit={(id) => setSheet({ kind: "edit", id })}
        onAdd={() => setSheet({ kind: "new" })}
        onBack={onBack}
        onReorder={async (ids) => { await categories.reorder(ids); await reload(); }}
      />
      {sheet.kind !== "closed" && (
        <CategorySheet
          mode={sheet.kind === "new" ? "new" : "edit"}
          initial={
            editing
              ? { name: editing.data.name, color: editing.data.color, icon: editing.data.icon ?? "folder", kind: editing.data.kind, season: editing.data.season, workHours: editing.data.workHours }
              : undefined
          }
          onSave={onSave}
          onDelete={sheet.kind === "edit" ? onDelete : undefined}
          onCancel={() => setSheet({ kind: "closed" })}
        />
      )}
    </>
  );
}
