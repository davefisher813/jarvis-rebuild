import type { Category } from "../types";
import { catIcon } from "../icons";
import LargeTitleNav from "../../shared/LargeTitleNav";
import ReorderList from "../../shared/ReorderList";

const BACK = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
);
const CHEV = (
  <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
);
const PLUS = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
);

export default function CategoriesPage({
  categories,
  onEdit,
  onAdd,
  onBack,
  onReorder,
}: {
  categories: Category[];
  onEdit: (id: string) => void;
  onAdd: () => void;
  onBack: () => void;
  // Drag to reorder. This order is the order everywhere the categories are
  // listed, so the one the user cares about can sit at the top.
  onReorder?: (ids: string[]) => void;
}) {
  const byId = (id: string) => categories.find((c) => c.id === id)!;
  return (
    <div className="screen">
      <LargeTitleNav title="Categories" back="Settings" onBack={onBack} />
      <div className="pad-x">
        {onReorder && categories.length > 1 ? (
          <ReorderList
            ids={categories.map((c) => c.id)}
            onReorder={onReorder}
            renderRow={(id) => {
              const c = byId(id);
              return (
                <>
                  <div className={"sec-ico cat-bg-" + c.data.color}>{catIcon(c.data.icon)}</div>
                  <div className="row-grow" role="button" tabIndex={0} onClick={() => onEdit(c.id)}>
                    <div className="conn-name">{c.data.name}</div>
                  </div>
                </>
              );
            }}
          />
        ) : (
        <div className="card">
          {categories.map((c) => (
            <div className="row" role="button" tabIndex={0} key={c.id} onClick={() => onEdit(c.id)}>
              <div className={"sec-ico cat-bg-" + c.data.color}>{catIcon(c.data.icon)}</div>
              <div className="row-grow"><div className="conn-name">{c.data.name}</div></div>
              {CHEV}
            </div>
          ))}
        </div>
        )}
        <div className="card conn-action">
          <button className="row row-act" onClick={onAdd}>Add Category</button>
        </div>
      </div>
    </div>
  );
}
