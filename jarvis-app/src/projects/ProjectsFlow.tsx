import { useCallback, useEffect, useState } from "react";
import { useProjects, useCategories, useNotes } from "../data/NotesProvider";
import type { Project, ProjectData } from "./types";
import type { Category } from "../categories/types";
import ProjectsPage from "./ProjectsPage";
import ProjectSheet from "./ProjectSheet";
import ProjectDetailPage from "./ProjectDetailPage";
import { usePushDepth } from "../shared/pushNav";

type Sheet = { kind: "closed" } | { kind: "new" } | { kind: "edit"; id: string };

export default function ProjectsFlow({ openId, onOpenNote }: { openId?: string; onOpenNote?: (id: string) => void } = {}) {
  const svc = useProjects();
  const catsSvc = useCategories();
  const notesSvc = useNotes();
  const [projects, setProjects] = useState<Project[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sheet, setSheet] = useState<Sheet>({ kind: "closed" });
  const [detailId, setDetailId] = useState<string | null>(openId ?? null);
  const [linkedNotes, setLinkedNotes] = useState<{ id: string; title: string; category: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [p, c] = await Promise.all([svc.list(), catsSvc.list()]);
    setProjects(p); setCategories(c); setLoading(false);
  }, [svc, catsSvc]);
  useEffect(() => { void reload(); }, [reload]);

  // When a project detail is open, fetch the notes that link to it.
  useEffect(() => {
    if (!detailId) { setLinkedNotes([]); return; }
    let on = true;
    notesSvc.notesLinkedTo(detailId).then((n) => { if (on) setLinkedNotes(n); });
    return () => { on = false; };
  }, [detailId, notesSvc]);

  const editing = sheet.kind === "edit" ? projects.find((p) => p.id === sheet.id) : undefined;
  const save = async (d: ProjectData) => {
    if (sheet.kind === "new") await svc.create(d);
    else if (sheet.kind === "edit") await svc.update(sheet.id, d);
    setSheet({ kind: "closed" }); await reload();
  };

  const detail = detailId ? projects.find((p) => p.id === detailId) : undefined;
  if (detailId && !detail && projects.length) setDetailId(null);
  const pushCls = usePushDepth(detail ? 1 : 0);
  if (detail) {
    return (
      <div className={pushCls} key={"d-" + detail.id}>
        <ProjectDetailPage project={detail} onBack={() => setDetailId(null)} onEdit={() => setSheet({ kind: "edit", id: detail.id })} linkedNotes={linkedNotes} onOpenNote={onOpenNote} />
        {sheet.kind === "edit" && (
          <ProjectSheet mode="edit" categories={categories} initial={editing?.data} onSave={save}
            onDelete={async () => { await svc.remove(sheet.id); setSheet({ kind: "closed" }); setDetailId(null); await reload(); }}
            onCancel={() => setSheet({ kind: "closed" })} />
        )}
      </div>
    );
  }

  return (
    <div className={pushCls} key="base">
      <ProjectsPage projects={projects} loading={loading} onAdd={() => setSheet({ kind: "new" })} onOpen={(id) => setDetailId(id)} />
      {sheet.kind !== "closed" && (
        <ProjectSheet
          mode={sheet.kind === "new" ? "new" : "edit"}
          categories={categories}
          initial={editing?.data}
          onSave={save}
          onDelete={sheet.kind === "edit" ? async () => { await svc.remove(sheet.id); setSheet({ kind: "closed" }); await reload(); } : undefined}
          onCancel={() => setSheet({ kind: "closed" })}
        />
      )}
    </div>
  );
}
