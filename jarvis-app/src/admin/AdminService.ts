// The admin/master-account data layer. Cross-user data, real usage, and Stripe
// billing MUST come from a privileged server endpoint (service-role key / Stripe
// secret), never the client. So this is an interface the server fills. The app
// holds the shape + UI; `available` is false until that endpoint exists.

import { apiUrl } from "../shared/apiBase";
import type { AdminMetrics } from "./adminMetrics";

export interface AdminUser {
  id: string;
  email: string;
  createdAt: string;
  plan: string;
  status: "active" | "disabled";
  role: "user" | "admin";
}
export interface AdminUsage {
  totalUsers: number;
  activeUsers: number;
  signups7d: number;
  aiCalls30d: number;
}
export interface AdminBilling {
  mrr: number;
  activeSubs: number;
  trialing: number;
  currency: string;
}
// UP-LAUNCH-16 (2026-09-05): what a tester wrote, newest first. Read only.
export interface AdminFeedbackItem {
  id: string;
  text: string;
  meta: string;
  at: string;
  lastError: string | null;
}
export interface AdminService {
  available: boolean;
  sample?: boolean; // true when showing labelled sample data (demo only)
  listUsers(): Promise<AdminUser[]>;
  setUserStatus(id: string, status: "active" | "disabled"): Promise<void>;
  usage(): Promise<AdminUsage>;
  billing(): Promise<AdminBilling>;
  feedback(): Promise<AdminFeedbackItem[]>;
  // UP-LAUNCH-17 (2026-09-05): the launch numbers, first party.
  metrics(): Promise<AdminMetrics>;
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
  Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export function adminConfigured(): boolean {
  return import.meta.env.VITE_ADMIN_API === "1";
}

// Real source: calls the privileged /api/admin endpoints.
//
// PLUMB-F-21 (2026-09-05): `available` used to be the VITE_ADMIN_API build
// flag alone. api/admin/{users,usage,billing} are deployed and the flag was
// never set on the deployed build, so the panel told an admin "Live Data
// Needs the Admin Server · Wired at launch" about a server that was right
// there. The caller passes what it knows instead: useIsAdmin's probe is a
// 200 from /api/admin/usage, which proves both halves at once, that the
// endpoint exists and that this account is on the server's allowlist. The
// flag stays as the default, for a local build pointed at a dev server.
export function createAdminApi(token: string, available = adminConfigured(), doFetch: FetchLike = fetch as unknown as FetchLike): AdminService {
  const base = apiUrl("/api/admin");
  const auth = { headers: { Authorization: "Bearer " + token } };
  const get = async (path: string) => {
    const r = await doFetch(base + path, auth);
    if (!r.ok) throw new Error("admin " + r.status);
    return r.json();
  };
  return {
    available,
    async listUsers() { return ((await get("/users")) as { users: AdminUser[] }).users; },
    async setUserStatus(id, status) {
      const r = await doFetch(base + "/users", {
        method: "POST",
        headers: { ...auth.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!r.ok) throw new Error("admin " + r.status);
    },
    async usage() { return (await get("/usage")) as AdminUsage; },
    async billing() { return (await get("/billing")) as AdminBilling; },
    async feedback() { return ((await get("/feedback")) as { feedback: AdminFeedbackItem[] }).feedback; },
    async metrics() { return (await get("/metrics")) as AdminMetrics; },
  };
}

// Demo source: clearly-labelled sample data so the panel layout can be previewed
// without a server. The UI shows a "Sample data" banner whenever sample is true.
export function makeSampleAdminSource(): AdminService {
  const users: AdminUser[] = [
    { id: "u_001", email: "you@yourdomain.com", createdAt: "2026-05-01", plan: "Pro", status: "active", role: "admin" },
    { id: "u_002", email: "first.beta@email.com", createdAt: "2026-05-18", plan: "Pro", status: "active", role: "user" },
    { id: "u_003", email: "trial.user@email.com", createdAt: "2026-05-24", plan: "Trial", status: "active", role: "user" },
  ];
  return {
    available: true,
    sample: true,
    async listUsers() { return users; },
    async setUserStatus() { /* sample: no-op */ },
    async usage() { return { totalUsers: 3, activeUsers: 2, signups7d: 1, aiCalls30d: 42 }; },
    async billing() { return { mrr: 36, activeSubs: 2, trialing: 1, currency: "USD" }; },
    async feedback() {
      return [{ id: "f_001", text: "The gym timer keeps running when I leave the screen.", meta: "abc1234 \u00b7 student \u00b7 iPhone", at: "2026-09-04T18:02:00.000Z", lastError: null }];
    },
    async metrics() {
      return {
        signups7d: 1, signups30d: 3, weeklyActive: 2,
        onboardingRate: 0.67, funnel: { started: 3, finished: 2, skipped: 1 },
        d1: 0.5, d7: null, d1Basis: 2, d7Basis: 0,
        aiCallsPerActive: 4.5, truncated: false,
      };
    },
  };
}
