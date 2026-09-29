// An in-memory stand-in for migration 0043's functions, for handler tests that
// need a budget to talk to. It mirrors the SQL rules closely enough to test
// the handler's use of them (order of calls, what it does with each verdict).
// It is NOT the proof that the rules hold under concurrency: that is
// jarvis-core/supabase/tests/ai_budget.sh, against a real Postgres.

interface Res { user: string; hash: string; reserved: number; actual: number | null; state: "reserved" | "dispatched" | "settled" | "released" }

export class FakeBudget {
  limit = 5_000_000;
  spent = 0;
  held = 0;
  paused = false;
  version = 1;
  reservations = new Map<string, Res>();
  /** Every rpc name called, in order. */
  calls: string[] = [];
  /** When set, every rpc answers this HTTP status instead. */
  fail: number | null = null;
  /** When set, just this one rpc answers 500. */
  failOn: string | null = null;
  /** The highest spent + held ever seen right after an admission. The cap holds iff this never passes the limit. */
  peak = 0;

  handle(url: string, body: Record<string, unknown>): Response | null {
    const m = /\/rpc\/(ai_budget_[a-z_]+)/.exec(url);
    if (!m) return null;
    const fn = m[1]!;
    this.calls.push(fn);
    if (this.fail !== null || this.failOn === fn) return new Response("{}", { status: this.fail ?? 500 });
    const ok = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
    const id = String(body.p_request_id ?? "");
    const r = this.reservations.get(id);
    switch (fn) {
      case "ai_budget_status":
        return ok({
          limit: this.limit, spent: this.spent, held: this.held,
          remaining: Math.max(this.limit - this.spent - this.held, 0),
          period: "since_activation", periodStart: "2026-09-29T00:00:00Z", version: this.version, paused: this.paused,
        });
      case "ai_budget_reserve": {
        const max = Number(body.p_max_cost);
        if (r) {
          if (r.hash !== body.p_hash) return ok({ status: "hash_mismatch" });
          return ok(r.state === "reserved" ? { status: "reserved" } : { status: "replay", state: r.state });
        }
        const remaining = Math.max(this.limit - this.spent - this.held, 0);
        if (this.paused || this.limit === 0) return ok({ status: "paused", remaining });
        if (this.spent + this.held + max > this.limit) return ok({ status: "over_limit", remaining, needed: max });
        this.reservations.set(id, { user: String(body.p_user), hash: String(body.p_hash), reserved: max, actual: null, state: "reserved" });
        this.held += max;
        this.peak = Math.max(this.peak, this.spent + this.held);
        return ok({ status: "reserved" });
      }
      case "ai_budget_mark_dispatched":
        if (r && r.state === "reserved") { r.state = "dispatched"; return ok(true); }
        return ok(false);
      case "ai_budget_settle": {
        if (!r) return ok({ status: "unknown" });
        if (r.state === "settled") return ok({ status: "already_settled" });
        const actual = Number(body.p_actual);
        r.state = "settled"; r.actual = actual;
        this.held = Math.max(this.held - r.reserved, 0);
        this.spent += actual;
        if (actual > r.reserved) this.paused = true;
        return ok({ status: "settled", overrun: actual > r.reserved });
      }
      case "ai_budget_release": {
        if (!r) return ok({ status: "unknown" });
        if (r.state === "released") return ok({ status: "already_released" });
        if (r.state === "settled") return ok({ status: "settled" });
        if (r.state === "dispatched" && body.p_zero_charge !== true) return ok({ status: "dispatched" });
        r.state = "released"; r.actual = 0;
        this.held = Math.max(this.held - r.reserved, 0);
        return ok({ status: "released" });
      }
      case "ai_budget_set_limit": {
        if (this.version !== Number(body.p_expected_version)) return ok({ status: "version_conflict", version: this.version });
        const lim = Number(body.p_limit);
        if (!Number.isFinite(lim) || lim < 0) return ok({ status: "invalid" });
        this.limit = lim;
        this.version += 1;
        if (lim >= this.spent + this.held) this.paused = false;
        return ok({ status: "ok", version: this.version });
      }
    }
    return null;
  }
}
