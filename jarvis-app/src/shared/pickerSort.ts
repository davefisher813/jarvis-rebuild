// THE PICKER'S ORDER (Dave's pass-off, 2026-09-26, on the Projects menu:
// "dumps everything unsorted with no search"). A long list of records in
// store order is a pile. A picker's list is: the current pick first, so
// what is set is never scrolled for; then by area, so the projects of one
// part of life sit together; then by name inside the area. Records with no
// area come after every area, together. Pure, so a sheet can sort what it
// is handed without knowing where it came from.

export interface Pickable { id: string; title: string; area?: string | null }

const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

export function sortPicks<T extends Pickable>(items: T[], currentId?: string | null): T[] {
  return [...items].sort((a, b) => {
    if (currentId) {
      if (a.id === currentId) return -1;
      if (b.id === currentId) return 1;
    }
    const aa = a.area ?? "", ba = b.area ?? "";
    if (aa !== ba) {
      if (!aa) return 1;
      if (!ba) return -1;
      const c = cmp(aa, ba);
      if (c !== 0) return c;
    }
    return cmp(a.title, b.title);
  });
}

/** The menu's search: a case-insensitive "contains" on the label, and an
 *  empty query keeps everything. Whitespace around the query is not a filter. */
export function matchesPick(label: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || label.toLowerCase().includes(q);
}
