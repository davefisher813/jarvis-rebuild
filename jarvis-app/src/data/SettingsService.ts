import type { SupabaseClient } from "@supabase/supabase-js";

// UP-PLAT-10 (2026-09-06): YOUR DECISIONS FOLLOW YOUR ACCOUNT.
//
// 89 `jarvis.*` localStorage keys, and a handful of them are one-of-a-kind
// user decisions with no server copy at all: sign in on a new phone and the
// theme you chose, the settings you set, the shapes you picked are simply
// gone. The table for exactly this has existed since migration 0001
// (`scalar_setting`, with RLS policies and a MONOTONIC updated_at trigger,
// 0001_core_data_model.sql:44-50, :77-79, :123-126) and has had zero readers
// and zero writers since the day it shipped.
//
// This is the reader and the writer. Deliberately NOT built on the core
// Store: the Store is the `item` table's typed client, and a scalar is not an
// item (no entity type, no registry row, a composite primary key). It is
// built on the same auth client the app already holds, with the same
// posture the Store has:
//
//   - LOCAL FIRST, ALWAYS. Every value is mirrored into localStorage under
//     its own versioned key, so a screen can read it synchronously on the
//     first paint. A signed-out or offline launch behaves exactly as it does
//     today, which is why this can be adopted one module at a time.
//   - LAST WRITE WINS BY SERVER TIME. The trigger guarantees updated_at is
//     strictly increasing, so "which of these two is newer" has one answer
//     and it is the server's. A local mirror stamped older than the row loses.
//   - OFFLINE IS NOT AN ERROR. A write that cannot reach the server stays in
//     the mirror and is retried by the next set() or the next pull. Nothing
//     is thrown at the UI: a theme that has not synced yet is still the
//     theme.
//
// It is deliberately small. This is not a second Store; it is one row per
// key, per user, and every value is JSON the caller understands.
//
// There is no useSetting(key) hook. There was one, briefly, and it had no
// caller: the account's copy is pulled ONCE at boot in shell/AppShell.tsx and
// handed to the provider that owns the thing (appearance), because a screen
// that also pulled the same key would be a second reader racing the first
// over one row. A hook belongs here the day a screen owns a key nothing else
// applies, and it is four lines when that day comes.

export interface SettingRow<T> {
  value: T;
  /** Epoch ms of the server's own stamp, or 0 for a value only this phone has. */
  updatedAt: number;
}

// Versioned, like every other stored shape in this app (the law in
// laws/laws.test.ts). The key rides after the version so one setting's mirror
// can be dropped without touching the rest, exactly as the preload cache does.
const MIRROR_BASE = "jarvis.setting.v1";
const mirrorKey = (key: string): string => `${MIRROR_BASE}.${key}`;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** What this phone last knew about a key, or null. Synchronous, on purpose. */
export function readMirror<T>(key: string): SettingRow<T> | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(mirrorKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SettingRow<T>>;
    if (!("value" in parsed)) return null;
    return { value: parsed.value as T, updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0 };
  } catch {
    return null;
  }
}

export function writeMirror<T>(key: string, row: SettingRow<T>): void {
  const s = storage();
  if (!s) return;
  try { s.setItem(mirrorKey(key), JSON.stringify(row)); } catch { /* private mode */ }
}

export function clearMirror(key: string): void {
  const s = storage();
  if (!s) return;
  try { s.removeItem(mirrorKey(key)); } catch { /* already gone */ }
}

/**
 * Which of two values wins. Pure, and the whole ordering rule in one place:
 * the newer server stamp wins, and a value this phone has never synced (0)
 * loses to any real row, because the row came from a device that got further.
 * A tie keeps what is already on screen, which is the calmer of two equal
 * answers.
 */
export function newerOf<T>(local: SettingRow<T> | null, remote: SettingRow<T> | null): SettingRow<T> | null {
  if (!remote) return local;
  if (!local) return remote;
  return remote.updatedAt > local.updatedAt ? remote : local;
}

function epoch(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = new Date(v).getTime();
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

export class SettingsService {
  constructor(private client: SupabaseClient | null, private ownerId: string) {}

  /** True when there is a server to talk to at all (the demo build has none). */
  get synced(): boolean {
    return !!this.client && !!this.ownerId;
  }

  /** The value this phone knows right now. Never a network call. */
  local<T>(key: string): T | undefined {
    return readMirror<T>(key)?.value;
  }

  /**
   * The account's value, pulled and reconciled against the mirror. Returns
   * whatever should be on screen, which on any failure is the mirror: a
   * server that cannot be reached does not get to blank a setting.
   */
  async pull<T>(key: string): Promise<T | undefined> {
    const mirror = readMirror<T>(key);
    if (!this.client) return mirror?.value;
    try {
      const { data, error } = await this.client
        .from("scalar_setting")
        .select("value,updated_at")
        .eq("owner_id", this.ownerId)
        .eq("key", key)
        .maybeSingle();
      if (error || !data) {
        // No row yet and something local to send: this account has never
        // written this key, so the phone's copy is the only copy and it
        // should become the account's.
        if (!error && mirror && mirror.updatedAt === 0) void this.push(key, mirror.value);
        return mirror?.value;
      }
      const remote: SettingRow<T> = { value: (data as { value: T }).value, updatedAt: epoch((data as { updated_at?: unknown }).updated_at) };
      const winner = newerOf(mirror, remote);
      if (winner) writeMirror(key, winner);
      // The phone held something newer than the account (an offline change
      // that never went up). Send it rather than quietly keeping it local.
      if (mirror && winner === mirror && mirror.updatedAt === 0) void this.push(key, mirror.value);
      return winner?.value;
    } catch {
      return mirror?.value;
    }
  }

  /**
   * Set a value. The mirror is written FIRST and always, so the screen is
   * right immediately and stays right offline; the server write follows.
   * Resolves true when it reached the account, false when it is still only
   * on this phone. It never throws: a setting that has not synced yet is
   * not an error the user has to be told about, it is what the sync line
   * on Settings, Backup is for (UP-PLAT-05).
   */
  async set<T>(key: string, value: T): Promise<boolean> {
    writeMirror<T>(key, { value, updatedAt: 0 });
    if (!this.client) return false;
    try {
      const { data, error } = await this.client
        .from("scalar_setting")
        .upsert({ owner_id: this.ownerId, key, value }, { onConflict: "owner_id,key" })
        .select("updated_at")
        .maybeSingle();
      if (error) return false;
      // Stamped with the server's own monotonic time, so the next pull can
      // tell this write from an older one made elsewhere.
      writeMirror<T>(key, { value, updatedAt: epoch((data as { updated_at?: unknown } | null)?.updated_at) });
      return true;
    } catch {
      return false;
    }
  }

  private push<T>(key: string, value: T): Promise<boolean> {
    return this.set(key, value);
  }
}

// UP-PLAT-10 (2026-09-06): the first module moved. Appearance was the clearest
// case in the whole list: two real decisions (the theme, the text size), no
// server copy of the theme at all, and a screen that exists to make them.
// One key holds both, because they are one screen's worth of choices and
// last-write-wins should mean "the last time I changed my appearance",
// not a race between two halves of it.
export const SETTING_APPEARANCE = "appearance";
