// The admin/master-account data layer. Cross-user data, real usage, and Stripe
// billing MUST come from a privileged server endpoint (service-role key / Stripe
// secret), never the client. So this is an interface the server fills. The app
// holds the shape + UI; `available` is false until that endpoint exists.

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
export interface AdminService {
  available: boolean;
  sample?: boolean; // true when showing labelled sample data (demo only)
  listUsers(): Promise<AdminUser[]>;
  setUserStatus(id: string, status: "active" | "disabled"): Promise<void>;
  usage(): Promise<AdminUsage>;
  billing(): Promise<AdminBilling>;
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
  Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export function adminConfigured(): boolean {
  return import.meta.env.VITE_ADMIN_API === "1";
}

// Real source: calls the privileged /api/admin endpoints (built at launch).
export function createAdminApi(token: string, doFetch: FetchLike = fetch as unknown as FetchLike): AdminService {
  const base = "/api/admin";
  const auth = { headers: { Authorization: "Bearer " + token } };
  const get = async (path: string) => {
    const r = await doFetch(base + path, auth);
    if (!r.ok) throw new Error("admin " + r.status);
    return r.json();
  };
  return {
    available: adminConfigured(),
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
  };
}
