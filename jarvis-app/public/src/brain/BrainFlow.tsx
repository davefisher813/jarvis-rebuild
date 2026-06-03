import { useEffect, useState } from "react";
import BrainPage, { type BrainCategory } from "./BrainPage";
import { useCategories } from "../data/NotesProvider";
import PeopleFlow from "../people/PeopleFlow";
import type { PersonGroup } from "../people/types";
import BrainDocPage from "./docs/BrainDocPage";
import CategoryDetail from "./CategoryDetail";
import type { ColorSlot } from "../categories/types";

const PEOPLE_GROUP: Record<string, PersonGroup> = {
  contacts: "contacts",
  "inner-circle": "inner_circle",
  adversarial: "adversarial",
};
const DOC_TOPIC: Record<string, string> = {
  philosophy: "philosophy",
  writing: "writing",
  values: "values",
};

// The Brain tab. The hub is built. The people rows (Contacts / Inner Circle /
// Adversarial) open real, editable people lists; the remaining rows open a
// lightweight placeholder for now. "Your Categories" is populated live.
export default function BrainFlow() {
  const cats = useCategories();
  const [categories, setCategories] = useState<BrainCategory[]>([]);
  const [open, setOpen] = useState<{ key: string; name: string } | null>(null);

  useEffect(() => {
    let on = true;
    cats.list().then((list) => {
      if (on)
        setCategories(
          list.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color, icon: c.data.icon })),
        );
    });
    return () => {
      on = false;
    };
  }, [cats]);

  if (open) {
    const group = PEOPLE_GROUP[open.key];
    if (group) {
      return <PeopleFlow group={group} onBack={() => setOpen(null)} />;
    }
    const topic = DOC_TOPIC[open.key];
    if (topic) {
      return <BrainDocPage topic={topic} onBack={() => setOpen(null)} />;
    }
    const cat = categories.find((c) => c.id === open.key);
    if (cat) {
      return <CategoryDetail categoryId={cat.id} name={cat.name} color={cat.color as ColorSlot} onBack={() => setOpen(null)} />;
    }
    return (
      <div className="screen">
        <div className="nav-bar">
          <button className="nav-back" onClick={() => setOpen(null)} aria-label="Back">
            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <span></span>
        </div>
        <div className="nav-large">{open.name}</div>
        <div className="empty-state">This area is coming soon.</div>
      </div>
    );
  }

  return <BrainPage onOpen={(key, name) => setOpen({ key, name })} categories={categories} />;
}
