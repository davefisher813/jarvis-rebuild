import { useState } from "react";
import RowActionSheet, { type RowAction } from "./RowActionSheet";
import { MoreHorizontal } from "./icons";

// THE HEAD'S OVERFLOW (Dave 2026-10-05, locked: section-level actions live in the section head, and a head that is
// calm holds ONE or TWO capsules). When a section has more actions than that, the rest sit behind this one round
// button at the head's right, opening the same RowActionSheet every row menu uses. It is a capsule-shaped icon, never
// a row of four pills that wraps onto a second line.
export default function HeadMore({ actions, label = "More Actions" }: { actions: RowAction[]; label?: string }) {
  const [open, setOpen] = useState(false);
  if (actions.length === 0) return null;
  return (
    <>
      <button type="button" className="see-all pill-action head-more" aria-label={label} onClick={() => setOpen(true)}>
        <MoreHorizontal className="ic" />
      </button>
      {open && <RowActionSheet title={label} actions={actions} onCancel={() => setOpen(false)} />}
    </>
  );
}
