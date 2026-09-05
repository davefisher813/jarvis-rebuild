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

  // SHELL-F-11 (2026-09-05): onDelete below has been guarded since B10; this
  // one never was. A failed create or edit threw inside the sheet's promise,
  // the sheet stayed open reading "Saving" with no toast, and every further
  // Save tap was ignored. Same guard, same toast, and the false travels back
  // to the sheet so the button unlatches and the typed name is still there.
  const onSave = async (draft: CategoryDraft): Promise<boolean> => {
    const ok = await attemptWrite(async () => {
      if (sheet.kind === "new") {
        const id = await categories.create(draft.name, draft.color, draft.icon);
        if (id && (draft.kind !== "plain" || draft.season || draft.workHours)) {
          await categories.update(id, { kind: draft.kind, season: draft.season, workHours: draft.workHours });
        }
      } else if (sheet.kind === "edit") {
        await categories.update(sheet.id, { name: draft.name, color: draft.color, icon: draft.icon, kind: draft.kind, season: draft.season, workHours: draft.workHours });
      }
    });
    if (!ok) return false;
    setSheet({ kind: "closed" });
    await reload();
    return true;
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
        // SHELL-F-11: a reorder that fails used to leave the dragged order on
        // screen until the next visit. Guarded, and the false sends the list
        // back to the order that is actually stored.
        onReorder={async (ids) => {
          const ok = await attemptWrite(() => categories.reorder(ids));
          await reload();
          return ok;
        }}
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
