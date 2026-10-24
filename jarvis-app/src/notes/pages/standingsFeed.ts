// THE LEAGUE STANDINGS ARE A VIEW THE SCOREBOARD FEEDS (Dave's cut list, 2026-10-23: "worked out from scored games"). A finished two-sided
// game on a Scoreboard becomes a game on the person's League Standings page, and the table works itself out from it. The rule is small
// and said out loud: only a head-to-head game counts (two sides, scored in periods or to a target), and only when the League Standings
// page already has a team under both names. A pickup game between two names the league has never heard of is never put into a table, and
// no team is ever made on the person's behalf. Finishing a game again replaces its row; it never doubles.
import type { NotesService } from "../NotesService";
import type { NoteData } from "../types";
import type { PageData, GameRow } from "./pageModel";
import { sideScored, sideTotal } from "./scoreboard";

const clean = (s: string | undefined): string => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** The game a finished scoreboard is, or null when it is not head to head, not scored, or has no winner to speak of. */
export function gameOf(page: PageData): { date: string; aName: string; bName: string; sa: number; sb: number } | null {
  const sc = page.score;
  if (!sc || (sc.mode !== "periods" && sc.mode !== "target") || page.records.length !== 2) return null;
  const [a, b] = page.records as [PageData["records"][number], PageData["records"][number]];
  if (!sideScored(page, a) || !sideScored(page, b)) return null;
  const aName = (a.v.name ?? "").trim(), bName = (b.v.name ?? "").trim();
  if (!aName || !bName || clean(aName) === clean(bName)) return null;
  return { date: sc.date, aName, bName, sa: sideTotal(page, a), sb: sideTotal(page, b) };
}

/** The standings page with this game on it, or null when the page has no team under both names. Pure. */
export function withGame(standings: PageData, noteId: string, g: NonNullable<ReturnType<typeof gameOf>>): PageData | null {
  const byName = (n: string) => standings.records.find((r) => clean(r.v.name) === clean(n));
  const a = byName(g.aName), b = byName(g.bName);
  if (!a || !b) return null;
  const row: GameRow = { id: "sb:" + noteId, date: g.date, a: a.id, b: b.id, sa: g.sa, sb: g.sb };
  const rest = (standings.games ?? []).filter((x) => x.id !== row.id);
  return { ...standings, games: [...rest, row] };
}

/** Finish: the game goes to the first League Standings page that knows both teams. Returns that page's title, or null when none did. */
export async function feedStandings(svc: NotesService, noteId: string, page: PageData): Promise<string | null> {
  const g = gameOf(page);
  if (!g) return null;
  for (const it of await svc.listNotes()) {
    const d = it.data as unknown as NoteData;
    if (d.page?.kind !== "standings") continue;
    const next = withGame(d.page, noteId, g);
    if (!next) continue;
    if (await svc.setPage(it.id, next)) return d.title.trim() || "League Standings";
  }
  return null;
}
