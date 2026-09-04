// LET IT GO (Dave, 2026-08-21).
//
// Waiting On had exactly one exit: get a reply. So a thread nobody is ever
// going to answer sat at the top of the list forever, at the top rung,
// wearing the same red button as four others. The list stopped meaning
// "these are live" and started meaning "these are old".
//
// Letting go is not archiving and not deleting: the mail is untouched. It
// only says stop counting the days on this one. Permanent by design (a dead
// thread does not come back to life at midnight), and undoable for as long
// as the toast is up.

export const KEY = "jarvis.mail.letgo.v1";

export function loadLetGo(storage: Pick<Storage, "getItem"> = localStorage): string[] {
  try {
    const p = JSON.parse(storage.getItem(KEY) || "[]") as unknown;
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function letGo(threadId: string, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): string[] {
  const cur = loadLetGo(storage);
  if (cur.includes(threadId)) return cur;
  const next = [...cur, threadId].slice(-200);
  try { storage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

export function undoLetGo(threadId: string, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): string[] {
  const next = loadLetGo(storage).filter((id) => id !== threadId);
  try { storage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}
