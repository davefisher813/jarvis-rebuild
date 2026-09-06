// THE THREE NUMBERS (UP-LAUNCH-17, 2026-09-05), fork option A: first party.
//
// The app already writes everything these need. event_log has one text-free
// row per app open per local day per user (migration 0015), and ai_usage has
// one per AI call. What was missing was the onboarding funnel, which now
// emits, and something that turns rows into answers, which is this file.
//
// No vendor, on purpose. PostHog would give funnels out of the box and put a
// third-party SDK with device identifiers on the phone of every fifteen year
// old using the Student template, which guideline 5.1.4 warns about
// specifically. Plausible has no mobile SDK and no per-user retention, so it
// cannot answer any of these questions at all.
//
// The rule that shapes the whole file: a number that cannot be computed
// honestly is null, never zero. An admin panel that says "D1 retention: 0%"
// because the query hit a row cap is worse than one that says nothing.

export interface OpenRow {
  /** event_log.owner_id */
  owner_id: string;
  /** event_log.day, the LOCAL day, which is the only day a retention number
      should ever be counted in. */
  day: string;
}

export interface FunnelCounts {
  /** onboarding.step rows with n = 0: intake was opened. */
  started: number;
  /** onboarding.finished rows with flag true. */
  finished: number;
  /** onboarding.finished rows with flag false: Skip for now. */
  skipped: number;
}

export interface AdminMetrics {
  signups7d: number;
  signups30d: number;
  /** Distinct people who opened the app in the last seven days. */
  weeklyActive: number;
  /** 0..1, or null when nobody has started intake yet. */
  onboardingRate: number | null;
  funnel: FunnelCounts;
  /** 0..1, or null when no cohort is old enough to have answered yet. */
  d1: number | null;
  d7: number | null;
  /** How many people each retention number is actually about, so a 100% that
      is one person reads as one person. */
  d1Basis: number;
  d7Basis: number;
  /** AI calls in the window divided by weekly active, or null with nobody. */
  aiCallsPerActive: number | null;
  /** True when the row query hit its ceiling, which means the retention
      numbers are computed from a partial history and are therefore withheld. */
  truncated: boolean;
}

const DAY = 86400000;

/** Local-day arithmetic on the "YYYY-MM-DD" strings event_log stores. */
export function dayPlus(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((new Date(by!, (bm ?? 1) - 1, bd ?? 1).getTime() - new Date(ay!, (am ?? 1) - 1, ad ?? 1).getTime()) / DAY);
}

/**
 * Retention, the honest way: of the people whose FIRST open was long enough
 * ago that day+n has already happened, how many came back on day+n exactly.
 *
 * Not "within n days", which is the flattering version every dashboard shows:
 * a person who opened the app on day 1 and never again would count as
 * retained at D7 under that definition.
 */
export function retention(opens: OpenRow[], offset: number, today: string): { rate: number | null; basis: number } {
  const byUser = new Map<string, Set<string>>();
  for (const r of opens) {
    if (!r.owner_id || !r.day) continue;
    const set = byUser.get(r.owner_id) ?? new Set<string>();
    set.add(r.day);
    byUser.set(r.owner_id, set);
  }
  let basis = 0;
  let kept = 0;
  for (const days of byUser.values()) {
    const first = [...days].sort()[0]!;
    // The cohort has to have had the chance: a person who signed up
    // yesterday cannot yet have failed to come back on day seven.
    if (daysBetween(first, today) < offset) continue;
    basis += 1;
    if (days.has(dayPlus(first, offset))) kept += 1;
  }
  return { rate: basis === 0 ? null : kept / basis, basis };
}

export function activeSince(opens: OpenRow[], since: string): number {
  const seen = new Set<string>();
  for (const r of opens) if (r.day >= since && r.owner_id) seen.add(r.owner_id);
  return seen.size;
}

export interface MetricsInput {
  /** auth users, for signups. */
  users: { created_at?: string }[];
  /** app.opened rows over the whole window. */
  opens: OpenRow[];
  funnel: FunnelCounts;
  /** ai_usage rows in the last seven days, counted. */
  aiCalls7d: number;
  /** The row query hit its ceiling. */
  truncated: boolean;
  today: string;
  now?: number;
}

export function computeMetrics(input: MetricsInput): AdminMetrics {
  const now = input.now ?? Date.now();
  const since = (n: number) => now - n * DAY;
  const signups = (n: number) =>
    input.users.filter((u) => !!u.created_at && new Date(u.created_at).getTime() >= since(n)).length;

  const weeklyActive = activeSince(input.opens, dayPlus(input.today, -6));
  const started = input.funnel.started;
  const d1 = input.truncated ? { rate: null, basis: 0 } : retention(input.opens, 1, input.today);
  const d7 = input.truncated ? { rate: null, basis: 0 } : retention(input.opens, 7, input.today);

  return {
    signups7d: signups(7),
    signups30d: signups(30),
    weeklyActive,
    onboardingRate: started === 0 ? null : input.funnel.finished / started,
    funnel: input.funnel,
    d1: d1.rate,
    d7: d7.rate,
    d1Basis: d1.basis,
    d7Basis: d7.basis,
    aiCallsPerActive: weeklyActive === 0 ? null : Math.round((input.aiCalls7d / weeklyActive) * 10) / 10,
    truncated: input.truncated,
  };
}

/** A rate as a percentage for the panel, or a dash when there is no answer. */
export function pct(rate: number | null): string {
  return rate === null ? "-" : Math.round(rate * 100) + "%";
}
