import { useCallback, useEffect, useState } from "react";
import { pressable } from "../../shared/pressable";
import { useOptionalBrainMemory } from "../../data/NotesProvider";
import { useFreshLists } from "../../data/useFreshLists";
import { BRAIN_MEMORY_ENTITY, type BrainMemoryCategory, type BrainMemoryRow } from "../../ai/brainMemory";
import MemorySheet from "./MemorySheet";

// DecisionsFlow's fmtDay, kept here so the Decisions page can host these rows
// without an import cycle.
const fmtDay = (iso: string) =>
  new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("en-US", { month: "long", day: "numeric" });

/**
 * Brain Manual v1: the rows filed through the in-flow buttons (note "File
 * As…", "Log the Decision", "Save My Voice", the + menu), shown INSIDE the
 * Brain page they belong to (Dave 2026-09-28). The hub rows keep their own
 * pages so nothing already saved goes invisible and no screen looks new:
 * with nothing filed this renders nothing at all, and a filed row wears the
 * host page's own ruled row. A row opens the memory detail (Edit / Forget).
 */
export default function FiledRows({ categories, rowClass = "row", onCount }: {
  categories: BrainMemoryCategory[];
  // How many filed rows are showing, so a host whose own list is empty can
  // stand its empty state down while filed rows fill the page.
  onCount?: (n: number) => void;
  // The host page's row class, so a filed row is the page's own row.
  rowClass?: string;
}) {
  const svc = useOptionalBrainMemory();
  const [rows, setRows] = useState<BrainMemoryRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const key = categories.join(",");

  const reload = useCallback(async () => {
    if (!svc) return;
    try {
      const all = await svc.list();
      const want = key.split(",");
      // Archived decisions stay in the trail, not on the page.
      setRows(all.filter((r) => want.includes(r.data.category) && r.data.status !== "archived"));
    } catch { /* a failed read leaves the host page exactly as it was */ }
  }, [svc, key]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { onCount?.(rows.length); }, [rows.length, onCount]);
  useFreshLists([BRAIN_MEMORY_ENTITY], reload);

  if (!svc || rows.length === 0) return null;
  const open = rows.find((r) => r.id === openId) ?? null;
  return (
    <>
      <div className="sh2 sh2-quiet"><span className="t">Filed</span></div>
      <div className="pad-x"><div className="card list-card-ruled">
        {rows.map((r) => (
          <div {...pressable(() => setOpenId(r.id))} className={rowClass} key={r.id}>
            <div className="row-grow">
              <div className="conn-name">{r.data.text}</div>
              {r.data.why && <div className="conn-meta">{"Because " + r.data.why}</div>}
              {r.data.date && <div className="facts"><span className="fact date">{fmtDay(r.data.date)}</span></div>}
            </div>
            <div className="chev" />
          </div>
        ))}
      </div></div>
      {open && <MemorySheet row={open} onClose={() => setOpenId(null)} onChanged={() => void reload()} />}
    </>
  );
}
