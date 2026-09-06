import { useEffect, useState } from "react";
import { ShieldAlert } from "../shared/icons";
import { formatUSD } from "../ai/tokenLog";
import type { AdminService, AdminUser, AdminUsage, AdminBilling, AdminFeedbackItem } from "./AdminService";
import { pct, type AdminMetrics } from "./adminMetrics";

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
  // UP-LAUNCH-16 (2026-09-05): what testers wrote. Loaded beside the rest but
  // tolerated separately: an older deploy has no /api/admin/feedback, and one
  // missing section must not blank the whole panel.
  const [feedback, setFeedback] = useState<AdminFeedbackItem[] | null>(null);
  // UP-LAUNCH-17 (2026-09-05): the launch numbers, loaded the same tolerant
  // way as Feedback so an older deploy without the endpoint says so instead
  // of blanking the panel.
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin || !source.available) return;
    let on = true;
    (async () => {
      try {
        const [u, us, b] = await Promise.all([source.listUsers(), source.usage(), source.billing()]);
        if (!on) return;
        setUsers(u); setUsage(us); setBilling(b);
        try {
          const f = await source.feedback();
          if (on) setFeedback(f);
        } catch { /* the section says so for itself */ }
        try {
          const m = await source.metrics();
          if (on) setMetrics(m);
        } catch { /* the section says so for itself */ }
      } catch (e) {
        if (on) setError((e as Error).message || "Could not load admin data");
      }
    })();
    return () => { on = false; };
  }, [isAdmin, source]);

  // PLUMB-F-21 (2026-09-05): the row flipped, the write failed, the error
  // line appeared, and the row still read the way the failed write meant to
  // leave it. On this screen that reads as an account that has been disabled
  // and has not been.
  const toggle = async (u: AdminUser) => {
    const next = u.status === "active" ? "disabled" : "active";
    const was = u.status;
    setUsers((xs) => xs.map((x) => (x.id === u.id ? { ...x, status: next } : x)));
    try {
      await source.setUserStatus(u.id, next);
    } catch (e) {
      setUsers((xs) => xs.map((x) => (x.id === u.id ? { ...x, status: was } : x)));
      setError((e as Error).message || "Action failed");
    }
  };

  if (!isAdmin) {
    return (
      <div className="screen">
        <div className="nav-bar"><button className="nav-back" onClick={onBack}>Back</button><div className="nav-large">Admin</div></div>
        <div className="pad-x"><div className="card"><div className="empty-state">
          <div className="empty-icon"><ShieldAlert className="ic" /></div>
          <div className="empty-title">Not Authorized</div>
          <div className="empty-sub">Master account only</div>
        </div></div></div>
      </div>
    );
  }

  const serverNote = (
    <div className="pad-x"><div className="card"><div className="empty-state">
      <div className="empty-title">Live Data Needs the Admin Server</div>
      <div className="empty-sub">Usage + billing · Wired at launch</div>
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
          {/* UP-PLAT-04 (2026-09-06): the bill, not just the call count. A
              dash when nothing was measured or a model in the window has no
              price: an unpriced estimate is not an estimate. */}
          <div className="adm-tile"><div className="adm-num">{usage?.aiCost30d != null ? formatUSD(usage.aiCost30d) : "-"}</div><div className="adm-label">AI cost 30d</div></div>
        </div></div>
      )}

      {/* Per account, biggest first, only accounts that ran something, so a
          runaway is visible the day it starts instead of at the invoice. An
          empty list means nobody spent anything, which is why there is no
          row rather than a column of zeros. */}
      {source.available && !!usage?.spend?.length && (
        <>
          <div className="grp"><div className="eyebrow">AI Spend 30d</div></div>
          <div className="pad-x"><div className="card">
            {usage.spend.map((s) => (
              <div className="row" key={s.id}>
                <div className="row-grow">
                  <div className="conn-name">{s.email}</div>
                  <div className="conn-meta">{s.calls} {s.calls === 1 ? "call" : "calls"}</div>
                </div>
                <div className="conn-meta">{s.usd != null ? formatUSD(s.usd) : "Not priced"}</div>
              </div>
            ))}
          </div></div>
        </>
      )}

      <div className="grp"><div className="eyebrow">Billing</div></div>
      {!source.available ? serverNote : (
        <div className="pad-x"><div className="adm-grid">
          <div className="adm-tile"><div className="adm-num">{billing ? "$" + billing.mrr : "-"}</div><div className="adm-label">MRR</div></div>
          <div className="adm-tile"><div className="adm-num">{billing?.activeSubs ?? "-"}</div><div className="adm-label">Subscribers</div></div>
          <div className="adm-tile"><div className="adm-num">{billing?.trialing ?? "-"}</div><div className="adm-label">Trialing</div></div>
        </div></div>
      )}

      {/* UP-LAUNCH-17: the three questions the milestones are written in,
          answered from rows this app already writes. Every one of them is a
          dash rather than a zero when there is nobody to count yet: an
          invented number here is a decision made on a lie. */}
      <div className="grp"><div className="eyebrow">Metrics</div></div>
      {!source.available ? serverNote : metrics === null ? (
        <div className="pad-x"><div className="card"><div className="empty-state">
          <div className="empty-title">Metrics Are Not Loaded</div>
          <div className="empty-sub">This deploy has no metrics endpoint yet</div>
        </div></div></div>
      ) : (
        <>
          <div className="pad-x"><div className="adm-grid">
            <div className="adm-tile"><div className="adm-num">{pct(metrics.onboardingRate)}</div><div className="adm-label">Finished onboarding</div></div>
            <div className="adm-tile"><div className="adm-num">{metrics.weeklyActive}</div><div className="adm-label">Active this week</div></div>
            <div className="adm-tile"><div className="adm-num">{pct(metrics.d1)}</div><div className="adm-label">Came back next day{metrics.d1Basis ? " (" + metrics.d1Basis + ")" : ""}</div></div>
            <div className="adm-tile"><div className="adm-num">{pct(metrics.d7)}</div><div className="adm-label">Came back day 7{metrics.d7Basis ? " (" + metrics.d7Basis + ")" : ""}</div></div>
            <div className="adm-tile"><div className="adm-num">{metrics.aiCallsPerActive ?? "-"}</div><div className="adm-label">AI calls per active</div></div>
            <div className="adm-tile"><div className="adm-num">{metrics.signups7d}</div><div className="adm-label">Signups 7d</div></div>
          </div></div>
          <div className="pad-x"><div className="list-floor">
            {metrics.funnel.started} started intake · {metrics.funnel.finished} finished · {metrics.funnel.skipped} skipped
          </div></div>
          {metrics.truncated && (
            <div className="pad-x"><div className="list-floor">Too many days of history to walk, so the two return numbers are withheld rather than guessed</div></div>
          )}
        </>
      )}

      <div className="grp"><div className="eyebrow">Feedback{feedback?.length ? " (" + feedback.length + ")" : ""}</div></div>
      {!source.available ? serverNote : feedback === null ? (
        <div className="pad-x"><div className="card"><div className="empty-state">
          <div className="empty-title">Feedback Is Not Loaded</div>
          <div className="empty-sub">This deploy has no feedback endpoint yet</div>
        </div></div></div>
      ) : feedback.length === 0 ? (
        <div className="pad-x"><div className="card"><div className="empty-state"><div className="empty-title">Nothing Sent Yet</div></div></div></div>
      ) : (
        <div className="pad-x"><div className="card">
          {feedback.map((f) => (
            <div className="row" key={f.id}>
              <div className="row-grow">
                <div className="conn-name adm-feedback">{f.text}</div>
                <div className="conn-meta">{f.meta}{f.lastError ? " \u00b7 with the last error" : ""}</div>
              </div>
            </div>
          ))}
        </div></div>
      )}
      {feedback !== null && feedback.length >= 50 && (
        <div className="pad-x"><div className="list-floor">Showing the newest 50</div></div>
      )}

      <div className="grp"><div className="eyebrow">Users{users.length ? " (" + users.length + ")" : ""}</div></div>
      {!source.available ? serverNote : users.length === 0 ? (
        <div className="pad-x"><div className="card"><div className="empty-state"><div className="empty-title">No Users Yet</div></div></div></div>
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
