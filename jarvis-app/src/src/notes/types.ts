// Notes feature types. A note is stored as an engine item (entity_type "note");
// its content lives in the item's data. Tasks created from checklists are
// separate items (entity_type "task") linked one-way via fromNote.

export const ENTITY_NOTE = "note";
export const ENTITY_TASK = "task";

export type BlockType =
  | "heading"
  | "text"
  | "bulleted_list"
  | "numbered_list"
  | "checklist"
  | "table"
  | "photo"
  | "file";

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface Block {
  id: string;
  type: BlockType;
  text?: string;
  items?: ChecklistItem[] | string[];
  columns?: string[];
  rows?: string[][];
  name?: string;
  size?: string;
}

export interface Connection {
  id: string;
  kind: string; // "category" | "event" | "task" | ...
  label: string;
  category: string | null;
  targetId?: string; // id of the linked entity (event/task), when applicable
}

export interface NoteData {
  title: string;
  category: string;
  blocks: Block[];
  connections: Connection[];
}

export interface TaskData {
  text: string;
  category: string;
  done: boolean;
  fromNote?: string;
  due?: string | null;
}

export type TemplateKey =
  | "blank"
  | "meeting"
  | "todo"
  | "tracker"
  | "brief"
  | "journal";

// Mirrors the locked Templates screen.
export const TEMPLATES: Record<TemplateKey, Omit<Block, "id">[]> = {
  blank: [],
  meeting: [
    { type: "heading", text: "Meeting Notes" },
    { type: "text", text: "Date, attendees" },
    { type: "checklist", items: [] },
  ],
  todo: [{ type: "checklist", items: [] }],
  tracker: [{ type: "table", columns: ["", ""], rows: [] }],
  brief: [
    { type: "heading", text: "Objective" },
    { type: "text", text: "" },
    { type: "checklist", items: [] },
  ],
  journal: [{ type: "heading", text: "Log" }],
};
