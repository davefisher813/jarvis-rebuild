import type { Storage2 } from "../gym/liveSession";

// YOUR TIMES (Track 3, 2026-09-14). The one booking screen the Track 3
// preview draws: available or not, which days, how long a slot is, who may
// book and how the link is found. Stored locally, the way Health Settings
// are, because the booking tables (jarvis-core/supabase/track3) have no
// project to live in yet. When they do, this record is what seeds
// availability_rules and booking_links; nothing here is invented twice.

// ONE CHOICE EACH (2026-10-04, the dead-button sweep). The screen offered three
// answers to "who can book" and three to "how is the link found", and the
// server honours exactly one of each: api/book.ts never reads
// booking_permissions, public and link_only are the same open grid, and a
// named_contacts link answered 404 to everyone because there is no way to name
// a contact. A choice that changes nothing, or breaks the link, is not
// offered. What an earlier build stored ("approved", "connections", "public",
// "named") still reads, and reads as the one that works.
export type BookingWho = "anyone";
export type BookingVisibility = "link";
export const DURATIONS = [15, 30, 45, 60] as const;
export type BookingDuration = (typeof DURATIONS)[number];

export interface BookingSettings {
  available: boolean;
  /** Mon-first, 0 to 6, the days he takes bookings on. */
  days: number[];
  durationMin: BookingDuration;
  who: BookingWho;
  visibility: BookingVisibility;
}

export const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  available: false,
  days: [0, 1, 2, 3, 4],
  durationMin: 30,
  who: "anyone",
  visibility: "link",
};

export const WHO_LABEL: Record<BookingWho, string> = {
  anyone: "Anyone with the Link",
};

const KEY = "jarvis.booking.settings.v1";

function browserStorage(): Storage2 {
  return {
    read: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    write: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    remove: (k) => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
  };
}

export function readBookingSettings(store: Storage2 = browserStorage()): BookingSettings {
  try {
    const raw = store.read(KEY);
    if (!raw) return { ...DEFAULT_BOOKING_SETTINGS };
    const p = JSON.parse(raw) as Partial<BookingSettings>;
    const days = Array.isArray(p.days) ? [...new Set(p.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b) : DEFAULT_BOOKING_SETTINGS.days;
    return {
      available: p.available === true,
      days,
      durationMin: (DURATIONS as readonly number[]).includes(p.durationMin as number) ? (p.durationMin as BookingDuration) : 30,
      who: "anyone",
      visibility: "link",
    };
  } catch {
    return { ...DEFAULT_BOOKING_SETTINGS };
  }
}

export function writeBookingSettings(s: BookingSettings, store: Storage2 = browserStorage()): void {
  store.write(KEY, JSON.stringify(s));
}

export function updateBookingSettings(patch: Partial<BookingSettings>, store: Storage2 = browserStorage()): BookingSettings {
  const next = { ...readBookingSettings(store), ...patch };
  writeBookingSettings(next, store);
  return next;
}
