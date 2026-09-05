import { createPortal } from "react-dom";
import { AlignLeft, Heading, List, ListOrdered, ListTodo, Table, Image, Paperclip, Info } from "../../shared/icons";
import type { BlockType } from "../types";
import { pressable } from "../../shared/pressable";

// Matches locked frame #48 "Add Block": a bottom sheet over the editor. Each
// block type has its own category-tile color, varied so the menu reads.
const BLOCK_TYPES: {
  type: Exclude<BlockType, never>;
  label: string;
  cat: string;
  Icon: typeof AlignLeft;
}[] = [
  { type: "text", label: "Text", cat: "blue", Icon: AlignLeft },
  { type: "heading", label: "Heading", cat: "sky", Icon: Heading },
  { type: "meta", label: "Meta Line", cat: "teal", Icon: Info },
  { type: "bulleted_list", label: "Bulleted List", cat: "green", Icon: List },
  { type: "numbered_list", label: "Numbered List", cat: "yellow", Icon: ListOrdered },
  { type: "checklist", label: "Checklist", cat: "red", Icon: ListTodo },
  { type: "table", label: "Table", cat: "teal", Icon: Table },
  { type: "photo", label: "Photo", cat: "pink", Icon: Image },
  { type: "file", label: "File", cat: "blue", Icon: Paperclip },
];

export default function AddBlockSheet({
  onSelect,
  onCancel,
}: {
  onSelect?: (type: BlockType) => void;
  onCancel?: () => void;
}) {
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="grp">
          <div className="eyebrow">Add Block</div>
        </div>
        {/* BROWSER-F-13 (2026-09-05): these nine rows were bare divs with an
            onClick, so VoiceOver could not reach "Text, Heading, Meta Line,
            Bulleted List, Numbered List, Checklist, Table, Photo, File" at all
            (role null, tabIndex -1 on all nine) and neither could a keyboard.
            Tapping always worked, which is why it survived: the crawler's own
            tappable enumeration missed them too, the same way a screen reader
            does. pressable() is the row's three missing props. */}
        {BLOCK_TYPES.map(({ type, label, cat, Icon }) => (
          <div className="row" key={label + cat} {...pressable(() => onSelect?.(type))}>
            <div className={"proj-icon cat-bg-" + cat}>
              <Icon className="ic" />
            </div>
            <div className="conn-name">{label}</div>
          </div>
        ))}
      </div>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="action-sheet">
          <button className="cancel" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
    ,
    document.body,
  );
}
