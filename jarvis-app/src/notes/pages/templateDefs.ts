// THE TEMPLATE CATALOG (issue #115, waves 2 to 4). Every template page after slice 1 is a DEFINITION here, not a screen of its
// own: a name on a shelf, the fields it starts with (the smallest useful set), the headings its rows sit under, and which view
// draws it. The engine around it (sections, a done mark, reorder, suggested fields, export, import, snapshots, "save as my
// template") is shared, so a template that is only a list of rows costs a definition and nothing else, and every one of them is
// edited the same way: on the page, never in a settings maze.
//
// This file holds data and pure functions only (it is imported by pageModel for the names), so it takes pageModel's TYPES alone.
import type { PageField } from "./pageModel";

export type Shelf = "Sports" | "Life" | "Entertainment" | "Finance" | "Professional";
export const SHELVES: Shelf[] = ["Sports", "Life", "Finance", "Professional", "Entertainment"];

/** Which view draws a template's rows. "sheet" is the shared list of rows under headings. */
export type TemplateView = "sheet" | "profile" | "standings" | "scoreboard" | "pitching" | "session" | "traininglog" | "trainingplan";

export type IconKey = "target" | "user" | "list" | "send" | "table" | "checks" | "dumbbell" | "calendar" | "file" | "wallet" | "dollar" | "home" | "gauge" | "timer" | "flame" | "bulb" | "clock" | "mail" | "brain" | "kanban" | "zap" | "sparkles" | "person" | "tag";

export interface TemplateDef {
  key: string;
  name: string;
  shelf: Shelf;
  /** The grey line under the name in the picker: a Title Case fragment, no period. */
  desc: string;
  cat: string;
  icon: IconKey;
  /** A row, singular and plural: "Player", "Players". */
  noun: string;
  plural: string;
  /** The field that names a row. */
  headline: string;
  /** The fields drawn under a row's name, in order (empty ones are skipped). */
  show: string[];
  fields: PageField[];
  /** Headings a new page starts with. Rows can be moved between them; a heading with no rows is not drawn. */
  sections?: string[];
  /** Fields the page does not start with but offers in one tap: smallest useful structure first, grown when the person says. */
  suggested?: PageField[];
  /** Sums drawn beside the page's count. */
  totals?: { key: string; label: string; money?: boolean }[];
  view: TemplateView;
  /** A running record: choosing the template again asks (open it, or make another) rather than quietly making a second. */
  one?: boolean;
  wave: 2 | 3 | 4;
  /** Starting values for the page's own small settings. */
  meta?: Record<string, string>;
}

const f = (key: string, label: string, type: PageField["type"] = "text", options?: string[]): PageField => ({ key, label, type, ...(options ? { options } : {}) });

