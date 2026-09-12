import { loadVips, VIP_MAX, KEY as VIP_KEY } from "./vip";
import { loadRules, KEY as RULES_KEY, type SenderRules } from "./rules";
import { migrateRules } from "./ruleScope";
import { loadMuted, KEY as MUTED_KEY } from "./mute";
import { loadLetGo, KEY as LETGO_KEY } from "./letGo";
import { loadLinks, KEY as LINKS_KEY, type LinkMap } from "./threadLink";
import { loadDesk, KEY as DESK_KEY, type DeskMap } from "./desk";
import { loadWindows, saveWindows, loadWindowsMirror, windowsForMirror, windowsFromMirror, type WindowSettings } from "./batching";

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
  // EMAIL-F-19 (2026-09-05): which thread belongs to which project. It was
  // the one mail store that never left the device, so a thread filed on the
  // phone was unfiled on the iPad.
  links?: LinkMap;
  // UP-MIND-09: which threads are waiting for a desk. This one MUST cross
  // devices or the feature is a lie -- the whole promise is that a thread set
  // aside on the phone is sitting on the laptop when you get there.
  desk?: DeskMap;
  // E-14 (Push G, 2026-09-12): Email Windows, OPT-IN. Present only when
  // this device has chosen "Same on Every Device"; absent otherwise, so a
  // device that never opted in neither sends its windows nor takes any.
  windows?: WindowSettings;
}

// The snapshot written to the profile after any local write to any of the
// four stores.
export function mailSnapshot(storage: Pick<Storage, "getItem"> = localStorage): MailMirror {
  return {
    vips: loadVips(storage),
    rules: loadRules(storage),
    muted: loadMuted(storage),
    letGo: loadLetGo(storage),
    links: loadLinks(storage),
    desk: loadDesk(storage),
    ...(loadWindowsMirror(storage) ? { windows: windowsForMirror(loadWindows(storage)) } : {}),
  };
}

// EMAIL-F-30 (2026-09-05): "Cross-device mail mirror only fills an empty
// device; two devices never converge." Every field here used to hydrate only
// when the local store was EMPTY, so a phone that already had one VIP never
// received the two marked on the iPad, and the phone's next VIP toggle
// mirrored its own list over the top: S2-5's "a second phone started from
// zero" was fixed for the very first hydrate and for nothing after it.
//
// Fork option A: union-merge, which is what these four (now five) stores
// actually are. A VIP list, a mute list and a let-go list are sets, and
// nothing in the app removes an entry silently, so the union is what the
// person meant on both devices. Rules and links are keyed, and there the
// LOCAL side wins a conflict: this device's most recent decision about a
// sender is fresher than whatever the profile last carried.
//
// Writes straight into localStorage too, so the next load's synchronous
// `useState(() => loadX())` sees it without waiting on the network again.
// Returns only what actually changed, so a caller updating render state
// knows exactly which setters to call.
const same = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export function hydrateMailFromProfile(
  mail: MailMirror | undefined,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): MailMirror {
  if (!mail) return {};
  const out: MailMirror = {};

  if (mail.vips?.length) {
    const local = loadVips(storage);
    // Local first, so the cap keeps the people THIS device chose when the two
    // lists together are longer than the cap.
    const vips = [...new Set([...local, ...mail.vips])].slice(0, VIP_MAX);
    if (!same(vips, local)) {
      try { storage.setItem(VIP_KEY, JSON.stringify(vips)); } catch { /* private mode */ }
      out.vips = vips;
    }
  }

  if (mail.rules && Object.keys(mail.rules).length) {
    const local = loadRules(storage);
    // E-24: the mirror may hold v1 strings from another build; every entry
    // is read in the v2 shape before it is merged or handed to the UI.
    const rules = migrateRules({ ...mail.rules, ...local });
    if (Object.keys(rules).length !== Object.keys(local).length) {
      try { storage.setItem(RULES_KEY, JSON.stringify(rules)); } catch { /* private mode */ }
      out.rules = rules;
    }
  }

  if (mail.muted?.length) {
    const local = loadMuted(storage);
    const muted = [...new Set([...local, ...mail.muted])];
    if (!same(muted, local)) {
      try { storage.setItem(MUTED_KEY, JSON.stringify(muted)); } catch { /* private mode */ }
      out.muted = muted;
    }
  }

  if (mail.letGo?.length) {
    const local = loadLetGo(storage);
    const letGo = [...new Set([...local, ...mail.letGo])];
    if (!same(letGo, local)) {
      try { storage.setItem(LETGO_KEY, JSON.stringify(letGo)); } catch { /* private mode */ }
      out.letGo = letGo;
    }
  }

  if (mail.links && Object.keys(mail.links).length) {
    const local = loadLinks(storage);
    const links = { ...mail.links, ...local };
    if (Object.keys(links).length !== Object.keys(local).length) {
      try { storage.setItem(LINKS_KEY, JSON.stringify(links)); } catch { /* private mode */ }
      out.links = links;
    }
  }

  // UP-MIND-09: keyed like rules and links, so the local side wins a
  // conflict on the same thread -- but the union is what matters here, since
  // a thread set aside on either device is set aside. A thread CLEARED on one
  // device stays cleared there and is not resurrected by this merge only
  // because clearing also rewrites the mirror; that is the same shape the
  // other keyed stores have and the same trade S2-5 accepted.
  if (mail.desk && Object.keys(mail.desk).length) {
    const local = loadDesk(storage);
    const desk = { ...mail.desk, ...local };
    if (Object.keys(desk).length !== Object.keys(local).length) {
      try { storage.setItem(DESK_KEY, JSON.stringify(desk)); } catch { /* private mode */ }
      out.desk = desk;
    }
  }

  // E-14: windows are a single setting, not a set, so there is no union to
  // take: a device that opted in takes the profile's copy whole, because the
  // last device to save pushed its copy up and "same on every device" means
  // that one. A device that has not opted in ignores the field entirely.
  if (mail.windows && loadWindowsMirror(storage)) {
    const remote = windowsFromMirror(mail.windows);
    if (remote && JSON.stringify(remote) !== JSON.stringify(windowsForMirror(loadWindows(storage)))) {
      saveWindows(remote, storage);
      out.windows = remote;
    }
  }

  return out;
}
