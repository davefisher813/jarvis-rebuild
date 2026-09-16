import type { SavedStart, StartKind } from "./startAction";

// WHERE YOU LEFT OFF (Start Now, 2026-09-16).
//
// The working surface has to survive a phone call, a tab the OS killed, and
// a trip to another tab to look something up. It also has to survive being
// opened twice: "Repeated Start does not create duplicate drafts, notes or
// sessions" is the acceptance test, and the way to pass it is for the seat
// to be the ENTITY, not the tap. One task, one workspace, forever.
//
// Local, like messages/composeDraft.ts and today/liveFifteen.ts before it,
// and for the same reason: half-written words are the most private text in
// the app, the record only gets them when the user presses the button that
// says so, and localStorage is synchronous so a reopen is instant.
//
// Laws:
//   - Nothing here is a task, a note or an event. It is the workspace, and
//     an abandoned workspace leaves no record behind to clean up.
//   - An empty workspace is deleted rather than stored, so Start on a thing
//     he glanced at and left never comes back offering to resume nothing.
//   - Never an event. laws/start.test.ts asserts no event writer reads this
//     key: the draft is free text and the event log does not take free text.

export const START_KEY = "jarvis.start.session.v1";
const CAP = 40;

export type Sessions = Record<string, SavedStart>;

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

const KINDS = new Set<string>([
  "resume", "open_child_task", "open_resource", "prepare_draft",
  "capture_next_action", "resolve_blocker",
]);
// physical_step was retired on 2026-09-16 (it manufactured its own
// instruction). A workspace saved under it still holds real typed words, so
// it is read as the question it should always have been rather than thrown
// away with them.
const LEGACY: Record<string, StartKind> = { physical_step: "capture_next_action" };

export function loadSessions(storage: Pick<Storage, "getItem"> = localStorage): Sessions {
  try {
    const p = JSON.parse(storage.getItem(START_KEY) || "{}") as unknown;
    if (typeof p !== "object" || p === null || Array.isArray(p)) return {};
    const out: Sessions = {};
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      const s = v as Partial<SavedStart> | null;
      if (!s || typeof s !== "object") continue;
      const kind = LEGACY[String(s.kind)] ?? (s.kind as StartKind);
      if (typeof s.savedAt !== "number" || !KINDS.has(String(kind))) continue;
      out[k] = {
        entityId: str(s.entityId) ?? k,
        kind,
        savedAt: s.savedAt,
        ...(str(s.draft) ? { draft: s.draft as string } : {}),
        ...(str(s.stopPoint) ? { stopPoint: s.stopPoint as string } : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function loadSession(entityId: string, storage: Pick<Storage, "getItem"> = localStorage): SavedStart | null {
  return loadSessions(storage)[entityId] ?? null;
}

function write(all: Sessions, storage: Pick<Storage, "setItem">): void {
  const keys = Object.keys(all).sort((a, b) => all[a]!.savedAt - all[b]!.savedAt).slice(-CAP);
  const trimmed: Sessions = {};
  for (const k of keys) trimmed[k] = all[k]!;
  try { storage.setItem(START_KEY, JSON.stringify(trimmed)); } catch { /* private mode */ }
}

/** Is there anything worth coming back to? A workspace with no words and no
 *  stopping point is not work, and offering to resume it would be a lie. */
export function sessionHasWork(s: Pick<SavedStart, "draft" | "stopPoint">): boolean {
  return !!(s.draft?.trim() || s.stopPoint?.trim());
}

/**
 * Save the workspace for this entity. One seat per entity, overwritten, so
 * tapping Start ten times leaves exactly one.
 *
 * An empty workspace clears its seat instead of taking one: opening
 * something, reading it and leaving must not put a resume offer on the row.
 */
export function saveSession(
  entityId: string,
  s: Omit<SavedStart, "entityId" | "savedAt">,
  now = Date.now(),
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): void {
  const all = loadSessions(storage);
  if (!sessionHasWork(s)) { delete all[entityId]; write(all, storage); return; }
  all[entityId] = {
    entityId,
    kind: s.kind,
    savedAt: now,
    ...(s.draft?.trim() ? { draft: s.draft } : {}),
    ...(s.stopPoint?.trim() ? { stopPoint: s.stopPoint } : {}),
  };
  write(all, storage);
}

/** The work landed on the real record, so the local copy has done its job. */
export function clearSession(entityId: string, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): void {
  const all = loadSessions(storage);
  if (!(entityId in all)) return;
  delete all[entityId];
  write(all, storage);
}

/** The newest thing worth picking back up, for the top card's Resume. Null
 *  when nothing is in progress, which renders as an ordinary Start. */
export function newestSession(all: Sessions): SavedStart | null {
  let best: SavedStart | null = null;
  for (const s of Object.values(all)) {
    if (!sessionHasWork(s)) continue;
    if (!best || s.savedAt > best.savedAt) best = s;
  }
  return best;
}

/**
 * The stopping point, suggested from the work actually saved rather than
 * asked for. The user can edit it, and leaving is never gated on writing
 * one: "Do not force a note before letting them leave."
 *
 * It is the last non-empty line of what they wrote, trimmed to something a
 * row can hold, because the last thing you typed is where you stopped.
 */
export function suggestStopPoint(draft: string, max = 60): string {
  const last = draft.split("\n").map((l) => l.trim()).filter(Boolean).pop();
  if (!last) return "";
  return last.length <= max ? last : last.slice(0, max - 1).trimEnd() + "…";
}
