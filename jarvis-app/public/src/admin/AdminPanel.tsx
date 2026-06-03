import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import type { AdminService, AdminUser, AdminUsage, AdminBilling } from "./AdminService";

// The master-account panel. Gated by isAdmin for UX; the real boundary is the
// server (privileged endpoint + RLS). When the source is unavailable (no server
// yet) each section says so honestly rather than inventing numbers.
export default function AdminPanel({ isAdmin, source, onBack }: {
  isAdmin: boolean;
  source: AdminService;
  onBack?: () => void;
}) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usage, setUsage] = useState<AdminUsage | null>(null);
  const [billing, setBilling] = useState<AdminBilling | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin || !source.available) return;
    let on = true;
    (async () => {
      try {
        const [u, us, b] = await Promise.all([source.listUsers(), source.usage(), source.billing()]);
        if (!on) return;
        setUsers(u); setUsage(us); setBilling(b);
      } catch (e) {
        if (on) setError((e as Error).message || "Could not load admin data");
      }
    })();
    return () => { on = false; };
  }, [isAdmin, source]);

  const toggle = async (u: AdminUser) => {
    const next = u.status === "active" ? "disabled" : "active";
    setUsers((xs) => xs.map((x) => (x.id === u.id ? { ...x, status: next } : x)));
    try { await source.setUserStatus(u.id, next); } catch (e) { setError((e as Error).message || "Action failed"); }
  };

  if (!isAdmin) {
    return (
      <div className="screen">
        <div className="nav-bar"><button className="nav-back" onClick={onBack}>Back</button><div className="nav-large">Admin</div></div>
        <div className="pad-x"><div className="card"><div className="empty-state">
          <div className="empty-icon"><ShieldAlert className="ic" /></div>
          <div className="empty-title">Not authorized</div>
          <div className="empty-sub">This area is for the master account only.</div>
        </div></div></div>
      </div>
    );
  }

  const serverNote = (
    <div className="pad-x"><div className="card"><div className="empty-state">
      <div className="empty-title">Live data needs the admin server</div>
      <div className="empty-sub">Cross-user data, usage, and billing come from a privileged endpoint, wired at launch.</div>
    </div></div></div>
  );

  return (
    <div className="screen">
      <div className="nav-bar"><button className="nav-back" onClick={onBack}>Back</button><div className="nav-large">Admin</div></div>

      {source.sample && <div className="pad-x"><div className="adm-banner">Sample data, for layout preview only.</div></div>}
      {error && <div className="pad-x conn-error">{error}</div>}

      <div className="grp"><div className="eyebrow">Usage</div></div>
      {!source.available ? serverNote : (
        <div className="pad-x"><div className="adm-grid">
          <div className="adm-tile"><div className="adm-num">{usage?.totalUsers ?? "-"}</div><div className="adm-label">Users</div></div>
          <div className="adm-tile"><div className="adm-num">{usage?.activeUsers ?? "-"}</div><div className="adm-label">Active</div></div>
          <div className="adm-tile"><div className="adm-num">{usage?.signups7d ?? "-"}</div><div className="adm-label">Signups 7d</div></div>
          <div className="adm-tile"><div className="adm-num">{usage?.aiCalls30d ?? "-"}</div><div className="adm-label">AI calls 30d</div></div>
        </div></div>
      )}

      <div className="grp"><div className="eyebrow">Billing</div></div>
      {!source.available ? serverNote : (
        <div className="pad-x"><div className="adm-grid">
          <div className="adm-tile"><div className="adm-num">{billing ? "$" + billing.mrr : "-"}</div><div className="adm-label">MRR</div></div>
          <div className="adm-tile"><div className="adm-num">{billing?.activeSubs ?? "-"}</div><div className="adm-label">Subscribers</div></div>
          <div className="adm-tile"><div className="adm-num">{billing?.trialing ?? "-"}</div><div className="adm-label">Trialing</div></div>
        </div></div>
      )}

      <div className="grp"><div className="eyebrow">Users{users.length ? " (" + users.length + ")" : ""}</div></div>
      {!source.available ? serverNote : users.length === 0 ? (
        <div className="pad-x"><div className="card"><div className="empty-state"><div className="empty-title">No users yet</div></div></div></div>
      ) : (
        <div className="pad-x"><div className="card">
          {users.map((u) => (
            <div className="row" key={u.id}>
              <div className="row-grow">
                <div className="conn-name">{u.email}{u.role === "admin" && <span className="adm-role">admin</span>}</div>
                <div className="conn-meta">{u.plan} &middot; {u.status}</div>
              </div>
              <button className="chip" onClick={() => toggle(u)}>{u.status === "active" ? "Disable" : "Enable"}</button>
            </div>
          ))}
        </div></div>
      )}
    </div>
  );
}
