import { useState } from "react";
import { useSchedule } from "../data/NotesProvider";
import { useGoogle } from "./google/GoogleSession";
import { googleConfigured } from "./google/config";
import { importCalendar } from "./google/sync";
import { Mail, CalendarDays, Link2, Plus } from "lucide-react";

// Settings -> Connections (multi-account, 2026-08-04). Each Google account is
// its own row with its own feature toggles and its own disconnect. Adding an
// account opens Google's chooser; reconnecting a known one uses a login hint
// so the chooser stays out of the way. Honest "setup required" until a client
// id exists.
export default function ConnectionsPage({
  onBack,
  configured = googleConfigured(),
}: {
  onBack?: () => void;
  configured?: boolean;
}) {
  const g = useGoogle();
  const schedule = useSchedule();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<string | null>) => {
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      setStatus(await work());
    } catch (e) {
      setError((e as Error).message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const addAccount = () => run(async () => {
    const { api, email } = await g.addAccount();
    const n = await importCalendar(api, schedule);
    return email + " connected." + (n > 0 ? " Imported " + n + (n === 1 ? " event." : " events.") : "");
  });

  const reconnectAll = () => run(async () => {
    await g.connect();
    for (const { api } of g.apis("cal")) await importCalendar(api, schedule).catch(() => {});
    return "Connected.";
  });

  return (
    <div className="screen">
      <div className="nav-bar"><button className="nav-back" onClick={onBack}>Settings</button></div>
      <div className="nav-large">Connections</div>

      {!configured && (
        <div className="pad-x"><div className="card"><div className="empty-state">
          <div className="empty-icon"><Link2 className="ic" /></div>
          <div className="empty-title">Google setup required</div>
          <div className="empty-sub">A Google sign-in client must be configured before Gmail and Calendar can connect.</div>
        </div></div></div>
      )}

      <div className="grp"><div className="eyebrow">Google Accounts</div></div>
      {g.accounts.length === 0 ? (
        <div className="pad-x"><div className="card"><div className="empty-state">
          <div className="empty-icon"><Mail className="ic" /></div>
          <div className="empty-title">No accounts yet</div>
        </div></div></div>
      ) : (
        <div className="pad-x"><div className="card">
          {g.accounts.map((a) => (
            <div className="row" key={a.email}>
              <div className="proj-icon cat-bg-sky"><Mail className="ic" /></div>
              <div className="row-grow">
                <div className="conn-name truncate">{a.email}</div>
                <div className="msg-chips conn-acct-chips">
                  <button className={"chip" + (a.mail ? " on" : "")} disabled={busy}
                    onClick={() => void g.setFeature(a.email, "mail", !a.mail)}>Email</button>
                  <button className={"chip" + (a.cal ? " on" : "")} disabled={busy}
                    onClick={() => void g.setFeature(a.email, "cal", !a.cal)}>Calendar</button>
                  <button className="chip" disabled={busy}
                    onClick={() => void run(async () => { await g.disconnect(a.email); return a.email + " disconnected."; })}>
                    Disconnect
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div></div>
      )}

      <div className="pad-x conn-action">
        <button className="btn btn-primary btn-block" disabled={!configured || busy} onClick={addAccount}>
          <Plus className="ic" /> {busy ? "Connecting..." : g.accounts.length === 0 ? "Connect Google" : "Add Google Account"}
        </button>
        {g.accounts.length > 0 && !g.hasToken && (
          <button className="btn btn-secondary btn-block" disabled={busy} onClick={reconnectAll}>
            Reconnect All
          </button>
        )}
      </div>

      {g.accounts.some((a) => a.cal) && (
        <div className="pad-x"><div className="card"><div className="row">
          <div className="proj-icon cat-bg-sky"><CalendarDays className="ic" /></div>
          <div className="row-grow">
            <div className="conn-name">Calendar import</div>
            <div className="conn-meta">Upcoming events flow into the Schedule on every connect</div>
          </div>
        </div></div></div>
      )}

      {status && <div className="pad-x conn-status">{status}</div>}
      {error && <div className="pad-x conn-error">{error}</div>}
    </div>
  );
}
