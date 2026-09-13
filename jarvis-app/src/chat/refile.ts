// REFILE MOVES, IT DOES NOT COPY (audit 2026-09-11 item 7, fixed
// 2026-09-13). "Move to X" on a file's receipt delivered the file to the new
// place and left whatever the first delivery had made (a Money receipt row,
// a note with the file attached) exactly where it was, so the file ended up
// filed in both. Every delivery now hands back the way to take itself back,
// and a refile delivers to the new place FIRST, then takes the old one back:
// a delivery that fails leaves the file where it already was, never nowhere.
export type Undo = () => Promise<void>;

export async function refileWith(deliverNext: () => Promise<Undo | null>, undoPrev: Undo | null): Promise<Undo | null> {
  const next = await deliverNext();
  if (undoPrev) await undoPrev().catch(() => undefined);
  return next;
}
