import type { Store, ItemData, Item } from "@core";

// Moving every reference from one person to another, and putting it back.
// Used by the Brain Manual v1 contact merge (brain/manual/merge.ts decides
// what merges; this does the store work, reached through PeopleService so
// the owner and the store stay inside the service).

/** A patch that puts a row's data back exactly: every old value, and every
 *  key the change added set to undefined, which the Store writes as a clear
 *  (patch.ts toWire), since a missing key would leave the new value in
 *  place. */
export function restorePatch(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...before };
  for (const k of Object.keys(after)) if (!(k in before)) out[k] = undefined;
  return out;
}

/** One row a relink changed, and what it held before. */
export interface Relinked { id: string; before: Record<string, unknown>; after: Record<string, unknown> }

type Data = Record<string, unknown>;

/** Every place a row points at a person, rewritten from one id to another.
 *  Returns null when the row holds no reference. Tasks carry personId and a
 *  reminder's linkedItem (type "contact"), notes carry person connections,
 *  decisions carry a person link (old triple and the links list), strands
 *  carry an entity link, a waiting row carries contactId and a trusted adult
 *  carries personId.
 *
 *  Phase 0 D2 (2026-10-10): the three paths added here are registry rows in
 *  substrate/links/paths.ts (task.reminder.linkedItem.id, waiting.contactId,
 *  health_trusted_adult.personId). The registry does not say which TYPE a
 *  pointer is for, so this stays the hand kept list of the ones that point
 *  at a person; linkedItem is read by its own `type` field, which is the
 *  shape notes/types.ts LinkedItem actually has ("contact", not "person"). */
export function relinkData(entityType: string, d: Data, from: string, to: string): Data | null {
  let changed = false;
  const next: Data = { ...d };
  if (entityType === "task" && d.personId === from) { next.personId = to; changed = true; }
  if (entityType === "task") {
    const reminder = d.reminder as Data | undefined;
    const link = reminder?.linkedItem as Data | undefined;
    if (link && link.type === "contact" && link.id === from) {
      next.reminder = { ...reminder, linkedItem: { ...link, id: to } };
      changed = true;
    }
  }
  if (entityType === "waiting" && d.contactId === from) { next.contactId = to; changed = true; }
  if (entityType === "health_trusted_adult" && d.personId === from) { next.personId = to; changed = true; }
  if (entityType === "note" && Array.isArray(d.connections)) {
    const conns = (d.connections as Data[]).map((c) => {
      if (c && c.kind === "person" && c.targetId === from) { changed = true; return { ...c, targetId: to }; }
      return c;
    });
    next.connections = conns;
  }
  if (entityType === "decision_record") {
    if (d.linkedType === "person" && d.linkedId === from) { next.linkedId = to; changed = true; }
    if (Array.isArray(d.links)) {
      next.links = (d.links as Data[]).map((l) => {
        if (l && l.type === "person" && l.id === from) { changed = true; return { ...l, id: to }; }
        return l;
      });
    }
  }
  if (entityType === "strand") {
    const link = d.link as Data | undefined;
    if (link && link.entityType === "person" && link.entityId === from) { next.link = { ...link, entityId: to }; changed = true; }
  }
  return changed ? next : null;
}

export const RELINK_TYPES = ["task", "note", "decision_record", "strand", "waiting", "health_trusted_adult"] as const;

/** Rewrites every reference to `from` so it points at `to`, and returns what
 *  each changed row held, for Undo. */
export async function relinkPerson(store: Store, ownerId: string, from: string, to: string): Promise<Relinked[]> {
  const changed: Relinked[] = [];
  for (const type of RELINK_TYPES) {
    const items: Item[] = await store.listForUser(ownerId, type);
    for (const it of items) {
      const before = it.data as Data;
      const after = relinkData(type, before, from, to);
      if (!after) continue;
      await store.update(ownerId, it.id, after as unknown as ItemData);
      changed.push({ id: it.id, before, after });
    }
  }
  return changed;
}

/** Puts relinked rows back as they were. */
export async function unrelink(store: Store, ownerId: string, rows: Relinked[]): Promise<void> {
  for (const r of rows) {
    await store.update(ownerId, r.id, restorePatch(r.before, r.after) as unknown as ItemData);
  }
}
