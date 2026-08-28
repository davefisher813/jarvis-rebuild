import { useCallback, useEffect, useState } from "react";
import BrainPage, { type BrainCategory } from "./BrainPage";
import { useCategories } from "../data/NotesProvider";
import PeopleFlow from "../people/PeopleFlow";
import BrainDocPage from "./docs/BrainDocPage";
import CategoryDetail from "./CategoryDetail";
import RoutineFlow from "../routine/RoutineFlow";
import DecisionsFlow from "../decisions/DecisionsFlow";
import InsightsFlow from "../review/InsightsFlow";
import StrandsPage from "./strands/StrandsPage";
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
export default function BrainFlow({ openKey, routineBlockId, onRoutineBlockConsumed, personOpenId, decisionOpenId, onOpenNote, onOpenProject, onOpenMoney, onOpenEntity }: { openKey?: string; routineBlockId?: string; onRoutineBlockConsumed?: () => void; personOpenId?: string; decisionOpenId?: string; onOpenNote?: (id: string) => void; onOpenProject?: (id: string) => void; onOpenMoney?: () => void; onOpenEntity?: (kind: string, id: string) => void } = {}) {
  const cats = useCategories();
  const [categories, setCategories] = useState<BrainCategory[]>([]);
  const [open, setOpen] = useState<{ key: string; name: string } | null>(
    openKey ? { key: openKey, name: "" } : null,
  );

  // Whether the category list has ARRIVED, which is not the same question as
  // whether it is empty. Without this the fallback below cannot tell "no such
  // area" from "not loaded yet", and a category opened by deep link would
  // flash a dead end on its way to rendering.
  const [catsLoaded, setCatsLoaded] = useState(false);
  const loadCats = useCallback(async () => {
    const list = await cats.list();
    setCategories(list.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color, icon: c.data.icon, kind: effectiveKind(c.data) })));
    setCatsLoaded(true);
  }, [cats]);
  useEffect(() => { void loadCats(); }, [loadCats]);

  // AN AREA THAT DOES NOT EXIST IS NOT AN AREA (2026-08-26). This used to
  // fall through to a screen reading "This area is coming soon.", which was
  // unreachable in practice (every key BrainPage offers is handled above)
  // but not harmless: it was read as an App Store blocker twice, once by a
  // session doc and once by me, because a grep for placeholder copy finds it
  // and nothing in the file says it is dead. Shipped code that lies about
  // what the app does costs more than the line it saves.
  //
  // A key with nothing behind it now closes back to the hub, which is the
  // only honest thing an unknown area can do.
  useEffect(() => {
    if (!open || !catsLoaded) return;
    const known = open.key in DOC_TOPIC
      || ["knows", "month", "routine", "decisions", "contacts"].includes(open.key)
      || categories.some((c) => c.id === open.key);
    if (!known) setOpen(null);
  }, [open, catsLoaded, categories]);

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
    if (open.key === "knows") {
      return <StrandsPage onBack={() => setOpen(null)} />;
    }
    if (open.key === "month") {
      return <InsightsFlow onBack={() => setOpen(null)} onOpenTask={onOpenEntity ? (id) => onOpenEntity("task", id) : undefined} />;
    }
    if (open.key === "routine") {
      return <RoutineFlow onBack={() => setOpen(null)} focusId={routineBlockId} onFocusConsumed={onRoutineBlockConsumed} />;
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
    // Nothing matched. While the categories are still loading this is simply
    // "not yet", so hold an empty screen for a frame rather than asserting
    // anything; once they have loaded, the effect above has already sent us
    // back to the hub.
    return catsLoaded ? null : <div className="screen" />;
  })();

  if (detail) return <div className={pushCls} key={"d-" + open!.key}>{detail}</div>;
  return <div className={pushCls} key="base"><BrainPage onOpen={(key, name) => setOpen({ key, name })} categories={categories} /></div>;
}
