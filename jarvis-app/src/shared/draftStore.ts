// A DRAFT THAT SURVIVES THE APP (the Logging Standard, rule 8, 2026-10-17:
// "No entry is ever lost. Drafts persist per keystroke; a killed app, a dead
// battery, or airplane mode loses nothing."). One tiny store, keyed per
// composer, written on every change and cleared by the save that spent it.
//
// Local only, and advisory: losing one costs a line of typing, never a
// record. Every key is versioned (laws.test.ts: stored shapes are versioned),
// and every read and write is wrapped, because a private window or blocked
// site data must leave the composer working, only without the net.

export interface DraftStore {
  read: () => string;
  write: (text: string) => void;
  clear: () => void;
}

function storage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/** The store behind one composer. `key` must carry its `.vN` suffix. */
export function draftStore(key: string): DraftStore {
  return {
    read: () => { try { return storage()?.getItem(key) ?? ""; } catch { return ""; } },
    write: (text) => {
      try {
        const s = storage();
        if (!s) return;
        if (text) s.setItem(key, text); else s.removeItem(key);
      } catch { /* private mode: the draft lives in the field alone */ }
    },
    clear: () => { try { storage()?.removeItem(key); } catch { /* nothing to clear */ } },
  };
}
