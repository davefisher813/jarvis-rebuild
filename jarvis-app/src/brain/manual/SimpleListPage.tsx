import { useCallback, useEffect, useState } from "react";
import PageHeader from "../../shared/PageHeader";
import { pressable } from "../../shared/pressable";
import { useBrainMemory } from "../../data/NotesProvider";
import { useFreshLists } from "../../data/useFreshLists";
import {
  BRAIN_MEMORY_ENTITY,
  filedFromLabel,
  type BrainMemoryCategory,
  type BrainMemoryRow,
} from "../../ai/brainMemory";
import MemorySheet from "./MemorySheet";
import FileSheet from "./FileSheet";

export type SimpleTopic = "philosophy" | "writing" | "values";

const TOPIC: Record<SimpleTopic, { title: string; category: BrainMemoryCategory; add: string; emptyTitle: string; emptySub: string }> = {
  philosophy: {
    title: "Life Philosophy",
    category: "philosophy",
    add: "Add a Principle",
    emptyTitle: "No Principles Yet",
    emptySub: "Write One Principle and Every Answer Is Shaped by It",
  },
  values: {
    title: "Values",
    category: "value",
    add: "Add a Value",
    emptyTitle: "No Values Listed",
    emptySub: "Name What Matters and the Brain Advises in Line With It",
  },
  writing: {
    title: "How You Write",
    category: "voice",
    add: "Add a Sample",
    emptyTitle: "No Writing Samples",
    emptySub: "Add 3 Samples and Every Draft Will Sound Like You",
  },
};

/**
 * The slow-changing lists (Brain Manual v1): Life Philosophy, Values, and
 * How You Write, each a straight view over its brain_memory category. How
 * You Write carries the sample count and each sample's source, so it is
 * obvious what the voice is built from.
 */
export default function SimpleListPage({ topic, onBack }: { topic: SimpleTopic; onBack: () => void }) {
  const svc = useBrainMemory();
  const t = TOPIC[topic];
  const [rows, setRows] = useState<BrainMemoryRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const reload = useCallback(async () => {
    setRows(await svc.listByCategory(t.category));
  }, [svc, t.category]);
  useEffect(() => { void reload(); }, [reload]);
  useFreshLists([BRAIN_MEMORY_ENTITY], reload);

  const open = openId ? rows.find((r) => r.id === openId) ?? null : null;

  return (
    <div className="screen ruled">
      <PageHeader title={t.title} back="Brain" onBack={onBack} />

      {rows.length === 0 ? (
        <div className="empty-state empty-compact">
          <div className="empty-title">{t.emptyTitle}</div>
          <div className="empty-sub">{t.emptySub}</div>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>{t.add}</button>
        </div>
      ) : (
        <>
          {topic === "writing" && (
            <div className="sh2 sh2-quiet"><span className="t">Samples</span><span className="n">{rows.length}</span></div>
          )}
          <div className="pad-x"><div className="card list-card-ruled">
            {rows.map((r) => (
              <div {...pressable(() => setOpenId(r.id))} className="lib-row" key={r.id}>
                <div className="row-grow">
                  <div className="conn-name">{r.data.text}</div>
                  {topic === "writing" && (
                    <div className="facts"><span className="fact">Filed From {filedFromLabel(r.data.source)}</span></div>
                  )}
                </div>
              </div>
            ))}
            <button className="row row-act" onClick={() => setAdding(true)}>{t.add}</button>
          </div></div>
        </>
      )}
      <div className="screen-foot" />

      {open && (
        <MemorySheet row={open} onClose={() => setOpenId(null)} onChanged={() => void reload()} />
      )}
      {adding && (
        <FileSheet category={t.category} onClose={() => setAdding(false)} onFiled={() => void reload()} />
      )}
    </div>
  );
}
