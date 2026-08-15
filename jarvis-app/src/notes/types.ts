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
  taskId?: string; // set when this item has been promoted to a real task; keeps them in sync
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

// (Audit 2026-08-10: the always-null `category` field was removed. Every
// caller passed null and the UI dropped it before render; old records that
// still carry it in JSONB are ignored harmlessly.)
export interface Connection {
  id: string;
  kind: string; // "category" | "event" | "task" | ...
  label: string;
  targetId?: string; // id of the linked entity (event/task), when applicable
}

export interface NoteData {
  title: string;
  category: string;
  blocks: Block[];
  connections: Connection[];
}

export type Recurrence = "daily" | "weekly" | "monthly" | "weekdays";

// Money v1 (2026-08-03): a bill is a task wearing money facts. Riding the task
// entity means bills surface on Today when due with zero extra plumbing, and
// needs no registry migration. Presence of `bill` is the ONE switch every
// carve-out checks: bills are excluded from Set Aside, First Step, and
// swipe-snooze (see lifecycle.ts and TasksPage), because behaviors that
// protect feelings on tasks hide rent on bills.
export interface BillInfo {
  amount: number;
  // Autopay means the app never claims "paid": it cannot know a payment
  // cleared. Copy is always "Set to autopay" / "Autopay scheduled".
  autopay?: boolean;
  // The pay link is First Step for money: "find the website" is where
  // initiation dies, so the bill stores it once.
  payUrl?: string;
}

export interface TaskData {
  text: string;
  category: string;
  done: boolean;
  fromNote?: string;
  // Provenance (addendum item 8): set on every AUTO-created task, absent on
  // hand-made ones. Lives in JSONB, no migration needed.
  source?: import("../shared/provenance").Source;
  projectId?: string; // the project this task belongs to (Session 6). Optional
  // field on the existing task entity, so no registry migration is needed.
  due?: string | null;
  recurrence?: Recurrence;
  // Lifecycle policy (ADHD strategy Phase 1). All optional and additive.
  slips?: number; // times the due date was pushed later
  asideFrom?: string | null; // previous due when Set Aside cleared it
  lastDone?: string; // recurring: last completion date (streaks; bills: paid receipt)
  runLen?: number; // recurring: current run length
  bestRun?: number; // recurring: best run ever (never shrinks)
  bill?: BillInfo; // Money v1: this task is a bill (see BillInfo)
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
