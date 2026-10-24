// WHERE A FINISHED ROUND GOES (Dave's Golf decision, 2026-10-23: "past rounds kept in a history", "course remembered with real pars").
// The Rounds page is one page, made the first time a round is finished and found by its kind after that. Finishing writes one row per
// player (keyed by round and player, so finishing again replaces and never doubles) and keeps the course with its pars when every
// hole has one. Nothing here runs on its own: the Finish button is the only caller.
import type { NotesService } from "../NotesService";
import type { NoteData } from "../types";
import { type PageData, newId } from "./pageModel";
import { newTemplatePage } from "./templateDefs";
import { readCourseBook, rememberCourse, roundRows, withRounds, type CourseMemo } from "./golf";

type Notes = NotesService;

async function findRounds(svc: Notes): Promise<{ id: string; page: PageData } | null> {
  for (const it of await svc.listNotes()) {
    const d = it.data as unknown as NoteData;
    if (d.page?.kind === "rounds") return { id: it.id, page: d.page };
  }
  return null;
}

/** The courses kept so far, for the New Round sheet. Empty when no round was ever finished. */
export async function loadCourseBook(svc: Notes): Promise<CourseMemo[]> {
  return readCourseBook((await findRounds(svc))?.page);
}

/** Finish: the round's rows and its course go to the Rounds page. Returns false if the write did not land. */
export async function keepRound(svc: Notes, roundNoteId: string, page: PageData): Promise<boolean> {
  if (!page.golf) return false;
  const found = await findRounds(svc);
  const base = found?.page ?? newTemplatePage("rounds");
  const next = rememberCourse(withRounds(base, roundRows(page, roundNoteId), newId), page.golf);
  if (found) return !!(await svc.setPage(found.id, next));
  return !!(await svc.createPage("Rounds", next));
}
