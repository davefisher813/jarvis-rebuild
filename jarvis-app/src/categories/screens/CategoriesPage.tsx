import type { Category } from "../types";
import { catIcon } from "../icons";
import LargeTitleNav from "../../shared/LargeTitleNav";
import ReorderList from "../../shared/ReorderList";
import { titleCase } from "../../shared/casing";

const BACK = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
);
const CHEV = (
  <div className="chev" />
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
  // listed, so the one the user cares about can sit at the top. Resolving
  // false (SHELL-F-11) sends the rows back: the write did not land.
  onReorder?: (ids: string[]) => void | Promise<boolean | void>;
}) {
  // SHELL-F-01 (2026-09-05): no non-null assertion here. A row asked for by
  // an id this page no longer has (the just-deleted area) renders nothing
  // rather than taking the whole More tab down with it.
  const byId = (id: string) => categories.find((c) => c.id === id);
  return (
    <div className="screen ruled">
      <LargeTitleNav title="Areas" back="Settings" onBack={onBack} />
      {/* THE ADD IS ON THE HEAD (Dave 2026-10-05, locked: a section-level action lives in the section head, never in a card
          or at the foot of a list). The grey card that held only Add Area is gone (rule 12). */}
      <div className="sh2 sh2-quiet">
        <span className="t">Your Areas</span><span className="n set-n">{categories.length}</span>
        <button className="see-all pill-action" onClick={onAdd}>Add Area</button>
      </div>
      <div className="pad-x">
        {onReorder && categories.length > 1 ? (
          <ReorderList
            ids={categories.map((c) => c.id)}
            onReorder={onReorder}
            renderRow={(id) => {
              const c = byId(id);
              if (!c) return null;
              return (
                <>
                  {/* THE TILE LIVES INSIDE THE PRESS WRAPPER (2026-10-05, the review: "jammed against the card's left edge"). A row that
                      holds a .row-press gives it ALL the row's padding (the :has rule at components.css), so a tile outside it sat at
                      0px from the card's rounded border. Inside, it is 20px from the edge and 12px from the name, the same as every
                      other row, and the whole row (tile, name, chevron) is the tap to open Edit Area. */}
                  <div className="row-grow row-press" role="button" tabIndex={0} onClick={() => onEdit(c.id)}>
                    <div className={"sec-ico cat-bg-" + c.data.color}>{catIcon(c.data.icon)}</div>
                    <div className="row-grow"><div className="conn-name">{titleCase(c.data.name)}</div></div>
                    {CHEV}
                  </div>
                </>
              );
            }}
          />
        ) : categories.length > 0 && (
        <div className="card list-card-ruled">
          {categories.map((c) => (
            <div className="row" role="button" tabIndex={0} key={c.id} onClick={() => onEdit(c.id)}>
              <div className={"sec-ico cat-bg-" + c.data.color}>{catIcon(c.data.icon)}</div>
              <div className="row-grow"><div className="conn-name">{titleCase(c.data.name)}</div></div>
              {CHEV}
            </div>
          ))}
        </div>
        )}
      </div>
    </div>
  );
}
