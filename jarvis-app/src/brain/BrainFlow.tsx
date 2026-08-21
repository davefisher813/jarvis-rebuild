import { useCallback, useEffect, useState } from "react";
import BrainPage, { type BrainCategory } from "./BrainPage";
import { useCategories } from "../data/NotesProvider";
import PeopleFlow from "../people/PeopleFlow";
import BrainDocPage from "./docs/BrainDocPage";
import CategoryDetail from "./CategoryDetail";
import RoutineFlow from "../routine/RoutineFlow";
import DecisionsFlow from "../decisions/DecisionsFlow";
import { usePushDepth } from "../shared/pushNav";
import { effectiveKind } from "../categories/kinds";

const DOC_TOPIC: Record<string, string> = {
  philosophy: "philosophy",
  writing: "writing",
  values: "values",
};

// The Brain tab. The hub is built. Contacts opens the one people list (the
// Inner Circle / Adversarial rows were cut 2026-08-03); the doc rows open a
// lightweight placeholder for now. "Your Categories" is populated live.
export default function BrainFlow({ openKey, personOpenId, decisionOpenId, onOpenNote, onOpenProject, onOpenMoney, onOpenEntity }: { openKey?: string; personOpenId?: string; decisionOpenId?: string; onOpenNote?: (id: string) => void; onOpenProject?: (id: string) => void; onOpenMoney?: () => void; onOpenEntity?: (kind: string, id: string) => void } = {}) {
  const cats = useCategories();
  const [categories, setCategories] = useState<BrainCategory[]>([]);
  const [open, setOpen] = useState<{ key: string; name: string } | null>(
    openKey ? { key: openKey, name: "" } : null,
  );

  const loadCats = useCallback(async () => {
    const list = await cats.list();
    setCategories(list.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color, icon: c.data.icon, kind: effectiveKind(c.data) })));
  }, [cats]);
  useEffect(() => { void loadCats(); }, [loadCats]);

  // A person tapped on a people-kind category page (2026-08-10) opens through
  // Contacts, the one people surface. Cleared when Contacts closes so a later
  // manual visit does not jump back to them.
  const [personId, setPersonId] = useState<string | undefined>(undefined);

  // The app had two "Money"s (2026-08-10, Dave: "there should only be one
  // money category with all of its features"): this category, which opened a
  // generic skeleton page with no financial data on it, and the real Money
  // tab (accounts, bills, budget). Whichever way a money category is opened
  // here, click or a search deep-link, it now lands on the one real Money
  // feature instead of the dead end. The category itself still exists (it's
  // still a legitimate task/note tag and still groups under "Money" in the
  // list above); tapping it just goes somewhere real now.
  useEffect(() => {
    if (!open || !onOpenMoney) return;
    const cat = categories.find((c) => c.id === open.key);
    if (cat && cat.kind === "money") {
      onOpenMoney();
      setOpen(null);
    }
  }, [open, categories, onOpenMoney]);

  const pushCls = usePushDepth(open ? 1 : 0);

  const detail = (() => {
    if (!open) return null;
    if (open.key === "routine") {
      return <RoutineFlow onBack={() => setOpen(null)} />;
    }
    if (open.key === "decisions") {
      return <DecisionsFlow openId={decisionOpenId} onBack={() => setOpen(null)} />;
    }
    if (open.key === "contacts") {
      return <PeopleFlow openId={personOpenId ?? personId} onOpenNote={onOpenNote} onOpenItem={onOpenEntity} onBack={() => { setPersonId(undefined); setOpen(null); }} />;
    }
    const topic = DOC_TOPIC[open.key];
    if (topic) {
      return <BrainDocPage topic={topic} onBack={() => setOpen(null)} />;
    }
    const cat = categories.find((c) => c.id === open.key);
    if (cat) {
      // The page loads its own live record (name/colour/kind survive edits);
      // onChanged keeps this hub's list fresh after a rename or delete.
      return (
        <CategoryDetail
          categoryId={cat.id}
          onBack={() => setOpen(null)}
          onOpenNote={onOpenNote}
          onOpenProject={onOpenProject}
          onOpenPerson={(id) => { setPersonId(id); setOpen({ key: "contacts", name: "Contacts" }); }}
          onOpenContacts={() => { setPersonId(undefined); setOpen({ key: "contacts", name: "Contacts" }); }}
          onOpenTask={onOpenEntity ? (id) => onOpenEntity("task", id) : undefined}
          onChanged={() => void loadCats()}
        />
      );
    }
    return (
      <div className="screen">
        <div className="nav-bar">
          <button className="nav-back" onClick={() => setOpen(null)} aria-label="Back">          </button>
          <span></span>
        </div>
        <div className="nav-large">{open.name}</div>
        <div className="empty-state">This area is coming soon.</div>
      </div>
    );
  })();

  if (detail) return <div className={pushCls} key={"d-" + open!.key}>{detail}</div>;
  return <div className={pushCls} key="base"><BrainPage onOpen={(key, name) => setOpen({ key, name })} categories={categories} /></div>;
}
