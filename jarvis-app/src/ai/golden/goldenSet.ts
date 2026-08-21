// The golden set (queue item 12): recorded inputs with the outputs the AI
// layer is REQUIRED to produce, exact-match scored. Two jobs:
//
//   1. Offline (vitest): prove the machinery. Every expected output, played
//     through the real parsers, must score 100%. If a parser or schema change
//    breaks a golden case, the suite says so before any deploy.
//   2. Live (tools/ai-harness.mjs): send the same inputs to the real model
//     through the real prompts and score what comes back. That run costs
//     money, so it is a dev command, never part of the suite. It is how model
//     drift, prompt regressions, and a new model candidate get MEASURED.
//
// Rules for adding cases: real shapes, no fluff, every case earns its place
// by having failed once or by guarding a law (e.g. "never invent a deadline").

import type { CaptureResult } from "../capture";

// ---- Capture / extraction ----

export interface CaptureGold {
  name: string;
  input: string;
  today: string; // ISO date the relative words resolve against
  // Exact-match fields. title compares case-insensitively (titleCase runs at
  // some call sites and casing is convention, not meaning). Omitted optional
  // fields mean "must be absent or empty".
  expect: Pick<CaptureResult, "kind" | "title"> & Partial<Pick<CaptureResult, "date" | "start" | "category">>;
}

// 2026-08-21 is a Friday.
export const CAPTURE_GOLD: CaptureGold[] = [
  {
    name: "plain task",
    input: "call the plumber about the water heater",
    today: "2026-08-21",
    expect: { kind: "task", title: "Call the plumber about the water heater" },
  },
  {
    name: "task with weekday due date",
    input: "pay the electric bill by monday",
    today: "2026-08-21",
    expect: { kind: "task", title: "Pay the electric bill", date: "2026-08-24" },
  },
  {
    name: "event with time tomorrow",
    input: "dentist tomorrow at 9:30am",
    today: "2026-08-21",
    expect: { kind: "event", title: "Dentist", date: "2026-08-22", start: "09:30" },
  },
  {
    name: "event with pm time and weekday",
    input: "practice wednesday 6pm",
    today: "2026-08-21",
    expect: { kind: "event", title: "Practice", date: "2026-08-26", start: "18:00" },
  },
  {
    name: "thought stays a note",
    input: "idea: theme packs could unlock by streak length",
    today: "2026-08-21",
    expect: { kind: "note", title: "Theme packs could unlock by streak length" },
  },
  {
    name: "category picked from the provided list",
    input: "sign the field trip form for Emma",
    today: "2026-08-21",
    expect: { kind: "task", title: "Sign the field trip form for Emma", category: "Family" },
  },
  {
    name: "no invented time on a bare day",
    input: "grill night saturday",
    today: "2026-08-21",
    expect: { kind: "event", title: "Grill night", date: "2026-08-22" },
  },
];

// Categories the capture prompt offers for the cases above.
export const CAPTURE_GOLD_CATEGORIES = ["Work", "Family", "Money", "Health"];

// ---- Triage ----

export interface TriageGoldRow {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  lastMsgId: string;
}

// The golden rows carry only what triage sends to the model; this widens them
// to full ThreadRows for the parser, with neutral values for the fields the
// model never sees. One place, so a ThreadRow change breaks one line.
export function toThreadRows(rows: TriageGoldRow[]): import("../../connections/google/map").ThreadRow[] {
  return rows.map((r) => ({
    ...r,
    fromEmail: r.from.toLowerCase().replace(/[^a-z0-9]+/g, ".") + "@example.com",
    unread: true,
    inInbox: true,
    dateMs: 0,
    count: 1,
  }));
}

export interface TriageGold {
  name: string;
  rows: TriageGoldRow[];
  // bucket is exact-match per id. by is exact-match when stated; "" asserts
  // the law that an absent deadline STAYS absent (never invented from tone).
  expect: Record<string, { bucket: "needs_you" | "worth_knowing" | "noise"; by?: string }>;
}

export const TRIAGE_GOLD: TriageGold[] = [
  {
    name: "the classic mixed batch",
    rows: [
      { id: "g1", from: "Coach Ramirez", subject: "Tournament forms", snippet: "Need Emma's signed medical release by Friday or she can't play", lastMsgId: "m1" },
      { id: "g2", from: "Chase", subject: "Your statement is ready", snippet: "Your August statement is now available online", lastMsgId: "m2" },
      { id: "g3", from: "HomeGoods Deals", subject: "48 Hours Only!", snippet: "Save 30% on patio furniture this weekend only", lastMsgId: "m3" },
    ],
    expect: {
      g1: { bucket: "needs_you", by: "Friday" },
      g2: { bucket: "worth_knowing", by: "" },
      g3: { bucket: "noise", by: "" },
    },
  },
  {
    name: "a person waiting beats a nice subject",
    rows: [
      { id: "g4", from: "Mike Torres", subject: "quick one", snippet: "did you get a chance to look at the quote I sent over", lastMsgId: "m4" },
      { id: "g5", from: "LinkedIn", subject: "You appeared in 12 searches", snippet: "See who found you this week", lastMsgId: "m5" },
    ],
    expect: {
      g4: { bucket: "needs_you", by: "" },
      g5: { bucket: "noise", by: "" },
    },
  },
  {
    name: "urgency in tone is not a deadline",
    rows: [
      { id: "g6", from: "Principal Alvarez", subject: "Please read: schedule change", snippet: "Early dismissal moves to 1pm starting next week, no action needed", lastMsgId: "m6" },
      { id: "g7", from: "Sarah Kim", subject: "invoice 1042 overdue", snippet: "This is the second notice, invoice 1042 for $450 is now 30 days past due", lastMsgId: "m7" },
    ],
    expect: {
      g6: { bucket: "worth_knowing", by: "" },
      g7: { bucket: "needs_you", by: "" },
    },
  },
];
