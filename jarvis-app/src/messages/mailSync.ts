import { loadVips, VIP_MAX, KEY as VIP_KEY } from "./vip";
import { loadRules, KEY as RULES_KEY, type SenderRules } from "./rules";
import { loadMuted, KEY as MUTED_KEY } from "./mute";
import { loadLetGo, KEY as LETGO_KEY } from "./letGo";

// EVERYTHING JARVIS LEARNS ABOUT YOUR MAIL IS DEVICE-ONLY (S2-5,
// 2026-09-04). VIPs, sender rules, mutes, and let-go each live in their own
// localStorage key, real on whichever phone the user set them on and
// invisible everywhere else. This module is the bridge, not a new source of
// truth: every read in the app still goes straight to localStorage (instant,
// works offline); this only ever mirrors that data into the synced profile
// so a second device -- or the same device after a reinstall -- has
// something to hydrate from.

export interface MailMirror {
  vips?: string[];
  rules?: SenderRules;
  muted?: string[];
  letGo?: string[];
}

// The snapshot written to the profile after any local write to any of the
// four stores.
export function mailSnapshot(storage: Pick<Storage, "getItem"> = localStorage): MailMirror {
  return {
    vips: loadVips(storage),
    rules: loadRules(storage),
    muted: loadMuted(storage),
    letGo: loadLetGo(storage),
  };
}

// Fills in whatever is genuinely empty here from what the profile last
// mirrored -- a fresh install, a second phone, storage the browser cleared.
// A field that already has local data is left alone: a device where the
// user actually cleared something stays cleared, rather than the profile
// mirror fighting a deliberate local decision made since the last sync.
// Writes straight into localStorage too, so the next load's synchronous
// `useState(() => loadX())` sees it without waiting on the network again.
// Returns only what actually changed, so a caller updating render state
// knows exactly which setters to call.
export function hydrateMailFromProfile(
  mail: MailMirror | undefined,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): MailMirror {
  if (!mail) return {};
  const out: MailMirror = {};
  if (mail.vips?.length && loadVips(storage).length === 0) {
    const vips = mail.vips.slice(0, VIP_MAX);
    try { storage.setItem(VIP_KEY, JSON.stringify(vips)); } catch { /* private mode */ }
    out.vips = vips;
  }
  if (mail.rules && Object.keys(mail.rules).length && Object.keys(loadRules(storage)).length === 0) {
    try { storage.setItem(RULES_KEY, JSON.stringify(mail.rules)); } catch { /* private mode */ }
    out.rules = mail.rules;
  }
  if (mail.muted?.length && loadMuted(storage).length === 0) {
    try { storage.setItem(MUTED_KEY, JSON.stringify(mail.muted)); } catch { /* private mode */ }
    out.muted = mail.muted;
  }
  if (mail.letGo?.length && loadLetGo(storage).length === 0) {
    try { storage.setItem(LETGO_KEY, JSON.stringify(mail.letGo)); } catch { /* private mode */ }
    out.letGo = mail.letGo;
  }
  return out;
}
