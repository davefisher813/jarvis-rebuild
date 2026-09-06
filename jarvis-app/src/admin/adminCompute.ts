// Pure logic for the admin endpoints, kept out of the serverless handlers so it
// can be unit-tested. The handlers fetch raw Supabase/Stripe data and pass it
// here for shaping.
import type { AdminUser, AdminUsage, AdminBilling } from "./AdminService";

export interface RawUser {
  id: string;
  email?: string;
  created_at?: string;
  last_sign_in_at?: string | null;
  banned_until?: string | null;
}
export interface ProfileRow { owner_id: string; data?: { role?: string; plan?: string } }

const DAY = 86400000;

export function mapUsers(raw: RawUser[], profiles: ProfileRow[], now = Date.now()): AdminUser[] {
  const byOwner = new Map<string, ProfileRow["data"]>();
  for (const p of profiles) byOwner.set(p.owner_id, p.data || {});
  return raw.map((u) => {
    const p = byOwner.get(u.id) || {};
    const banned = !!u.banned_until && new Date(u.banned_until).getTime() > now;
    return {
      id: u.id,
      email: u.email || "(no email)",
      createdAt: (u.created_at || "").slice(0, 10),
      plan: p.plan || "Free",
      status: banned ? "disabled" : "active",
      role: p.role === "admin" ? "admin" : "user",
    };
  });
}

export function usageFromUsers(raw: RawUser[], aiCalls30d: number, now = Date.now()): AdminUsage {
  let active = 0, signups7d = 0;
  for (const u of raw) {
    if (u.last_sign_in_at && now - new Date(u.last_sign_in_at).getTime() <= 30 * DAY) active += 1;
    if (u.created_at && now - new Date(u.created_at).getTime() <= 7 * DAY) signups7d += 1;
  }
  return { totalUsers: raw.length, activeUsers: active, signups7d, aiCalls30d };
}

export interface StripeSub {
  status: string;
  items?: { data?: { price?: { unit_amount?: number; recurring?: { interval?: string; interval_count?: number } } }[] };
}
export function monthlyRevenue(subs: StripeSub[]): AdminBilling {
  let mrr = 0, activeSubs = 0, trialing = 0;
  for (const s of subs) {
    if (s.status === "trialing") trialing += 1;
    if (s.status !== "active") continue;
    activeSubs += 1;
    for (const li of s.items?.data || []) {
      const amount = (li.price?.unit_amount || 0) / 100;
      const interval = li.price?.recurring?.interval || "month";
      const count = li.price?.recurring?.interval_count || 1;
      const perMonth = interval === "year" ? amount / (12 * count)
        : interval === "week" ? (amount * 52) / (12 * count)
        : interval === "day" ? (amount * 365) / (12 * count)
        : amount / count;
      mrr += perMonth;
    }
  }
  return { mrr: Math.round(mrr), activeSubs, trialing, currency: "USD" };
}

// UP-LAUNCH-16 (2026-09-05): the Feedback section's rows, shaped here so the
// panel never has to reason about a database row.
//
// The whole message is passed through untouched. Truncating somebody's bug
// report to fit a card is how the sentence that explains the bug gets cut off;
// the panel wraps it instead.
export interface RawFeedback {
  id: string;
  text: string;
  build?: string;
  device?: string;
  template?: string;
  last_error?: string | null;
  created_at: string;
}
export interface AdminFeedback {
  id: string;
  text: string;
  /** "build · template · device", with the empty parts left out entirely
      rather than rendered as blanks. */
  meta: string;
  at: string;
  lastError: string | null;
}

// A user agent string is 120 characters of version numbers with one useful
// word in it. This keeps the shape ("iPhone", "iPad", "Mac", "Android") and
// drops the rest, which is what "which device" actually means.
export function deviceName(ua: string | undefined): string {
  const s = ua || "";
  for (const [needle, name] of [["iPhone", "iPhone"], ["iPad", "iPad"], ["Android", "Android"], ["Macintosh", "Mac"], ["Windows", "Windows"]] as const) {
    if (s.includes(needle)) return name;
  }
  return s ? "Other" : "";
}

export function mapFeedback(rows: RawFeedback[]): AdminFeedback[] {
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    meta: [r.build, r.template, deviceName(r.device)].filter(Boolean).join(" · "),
    at: r.created_at,
    lastError: r.last_error || null,
  }));
}
