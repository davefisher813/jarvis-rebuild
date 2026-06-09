import { useState } from "react";
import { useSchedule } from "../data/NotesProvider";
import { useGoogle } from "./google/GoogleSession";
import { googleConfigured } from "./google/config";
import { importCalendar, listMail } from "./google/sync";
import type { MailRow } from "./google/map";
import { Mail, CalendarDays, Link2 } from "lucide-react";

// Settings -> Connections. Uses the shared Google session, so connecting here
// also powers the Messages tab. Honest "setup required" until a client id exists.
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
  const [mail, setMail] = useState<MailRow[]>([]);

  const connect = async () => {
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      const api = await g.connect();
      const n = await importCalendar(api, schedule);
      setMail(await listMail(api));
      setStatus("Connected. Imported " + n + (n === 1 ? " event." : " events."));
    } catch (e) {
      setError((e as Error).message || "Could not connect");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    await g.disconnect();
    setMail([]);
    setStatus(null);
    setError(null);
  };

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

      <div className="grp"><div className="eyebrow">Google</div></div>
      <div className="pad-x"><div className="card">
        <div className="row">
          <div className="proj-icon cat-bg-sky"><CalendarDays className="ic" /></div>
          <div className="conn-name">Google Calendar</div>
          <span className="conn-meta">{g.connected ? "Connected" : "Read-only"}</span>
        </div>
        <div className="row">
          <div className="proj-icon cat-bg-red"><Mail className="ic" /></div>
          <div className="conn-name">Gmail</div>
          <span className="conn-meta">{g.connected ? "Connected" : "Read + send"}</span>
        </div>
      </div></div>

      <div className="pad-x conn-action">
        {!g.connected ? (
          <button className="btn btn-primary btn-block" disabled={!configured || busy} onClick={connect}>
            {busy ? "Connecting..." : "Connect Google"}
          </button>
        ) : (
          <button className="btn btn-secondary btn-block" disabled={busy} onClick={disconnect}>Disconnect</button>
        )}
      </div>

      {status && <div className="pad-x conn-status">{status}</div>}
      {error && <div className="pad-x conn-error">{error}</div>}

      {mail.length > 0 && (
        <>
          <div className="grp"><div className="eyebrow">Recent mail</div></div>
          <div className="pad-x"><div className="card">
            {mail.map((m) => (
              <div className="row" key={m.id}>
                <div className="proj-icon cat-bg-red"><Mail className="ic" /></div>
                <div className="row-grow"><div className="conn-name">{m.subject}</div><div className="conn-meta">{m.from}</div></div>
              </div>
            ))}
          </div></div>
        </>
      )}
    </div>
  );
}
