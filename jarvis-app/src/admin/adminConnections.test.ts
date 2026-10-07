import { describe, it, expect } from "vitest";
import { summarizeConnections, LIST_FAILING_FROM, type RawGrant } from "./adminConnections";

const g = (email: string, o: Partial<RawGrant> = {}): RawGrant => ({ email, state: "VALID", dead_at: null, last_refresh_ok_at: "2026-10-07T10:00:00Z", consecutive_failures: 0, last_auth_error: null, ...o });
const id = (e: string, a: string) => `ID(${e},${a})`;

describe("summarizeConnections", () => {
  it("counts healthy sign-ins and lists none of them", () => {
    expect(summarizeConnections([g("a@x.com"), g("b@x.com")], id)).toEqual({ total: 2, healthy: 2, rows: [] });
  });

  it("lists a lost grant with its incident ID, code, source and cause", () => {
    const s = summarizeConnections([g("a@x.com", { state: "DEAD", dead_at: "2026-10-07T09:00:00Z", last_auth_error: { lastAuthErrorCode: "invalid_grant", lastAuthErrorSource: "worker", likelyCause: "testing_mode_7_day" } }), g("b@x.com")], id);
    expect(s.healthy).toBe(1);
    expect(s.rows).toEqual([{ email: "a@x.com", incident: "ID(a@x.com,2026-10-07T09:00:00Z)", kind: "auth", since: "2026-10-07T09:00:00Z", code: "invalid_grant", source: "worker", cause: "testing_mode_7_day", failures: 0 }]);
  });

  it("lists a sign-in that is only failing once it has failed a few times in a row, and not before", () => {
    expect(summarizeConnections([g("a@x.com", { consecutive_failures: LIST_FAILING_FROM - 1 })], id).rows).toEqual([]);
    expect(summarizeConnections([g("a@x.com", { consecutive_failures: LIST_FAILING_FROM })], id).rows[0]).toMatchObject({ kind: "failing", incident: null, failures: LIST_FAILING_FROM });
  });

  it("a lost grant outranks one that is only failing", () => {
    const s = summarizeConnections([g("f@x.com", { consecutive_failures: 9 }), g("d@x.com", { state: "DEAD", dead_at: "2026-10-07T09:00:00Z" })], id);
    expect(s.rows.map((r) => r.email)).toEqual(["d@x.com", "f@x.com"]);
  });
});
