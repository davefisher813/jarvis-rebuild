import { useEffect, useState } from "react";
import { useSchedule, useProfile } from "../data/NotesProvider";
import { useGoogle } from "./google/GoogleSession";
import { googleConfigured } from "./google/config";
import { importCalendar } from "./google/sync";
import { Mail, CalendarDays, Link2, Plus } from "../shared/icons";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";

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
  const profile = useProfile();
  // Open tracking made visible (2026-08-09): the pixel rode on every send
  // with no disclosure and no way off. Default stays on (that is what the
  // app always did); the switch and the privacy-policy line are the fix.
  const [trackOpens, setTrackOpens] = useState(true);
  useEffect(() => {
    let on = true;
    profile.get().then((p) => { if (on) setTrackOpens(p?.trackOpens !== false); });
    return () => { on = false; };
  }, [profile]);
  const [busy, setBusy] = useState(false);
  const [armDisc, setArmDisc] = useState<string | null>(null);
  useEffect(() => {
    if (!armDisc) return;
    const id = setTimeout(() => setArmDisc(null), 4000);
    return () => clearTimeout(id);
  }, [armDisc]);
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

  // PLUMB-F-16 (2026-09-05): the chips and the tracking switch were the only
  // controls on this page that did not go through run(). They fired the write
  // and forgot it, so a save that failed offline or on a token blip left the
  // new state on screen, said nothing, and was gone on the next open. For the
  // tracking switch that meant a pixel he believed he had turned off still
  // riding on every send. Both go through run() now, and both put the control
  // back where it was when the write does not land. The page already has its
  // own error line, so the failure rides that instead of a toast, wearing the
  // app's one standard sentence for a write that did not land.
  const toggleFeature = (email: string, key: "mail" | "cal", on: boolean) => run(async () => {
    // GoogleSession.persist reverts its own optimistic update on failure, so
    // the chip follows the account list back.
    try {
      await g.setFeature(email, key, on);
    } catch {
      throw new Error(WRITE_FAILED_MESSAGE);
    }
    // No receipt on success: the chip's own state is the receipt.
    return null;
  });

  const toggleTrackOpens = () => run(async () => {
    const next = !trackOpens;
    setTrackOpens(next);
    try {
      await profile.save({ trackOpens: next });
    } catch {
      setTrackOpens(!next);
      throw new Error(WRITE_FAILED_MESSAGE);
    }
    return null;
  });

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
    <div className="screen ruled">
      <div className="nav-bar"><button className="nav-back" onClick={onBack}>Settings</button></div>
      <div className="nav-large">Connections</div>

      {!configured && (
        <div className="pad-x"><div className="card list-card-ruled"><div className="empty-state">
          <div className="empty-icon"><Link2 className="ic" /></div>
          <div className="empty-title">Google Setup Required</div>
          <div className="empty-sub">Needs Google setup first</div>
        </div></div></div>
      )}

      <div className="sh2 sh2-quiet"><span className="t">Google Accounts</span>{g.accounts.length > 0 && <span className="n">{g.accounts.length}</span>}</div>
      {g.accounts.length === 0 ? (
        <div className="pad-x"><div className="card list-card-ruled"><div className="empty-state">
          <div className="empty-icon"><Mail className="ic" /></div>
          <div className="empty-title">No Accounts Yet</div>
        </div></div></div>
      ) : (
        <div className="pad-x"><div className="card list-card-ruled">
          {g.accounts.map((a) => {
            const signedOut = !g.tokenEmails.includes(a.email);
            return (
            <div className="row" key={a.email}>
              <div className="proj-icon cat-bg-sky"><Mail className="ic" /></div>
              <div className="row-grow">
                <div className="conn-name truncate">{a.email}</div>
                {/* Per-account signed-out state (2026-08-09): one expired
                    account used to silently drop its mail from the unified
                    inbox with no reconnect anywhere; Reconnect All only
                    appeared when EVERY account was out. */}
                {signedOut && <div className="conn-meta">Signed out · Reconnect for mail + events</div>}
                <div className="msg-chips conn-acct-chips">
                  {signedOut && (
                    <button className="chip on" disabled={busy}
                      onClick={() => void run(async () => { await g.reconnect(a.email); return a.email + " reconnected."; })}>Reconnect</button>
                  )}
                  <button className={"chip" + (a.mail ? " on" : "")} disabled={busy}
                    onClick={() => void toggleFeature(a.email, "mail", !a.mail)}>Email</button>
                  <button className={"chip" + (a.cal ? " on" : "")} disabled={busy}
                    onClick={() => void toggleFeature(a.email, "cal", !a.cal)}>Calendar</button>
                  {/* Armed two-tap (2026-08-09): disconnect sat one accidental
                      tap away, styled like the harmless toggles beside it. */}
                  <button className="chip" disabled={busy}
                    onClick={() => {
                      if (armDisc !== a.email) { setArmDisc(a.email); return; }
                      setArmDisc(null);
                      void run(async () => { await g.disconnect(a.email); return a.email + " disconnected."; });
                    }}>
                    {armDisc === a.email ? "Tap again" : "Disconnect"}
                  </button>
                </div>
              </div>
            </div>
            );
          })}
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

      {(g.accounts.some((a) => a.cal) || g.accounts.some((a) => a.mail)) && <div className="sh2 sh2-quiet"><span className="t">What Flows In</span></div>}
      {g.accounts.some((a) => a.cal) && (
        <div className="pad-x"><div className="card list-card-ruled"><div className="row">
          <div className="proj-icon cat-bg-sky"><CalendarDays className="ic" /></div>
          <div className="row-grow">
            <div className="conn-name">Calendar Import</div>
            <div className="conn-meta">Events flow into Schedule</div>
          </div>
        </div></div></div>
      )}

      {g.accounts.some((a) => a.mail) && (
        <div className="pad-x"><div className="card list-card-ruled conn-mail-card"><div className="row">
          <div className="row-grow">
            <div className="conn-name">Know When Your Email Is Opened</div>
            <div className="conn-meta">Read receipts on sent mail · Powers Opened</div>
          </div>
          <button
            className={"switch" + (trackOpens ? "" : " off")}
            role="switch"
            aria-checked={trackOpens}
            aria-label="Know When Your Email Is Opened"
            disabled={busy}
            onClick={() => void toggleTrackOpens()}
          />
        </div></div></div>
      )}

      {status && <div className="pad-x conn-status">{status}</div>}
      {error && <div className="pad-x conn-error">{error}</div>}
      <div className="screen-foot" />
    </div>
  );
}
