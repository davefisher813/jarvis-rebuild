import { useCallback, useEffect, useState } from "react";
import { useCategories } from "../data/NotesProvider";
import type { Category } from "./types";
import CategoriesPage from "./screens/CategoriesPage";
import CategorySheet, { type CategoryDraft } from "./screens/CategorySheet";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";

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

  // B10 (2026-08-24): guarded and announced, deliberately WITHOUT an Undo.
  // Deleting a category orphans every task, note and project tagged with it,
  // and a recreated category gets a new id, so an Undo here would restore
  // the name and none of the links. The two-tap arming in the sheet is the
  // real protection; this adds the missing guard (a failed delete used to
  // close the sheet silently, which reads as success) and the receipt.
  const onDelete = async () => {
    if (sheet.kind !== "edit") return;
    const name = list.find((c) => c.id === sheet.id)?.data.name;
    const ok = await attemptWrite(() => categories.remove(sheet.id));
    if (!ok) return;
    setSheet({ kind: "closed" });
    await reload();
    showToast({ message: name ? name + " deleted" : "Area deleted" });
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
