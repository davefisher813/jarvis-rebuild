import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useOptionalBrainMemory } from "../data/NotesProvider";
import { categoryLabel, type BrainMemoryCategory } from "./brainMemory";

// NOTE "FILE AS…" (Brain Manual v1, 2026-09-27).
//
// The one-tap filing door on the note screen's More menu: no form, the
// content already exists. If text is selected the selection is filed,
// otherwise the whole note (the caller snapshots the text; this sheet only
// picks the category).
//
// The sheet is RowActionSheet's atoms (.sheet-scrim, .card, .grp/.eyebrow,
// .action-sheet, .cancel) with one addition the flow-doc requires: when
// filing Philosophy or Value, the existing items in that category are
// listed above the buttons ("You already have: …") so the user spots a
// duplicate or contradiction themselves. No model call, no second screen.

const CATEGORIES: { key: BrainMemoryCategory; label: string }[] = [
  { key: "philosophy", label: "Philosophy" },
  { key: "value", label: "Value" },
  { key: "fact", label: "Remember This" },
];

function truncate(text: string, n = 90): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

export default function FileAsSheet({
  onPick,
  onClose,
}: {
  onPick: (category: BrainMemoryCategory) => void;
  onClose: () => void;
}) {
  const brain = useOptionalBrainMemory();
  const [existing, setExisting] = useState<Record<"philosophy" | "value", string[]>>({ philosophy: [], value: [] });

  useEffect(() => {
    if (!brain) return;
    let live = true;
    void (async () => {
      const [phil, val] = await Promise.all([brain.listByCategory("philosophy"), brain.listByCategory("value")]);
      if (live) setExisting({ philosophy: phil.map((r) => r.data.text), value: val.map((r) => r.data.text) });
    })();
    return () => { live = false; };
  }, [brain]);

  const guardLines = (["philosophy", "value"] as const)
    .filter((c) => existing[c].length > 0)
    .map((c) => `${categoryLabel(c)} so far: ${truncate(existing[c][0]!)}${existing[c].length > 1 ? ` (+${existing[c].length - 1} more)` : ""}`);

  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="grp"><div className="eyebrow">File As…</div></div>
        {guardLines.length > 0 && (
          <div className="pad-x">
            {guardLines.map((line) => (
              <div className="conn-meta" key={line}>{line}</div>
            ))}
          </div>
        )}
        <div className="action-sheet">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => { onClose(); onPick(c.key); }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="action-sheet">
          <button className="cancel" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
