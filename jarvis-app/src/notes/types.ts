// Notes feature types. A note is stored as an engine item (entity_type "note");
// its content lives in the item's data. Tasks created from checklists are
// separate items (entity_type "task") linked one-way via fromNote.

export const ENTITY_NOTE = "note";
export const ENTITY_TASK = "task";

export type BlockType =
  | "heading"
  | "text"
  | "meta"
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

// REMINDERS (Dave 2026-08-19: "taking meds should just be a set reminder").
//
// A reminder is a task wearing reminder facts, the same trick bills use, and
// for the same reason: riding the task entity needs no registry migration and
// inherits every sync path that already works. What makes it NOT a task is
// behavioural, and enforced everywhere `reminder` is checked: it never enters
// a task list, never counts toward the day's numbers, and is never "overdue".
// It pings, you tap it, it comes back tomorrow.
export interface ReminderInfo {
  // When it pings, "HH:MM".
  time: string;
  // Weekdays it runs on, 0=Sun..6=Sat. Absent means every day.
  days?: number[];
  // The last date it was ticked. Done-ness is DERIVED from this against
  // today, so a reminder resets itself at midnight with no write and no job.
  lastDone?: string;
  // Pushed later within today only. The date is stored alongside so a snooze
  // set last night cannot silently move this morning's ping.
  snoozedTo?: string;
  snoozeDate?: string;
  // D1 (2026-08-20): how many times this has actually been enacted, and the
  // day last counted so ticking twice cannot farm it. This is the honest
  // version of a streak: nothing ever resets, so a gap costs one day rather
  // than the whole run.
  doneCount?: number;
  lastCounted?: string;
  // WHAT HAPPENS WHEN IT IS MISSED (2026-08-21, Dave: "improve the reminder
  // widget, there should be more functionality"). "nag" asks once more a
  // quarter of an hour later; "let_go" stops for the day. Absent means nag,
  // which is what the strip already did, so every existing reminder keeps
  // behaving exactly as it does today.
  onMiss?: "nag" | "let_go";
}

export interface TaskData {
  text: string;
  // THE PRIMARY CATEGORY. Still a single string, still the one that owns the
  // dot, the colour, the work hours and the season pause, so all 192 places
  // that read it keep working untouched.
  category: string;
  // EXTRA CATEGORIES (2026-08-21, Dave: "make it so I can assign multiple
  // categories to tasks"). Tags, not co-primaries: a task appears on their
  // pages and in their filters, but exactly one category decides anything
  // that needs a single answer. That rule is what makes this additive rather
  // than a rewrite of the whole app.
  //
  // Storage note: the primary is NEVER duplicated in here. Reading code
  // should use categoriesOf(), which returns primary-first and de-duped, so
  // no caller has to remember the convention.
  extraCategories?: string[];
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
  reminder?: ReminderInfo; // this task is a reminder (see ReminderInfo)
  // A1 (2026-08-20): the if-then plan. "If [cue], then I'll [≤5 words]."
  // Rides the task entity like bill and reminder do, so no registry
  // migration. Optional and additive: a task without one behaves exactly as
  // it always has.
  plan?: import("../tasks/ifThen").IfThen;
}

export type TemplateKey =
  | "blank"
  | "meeting"
  | "todo"
  | "tracker"
  | "brief"
  | "journal";

// Mirrors the locked Templates screen.
// Templates create the structure their card promises (Dave 2026-08-19,
// "I meant all of these"): Meeting Notes really has agenda, decisions, and
// action items; Brief really has objective, key dates, tasks, notes. Dated
// pieces (meeting date line, journal's first entry) are added by
// applyTemplate, because a template literal can't know today.
export const TEMPLATES: Record<TemplateKey, Omit<Block, "id">[]> = {
  blank: [],
  meeting: [
    { type: "heading", text: "Agenda" },
    { type: "bulleted_list", items: [""] },
    { type: "heading", text: "Decisions" },
    { type: "text", text: "" },
    { type: "heading", text: "Action Items" },
    { type: "checklist", items: [] },
  ],
  todo: [{ type: "checklist", items: [] }],
  tracker: [{ type: "table", columns: ["", ""], rows: [["", ""]] }],
  brief: [
    { type: "heading", text: "Objective" },
    { type: "text", text: "" },
    { type: "heading", text: "Key Dates" },
    { type: "bulleted_list", items: [""] },
    { type: "heading", text: "Tasks" },
    { type: "checklist", items: [] },
    { type: "heading", text: "Notes" },
    { type: "text", text: "" },
  ],
  journal: [{ type: "heading", text: "Log" }],
};
