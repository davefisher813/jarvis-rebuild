// WHAT THE APP CAN SUGGEST, CONFIRM FIRST (issue #115: "app insights suggest entries, confirm-first"). Pure: each takes what the app
// already knows and what the page already has, and returns rows the person may add. Nothing is added by being suggested.

import type { Goal } from "../../life/types";
import type { Project } from "../../projects/types";
import type { Person } from "../../people/types";
import { birthdayMonthDay } from "../../people/birthdays";
import type { PageData } from "./pageModel";

export interface Suggestion { key: string; values: Record<string, string> }

const norm = (s: string | undefined): string => (s ?? "").trim().toLowerCase();

/** Goals achieved and projects closed that the page does not list yet (matched by title), newest first. */
export function accomplishmentSuggestions(page: PageData, goals: Goal[], projects: Project[]): Suggestion[] {
  const have = new Set(page.records.map((r) => norm(r.v.title)));
  const out: Array<Suggestion & { on: string }> = [];
  for (const g of goals) {
    if (g.data.state !== "achieved" || have.has(norm(g.data.title))) continue;
    out.push({ key: "goal:" + g.id, on: g.data.achievedOn ?? "", values: { title: g.data.title, ...(g.data.achievedOn ? { date: g.data.achievedOn } : {}), notes: "A Goal You Achieved" } });
  }
  for (const p of projects) {
    if (p.data.status !== "done" || have.has(norm(p.data.title))) continue;
    out.push({ key: "project:" + p.id, on: p.data.closedOn ?? "", values: { title: p.data.title, ...(p.data.closedOn ? { date: p.data.closedOn } : {}), notes: "A Project You Finished" } });
  }
  return out.sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0)).map(({ key, values }) => ({ key, values }));
}

/** People with a birthday the page does not list (matched by name), with the date set to this year's so the page reads it as a day. */
export function birthdaySuggestions(page: PageData, people: Person[], year: number): Suggestion[] {
  const have = new Set(page.records.filter((r) => norm(r.v.occasion) === "birthday" || !(r.v.occasion ?? "").trim()).map((r) => norm(r.v.name)));
  const out: Suggestion[] = [];
  for (const p of people) {
    const md = birthdayMonthDay(p.data.birthday);
    if (!md || have.has(norm(p.data.name))) continue;
    out.push({ key: "person:" + p.id, values: { name: p.data.name, occasion: "Birthday", date: `${year}-${md}` } });
  }
  return out.sort((a, b) => (a.values.date! < b.values.date! ? -1 : 1));
}