/** Every template the catalog has built so far. A key is added here as its wave lands. */
export const TEMPLATE_KEYS = ["scoreboard", "pitching", "session", "eventday", "scouting", "profile", "traininglog", "trainingplan", "standings", "group"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const TEMPLATES: Record<TemplateKey, TemplateDef> = {
  // ---- Wave 2: Sports
  scoreboard: {
    key: "scoreboard", name: "Scoreboard", shelf: "Sports", desc: "Any Sport, Real Scoring, Game Night and Trivia", cat: "green", icon: "gauge",
    noun: "Side", plural: "Sides", headline: "name", show: [], fields: [f("name", "Name")], view: "scoreboard", wave: 2,
  },
  pitching: {
    key: "pitching", name: "Pitching Board", shelf: "Sports", desc: "Pitch Counts, Rest Days, Who Is Available", cat: "orange", icon: "flame",
    noun: "Outing", plural: "Outings", headline: "name", show: ["date", "pitches", "notes"],
    fields: [f("name", "Pitcher"), f("date", "Date", "date"), f("pitches", "Pitches", "number"), f("notes", "Notes")],
    view: "pitching", one: true, wave: 2, meta: { limit: "85" },
  },
  session: {
    key: "session", name: "Session Plan", shelf: "Sports", desc: "Warm-Up, Drills, Scrimmage, Minutes Add Up", cat: "blue", icon: "timer",
    noun: "Activity", plural: "Activities", headline: "act", show: ["min", "notes"],
    fields: [f("act", "Activity"), f("min", "Minutes", "number"), f("notes", "Notes")],
    sections: ["Warm-Up", "Drills", "Scrimmage", "Cool-Down"], totals: [{ key: "min", label: "Min" }],
    suggested: [f("coach", "Coach"), f("equip", "Equipment")], view: "session", wave: 2, meta: { start: "" },
  },
  eventday: {
    key: "eventday", name: "Event Day Pack", shelf: "Sports", desc: "Arrive, Bring, People, Schedule, Checked Off", cat: "yellow", icon: "checks",
    noun: "Item", plural: "Items", headline: "item", show: ["notes"],
    fields: [f("item", "Item"), f("done", "Done", "check"), f("notes", "Notes")],
    sections: ["Before You Go", "Bring", "People", "Schedule"], suggested: [f("who", "Who"), f("time", "Time")], view: "sheet", wave: 2,
  },
  scouting: {
    key: "scouting", name: "Scouting Report", shelf: "Sports", desc: "Opponents or Prospects: Strengths, Weaknesses", cat: "purple", icon: "brain",
    noun: "Report", plural: "Reports", headline: "name", show: ["team", "rating", "strengths"],
    fields: [f("name", "Name"), f("team", "Team"), f("rating", "Rating", "choice", ["1", "2", "3", "4", "5"]), f("strengths", "Strengths"), f("weaknesses", "Weaknesses"), f("notes", "Notes")],
    suggested: [f("position", "Position"), f("seen", "Last Seen", "date")], view: "sheet", wave: 2,
  },
  profile: {
    key: "profile", name: "Profile One-Pager", shelf: "Sports", desc: "One Athlete, One Printable Page", cat: "red", icon: "person",
    noun: "Profile", plural: "Profiles", headline: "name", show: [],
    fields: [f("name", "Name"), f("position", "Position"), f("team", "Team"), f("year", "Class Year"), f("height", "Height"), f("weight", "Weight"), f("gpa", "GPA"), f("contact", "Contact"), f("highlights", "Highlights")],
    suggested: [f("school", "School"), f("coach", "Coach"), f("video", "Video Link")], view: "profile", one: true, wave: 2,
  },
  traininglog: {
    key: "traininglog", name: "Training Log", shelf: "Sports", desc: "Your Workouts From Health, Plus Your Notes", cat: "teal", icon: "dumbbell",
    noun: "Note", plural: "Notes", headline: "note", show: ["date", "coach"],
    fields: [f("date", "Date", "date"), f("note", "Note"), f("coach", "Coach")], view: "traininglog", one: true, wave: 2,
  },
  trainingplan: {
    key: "trainingplan", name: "Training Plan", shelf: "Sports", desc: "Weeks and Days, From a Program or Your Own", cat: "sky", icon: "calendar",
    noun: "Day", plural: "Days", headline: "day", show: ["focus", "detail"],
    fields: [f("day", "Day"), f("focus", "Focus"), f("detail", "Details"), f("done", "Done", "check")], sections: ["Week 1"],
    suggested: [f("rest", "Rest"), f("notes", "Notes")], view: "trainingplan", wave: 2,
  },
  standings: {
    key: "standings", name: "League Standings", shelf: "Sports", desc: "Teams, Games, Wins and Losses Worked Out", cat: "blue", icon: "table",
    noun: "Team", plural: "Teams", headline: "name", show: [], fields: [f("name", "Team")], view: "standings", one: true, wave: 2,
  },
  group: {
    key: "group", name: "Group Manager Page", shelf: "Sports", desc: "Members, Roles, Dues, Who Is Coming", cat: "orange", icon: "user",
    noun: "Member", plural: "Members", headline: "name", show: ["role", "contact"],
    fields: [f("name", "Name"), f("role", "Role", "choice", ["Leader", "Member", "Guest"]), f("contact", "Contact"), f("dues", "Dues Paid", "check")],
    sections: ["Leaders", "Members"], suggested: [f("coming", "Coming", "check"), f("notes", "Notes")], view: "sheet", one: true, wave: 2,
  },
};

export const TEMPLATE_NAMES = Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, TEMPLATES[k].name])) as Record<TemplateKey, string>;

export function templateDef(kind: string): TemplateDef | null {
  return (TEMPLATES as Record<string, TemplateDef>)[kind] ?? null;
}

export const isTemplateKey = (k: string): k is TemplateKey => (TEMPLATE_KEYS as readonly string[]).includes(k);

// Local, so this file keeps to pageModel's types only (pageModel reads TEMPLATE_NAMES from here when it loads).
const rid = (): string => "r_" + (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 13).replace(/-/g, "") : Math.random().toString(36).slice(2, 13));

/** A page of a catalog template, at its smallest useful size. A profile starts with its one record. */
export function newTemplatePage(key: TemplateKey): import("./pageModel").PageData {
  const d = TEMPLATES[key];
  return {
    v: 1,
    kind: key,
    fields: d.fields.map((x) => ({ ...x, ...(x.options ? { options: [...x.options] } : {}) })),
    records: d.view === "profile" ? [{ id: rid(), v: {} }] : [],
    ...(d.sections ? { sections: d.sections.map((label, i) => ({ key: "s" + i, label })) } : {}),
    ...(d.meta ? { meta: { ...d.meta } } : {}),
  };
}
