import { json, who, sel, ins, del } from "./_track3";

// THE HOURS THE OWNER HAS ALREADY SPOKEN FOR (Track 3, 2026-09-19).
//
//   PUT /api/booking-busy {blocks: [{date, startTime, endTime}]}
//
// THE BUG THIS CLOSES. The public grid subtracted bookings other people had made
// and nothing else, so a link published for Tuesday afternoons cheerfully offered
// the hour the owner already had a meeting in. A booking link that double-books
// its owner is worse than no booking link: two people turn up expecting him and
// he is in neither place.
//
// WHY THE APP SENDS THEM RATHER THAN THE SERVER READING THEM. api/book.ts has no
// auth in front of it and names no live-project credential, which is exactly why
// a mistake in it cannot reach the app's real data. Teaching it to read a
// calendar would end that. The app already holds the calendar, so it works out
// which hours are taken and puts them where the public endpoint can see them.
//
// THE ROW SHAPE, AND WHY IT NEEDED NO MIGRATION. availability_overrides already
// has is_blocked alongside an optional override_start and override_end, and a
// blocked row's times were simply ignored. They now mean what they say:
//
//   blocked, no window      the whole day is off (a holiday: what it meant)
//   blocked, with a window  that window is taken, the rest of the day stands
//   not blocked, a window   the day runs to THAT window instead of the usual one
//
// IT REPLACES, NEVER MERGES. A meeting he moved or deleted has to stop blocking
// the hour it used to be in, and the only way to be sure is for these rows to
// mean exactly what his calendar means right now.
//
// IT NEVER TOUCHES HIS DAYS OFF. Those carry no window, and every delete here is
// filtered to rows that have one.
export const config = { runtime: "edge" };

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// A month of a busy calendar with room to spare. A cap at all because this
// writes as many rows as it is given, and "as many as it is given" is not a
// number anybody chose.
const MAX_BLOCKS = 500;

interface Row { owner_id: string; the_date: string; is_blocked: boolean; override_start: string; override_end: string }

const toMin = (hhmm: string): number => {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/** The rows to write, from what the app sent. Anything that is not a window on a
 *  day is dropped rather than stored: a bad row here blocks an hour that is
 *  actually free, or fails to block one that is not, and both are silent. */
export function rowsFrom(blocks: unknown, owner: string): Row[] {
  if (!Array.isArray(blocks)) return [];
  const out: Row[] = [];
  const seen = new Set<string>();
  for (const b of blocks.slice(0, MAX_BLOCKS)) {
    const o = b as { date?: unknown; startTime?: unknown; endTime?: unknown };
    if (typeof o.date !== "string" || !DATE.test(o.date)) continue;
    if (typeof o.startTime !== "string" || typeof o.endTime !== "string") continue;
    const from = toMin(o.startTime);
    const to = toMin(o.endTime);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
    const key = o.date + o.startTime + o.endTime;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ owner_id: owner, the_date: o.date, is_blocked: true, override_start: o.startTime, override_end: o.endTime });
  }
  return out;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "PUT") return json({ error: "Method not allowed" }, 405);
  const w = await who(req);
  if (!w.ok) return w.res;
  const c = w.ctx;

  try {
    const body = (await req.json().catch(() => null)) as { blocks?: unknown } | null;
    const rows = rowsFrom(body?.blocks, c.owner);

    // Only rows that name a window, so a day he marked off stays marked off.
    await del(c, `availability_overrides?owner_id=eq.${c.owner}&override_start=not.is.null`);
    if (rows.length > 0) await ins(c, "availability_overrides", rows);

    // Counted back from the table rather than from what was sent, so the answer
    // is what the link will actually honour.
    const after = await sel<{ id: string }>(
      c, `availability_overrides?owner_id=eq.${c.owner}&override_start=not.is.null&select=id`);
    return json({ blocked: after.length });
  } catch {
    return json({ error: "Could not save your hours" }, 502);
  }
}
