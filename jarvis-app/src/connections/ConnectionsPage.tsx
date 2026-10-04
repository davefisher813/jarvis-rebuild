import { useEffect, useState } from "react";
import { useSchedule, useProfile } from "../data/NotesProvider";
import { useGoogle } from "./google/GoogleSession";
import { googleConfigured } from "./google/config";
import { importCalendar } from "./google/sync";
import { Mail, CalendarDays, Link2, Plus } from "../shared/icons";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";
import { pressable } from "../shared/pressable";
import { useLeaveVia } from "../shell/navOrigin";
import { flagOn } from "../substrate/flags";

// Settings -> Connections (multi-account, 2026-08-04). Each Google account is
// its own row with its own feature toggles and its own disconnect. Adding an
// account opens Google's chooser; reconnecting a known one uses a login hint
// so the chooser stays out of the way. Honest "setup required" until a client
// id exists.
export const SIGNED_OUT_HELP = "Tap Reconnect to sign in again · Google asks once for access to Gmail, Calendar and Drive";

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

  // PLUMB-F-07 (2026-09-05): the import changes and removes events now, not
  // only adds them, so the receipt says all three. Silent on anything that
  // was zero, so a plain first connect still reads "Imported 12 events."
  const importLine = (s: { created: number; updated: number; removed: number }) => {
    const parts: string[] = [];
    if (s.created > 0) parts.push("Imported " + s.created + (s.created === 1 ? " event." : " events."));
    if (s.updated > 0) parts.push("Updated " + s.updated + (s.updated === 1 ? " event." : " events."));
    if (s.removed > 0) parts.push("Removed " + s.removed + (s.removed === 1 ? " cancelled event." : " cancelled events."));
    return parts.length > 0 ? " " + parts.join(" ") : "";
  };

  const addAccount = () => run(async () => {
    const { api, email } = await g.addAccount();
    return email + " connected." + importLine(await importCalendar(api, schedule));
  });

  // Reconnect one account: silent first, so on an account that is already
  // signed in it just refreshes the sign-in. Shared by the Reconnect chip and
  // the account row.
  const reconnectOne = (email: string, signedOut: boolean) => run(async () => {
    await g.reconnect(email);
    return email + (signedOut ? " reconnected." : " is connected.");
  });

  const reconnectAll = () => run(async () => {
    await g.connect();
    for (const { api } of g.apis("cal")) await importCalendar(api, schedule).catch(() => {});
    return "Connected.";
  });

  const leave = useLeaveVia("Settings", () => onBack?.());
  // The pixel is added by the legacy mail pump alone. The unified Email tab
  // (email_intake_v1) has no tracking code on its send path, so there the
  // switch would say on or off over a send that does neither (2026-10-04); it
  // is not shown rather than shown dead.
  const showTracking = g.accounts.some((a) => a.mail) && !flagOn("email_intake_v1");

  return (
    <div className="screen ruled">
      {/* BACK IS WHERE YOU CAME FROM (Dave 2026-09-21). This said "Settings"
          and it is mounted by the Settings flow, so the label was true about
          its parent and false about the journey: Email's own Connections row
          jumps straight here, and the only button on the page then took him
          to a screen he had not opened. */}
      <div className="nav-bar"><button className="nav-back" onClick={leave.onBack}>{leave.label}</button></div>
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
            // Row tap (Dave 2026-09-15, "I want all rows clickable"): there is no
            // account detail, so the row does the one safe verb, Reconnect.
            // Disconnect stays on its own armed chip.
            <div className="row" key={a.email} {...pressable(() => { if (!busy) void reconnectOne(a.email, signedOut); })}>
              <div className="proj-icon cat-bg-sky"><Mail className="ic" /></div>
              <div className="row-grow">
                <div className="conn-name truncate">{a.email}</div>
                {/* Per-account signed-out state (2026-08-09): one expired
                    account used to silently drop its mail from the unified
                    inbox with no reconnect anywhere; Reconnect All only
                    appeared when EVERY account was out. */}
                {signedOut && <div className="facts"><span className="fact warn">Signed out</span></div>}
                {/* Audit 2026-09-29: "Signed out" alone left no next step.
                    Same scopes as ever; this only says what Reconnect does. */}
                {signedOut && <div className="conn-meta">{SIGNED_OUT_HELP}</div>}
                {/* A connection nothing has stored is shown as what it is
                    (2026-09-29): it works now and is gone at the next launch,
                    which is not what "Connected" has ever promised here. */}
                {!signedOut && !g.connectionOf(a.email).durable && <div className="facts"><span className="fact warn">Temporary</span></div>}
                <div className="msg-chips conn-acct-chips">
                  {signedOut && (
                    <button className="chip on" disabled={busy}
                      onClick={(ev) => { ev.stopPropagation(); void reconnectOne(a.email, true); }}>Reconnect</button>
                  )}
                  <button className={"chip" + (a.mail ? " on" : "")} disabled={busy}
                    onClick={(ev) => { ev.stopPropagation(); void toggleFeature(a.email, "mail", !a.mail); }}>Email</button>
                  <button className={"chip" + (a.cal ? " on" : "")} disabled={busy}
                    onClick={(ev) => { ev.stopPropagation(); void toggleFeature(a.email, "cal", !a.cal); }}>Calendar</button>
                  {/* NO DRIVE CHIP (2026-10-04). It stored a flag that nothing
                      read: Grant Access still only opens Google's own request
                      page and no code calls Drive, so the chip was a switch
                      wired to nothing. The stored field stays readable in the
                      profile for the day a Drive call exists. */}
                  {/* Armed two-tap (2026-08-09): disconnect sat one accidental
                      tap away, styled like the harmless toggles beside it. */}
                  <button className="chip" disabled={busy}
                    onClick={(ev) => {
                      ev.stopPropagation();
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

      {(g.accounts.some((a) => a.cal) || showTracking) && <div className="sh2 sh2-quiet"><span className="t">What Flows In</span></div>}
      {g.accounts.some((a) => a.cal) && (
        <div className="pad-x"><div className="card list-card-ruled"><div className="row">
          <div className="proj-icon cat-bg-sky"><CalendarDays className="ic" /></div>
          <div className="row-grow">
            <div className="conn-name">Calendar Import</div>
            <div className="conn-meta">Events flow into Schedule</div>
          </div>
        </div></div></div>
      )}

      {showTracking && (
        <div className="pad-x"><div className="card list-card-ruled conn-mail-card"><div className="row" {...pressable(() => { if (!busy) void toggleTrackOpens(); })}>
          <div className="row-grow">
            <div className="conn-name">Know When Your Email Is Opened</div>
            <div className="conn-meta">Read receipts on sent mail, which power Opened</div>
          </div>
          <button
            className={"switch" + (trackOpens ? "" : " off")}
            role="switch"
            aria-checked={trackOpens}
            aria-label="Know When Your Email Is Opened"
            disabled={busy}
            onClick={(ev) => { ev.stopPropagation(); void toggleTrackOpens(); }}
          />
        </div></div></div>
      )}

      {status && <div className="pad-x conn-status">{status}</div>}
      {error && <div className="pad-x conn-error">{error}</div>}
      <div className="screen-foot" />
    </div>
  );
}
