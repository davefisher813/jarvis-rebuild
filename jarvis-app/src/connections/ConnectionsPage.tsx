import { useEffect, useState } from "react";
import { useSchedule, useProfile } from "../data/NotesProvider";
import { useGoogle } from "./google/GoogleSession";
import { googleConfigured } from "./google/config";
import { importCalendar } from "./google/sync";
import { Mail, CalendarDays, Link2, RotateCcw } from "../shared/icons";
import { FormSheet, Group, SwitchRow, Row as SheetRow, DeleteRow } from "../shared/FormSheet";
import RowCtxAction from "../shared/RowCtxAction";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";
import { pressable } from "../shared/pressable";
import { useLeaveVia } from "../shell/navOrigin";
import { flagOn } from "../substrate/flags";
import PageHeader from "../shared/PageHeader";

// Settings -> Connections (multi-account, 2026-08-04). Each Google account is
// its own row with its own feature toggles and its own disconnect. Adding an
// account opens Google's chooser; reconnecting a known one uses a login hint
// so the chooser stays out of the way. Honest "setup required" until a client
// id exists.
// 2026-10-05 (the catalog gate, Dave "I am sick of this"). This line had a
// middle dot typed into it and rendered in the row's meta line (§AM F3: the
// separator is the stylesheet's, never a character in a string), it was
// sentence case, and its first half ("Tap Reconnect to sign in again") said
// what the Reconnect chip beside it, and the row's own tap, already are. What
// is left is the one thing the row does not say: what Google will ask for.
export const SIGN_IN_SOON = "Google Sign-In Opens Soon";
export const SIGNED_OUT_HELP = "Google Asks Once for Access to Gmail, Calendar and Drive";

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
  // THE ACCOUNT'S SHEET (Dave 2026-10-05, locked: tap a row, its sheet holds every action; no chip or pill on a row).
  // Email and Calendar are switches (state, not commands), Reconnect and Disconnect are its action rows.
  const [sheetEmail, setSheetEmail] = useState<string | null>(null);

  const run = async (work: () => Promise<string | null>) => {
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      setStatus(await work());
    } catch (e) {
      setError((e as Error).message || "Something Went Wrong");
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
    if (s.created > 0) parts.push("Imported " + s.created + (s.created === 1 ? " Event" : " Events"));
    if (s.updated > 0) parts.push("Updated " + s.updated + (s.updated === 1 ? " Event" : " Events"));
    if (s.removed > 0) parts.push("Removed " + s.removed + (s.removed === 1 ? " Cancelled Event" : " Cancelled Events"));
    // Fragments joined by a dot, Title Case, no full stops: the receipt used
    // to read "Imported 12 events. Updated 2 events." (2026-10-05).
    return parts.length > 0 ? " \u00b7 " + parts.join(" \u00b7 ") : "";
  };

  const addAccount = () => run(async () => {
    const { api, email } = await g.addAccount();
    return email + " Connected" + importLine(await importCalendar(api, schedule));
  });

  // Reconnect one account: silent first, so on an account that is already
  // signed in it just refreshes the sign-in. Shared by the Reconnect chip and
  // the account row.
  const reconnectOne = (email: string, signedOut: boolean) => run(async () => {
    await g.reconnect(email);
    return email + (signedOut ? " Reconnected" : " Connected");
  });

  const reconnectAll = () => run(async () => {
    await g.connect();
    for (const { api } of g.apis("cal")) await importCalendar(api, schedule).catch(() => {});
    return "Connected";
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
      {/* THE SAME HEADER AS EVERY OTHER SETTINGS PAGE (2026-10-05, Dave "everything should look perfect": this page drew its own
          nav-bar and nav-large, a taller bar in a different shade with no title rule). The back label stays where he came from. */}
      <PageHeader title="Connections" back={leave.label} onBack={leave.onBack} />

      {/* THE ACCOUNTS HEAD HOLDS THE SECTION'S ACTIONS (Dave 2026-10-05, locked: a section-level action lives in the
          head, never at the foot of a list): Add Account, and Reconnect All once every account has signed out. With no
          account yet the screen's one filled primary (Connect Google) is the way in, and stays. */}
      <div className="sh2 sh2-quiet"><span className="t">Google Accounts</span>{g.accounts.length > 0 && <span className="n">{g.accounts.length}</span>}
        {g.accounts.length > 0 && (
          <span className="sec-left">
            {!g.hasToken && <button className="see-all pill-action" disabled={busy} onClick={reconnectAll}>Reconnect All</button>}
            <button className="see-all pill-action" disabled={!configured || busy} onClick={addAccount}>{busy ? "Connecting" : "Add Account"}</button>
          </span>
        )}
        {/* THE ONE CAPSULE OF AN EMPTY SCREEN IS THE HEAD'S (D9, the round 2 review): with no account yet, Connect Google is the way in, drawn in the head
            like every other empty screen's capsule and not as a filled block under the words. With no Google client there is nothing to tap, so no capsule. */}
        {/* ... AND IT IS THERE BEFORE SIGN-IN OPENS TOO (the ship-blocker review, 2026-10-05: "a dead-end empty state with no action"). The
            capsule is drawn whether or not this build has a Google client; with none, its tap answers in one warm line instead of opening a
            sign-in that cannot work, so the screen always shows its one verb and never a blank. */}
        {g.accounts.length === 0 && (
          <button className="see-all pill-action" disabled={busy}
            onClick={configured ? addAccount : () => { setError(null); setStatus(SIGN_IN_SOON); }}>
            {busy ? "Connecting" : "Connect Google"}
          </button>
        )}
      </div>
      {/* THE ONE EMPTY STATE (D9, the round 2 review: Connections drew its empty state inside a card while Email Sections and What JARVIS Learned drew
          theirs bare, at three different heights). A screen that is empty says so with the app's one primitive: the glyph in its type's colour, a Title Case
          title, ONE warm line, bare under the head it belongs to. No card, and no engineering vocabulary: with no Google client in this build there is
          nothing to tap, so it says plainly that sign-in is on its way, and the capsule appears in the head the moment there is something to do. */}
      {g.accounts.length === 0 ? (
        !configured ? (
          <div className="empty-state empty-compact">
            <div className="empty-icon cat-fg-blue"><Link2 className="ic" /></div>
            <div className="empty-title">Google Is Not Connected Yet</div>
            <div className="empty-sub">Mail and Calendar Join Once Sign-In Opens</div>
          </div>
        ) : (
          <div className="empty-state empty-compact">
            <div className="empty-icon cat-fg-teal"><Mail className="ic" /></div>
            <div className="empty-title">No Accounts Yet</div>
            <div className="empty-sub">Connect Google to Bring in Mail and Calendar</div>
          </div>
        )
      ) : (
        <div className="pad-x"><div className="card list-card-ruled">
          {g.accounts.map((a) => {
            const signedOut = !g.tokenEmails.includes(a.email);
            return (
            // The whole row is the door (Dave 2026-09-15, "I want all rows clickable"): it opens the account's sheet.
            <div className="row" key={a.email} {...pressable(() => setSheetEmail(a.email))}>
              {/* Mail is teal in the key (§AQ: Person / Mail); sky is Event (2026-10-05). */}
              <div className="proj-icon cat-bg-teal"><Mail className="ic" /></div>
              <div className="row-grow">
                <div className="conn-name truncate">{a.email}</div>
                {/* Per-account signed-out state (2026-08-09): one expired
                    account used to silently drop its mail from the unified
                    inbox with no reconnect anywhere; Reconnect All only
                    appeared when EVERY account was out. */}
                {signedOut && <div className="facts"><span className="fact warn">Signed Out</span></div>}
                {/* Audit 2026-09-29: "Signed out" alone left no next step.
                    Same scopes as ever; this only says what Reconnect does. */}
                {signedOut && <div className="conn-meta">{SIGNED_OUT_HELP}</div>}
                {/* A connection nothing has stored is shown as what it is
                    (2026-09-29): it works now and is gone at the next launch,
                    which is not what "Connected" has ever promised here. */}
                {!signedOut && !g.connectionOf(a.email).durable && <div className="facts"><span className="fact warn">Temporary</span></div>}
              </div>
              {/* ITS MOMENT HAS COME (Dave 2026-10-05): a signed-out account quietly shows its one verb, as text. */}
              <RowCtxAction when={signedOut && !busy} label="Reconnect" ariaLabel={"Reconnect " + a.email} onAct={() => void reconnectOne(a.email, true)} />
            </div>
            );
          })}
        </div></div>
      )}

      {(g.accounts.some((a) => a.cal) || showTracking) && <div className="sh2 sh2-quiet"><span className="t">What Flows In</span></div>}
      {g.accounts.some((a) => a.cal) && (
        <div className="pad-x"><div className="card list-card-ruled"><div className="row">
          <div className="proj-icon cat-bg-sky"><CalendarDays className="ic" /></div>
          <div className="row-grow">
            <div className="conn-name">Calendar Import</div>
            <div className="conn-meta">Events Flow Into Schedule</div>
          </div>
        </div></div></div>
      )}

      {showTracking && (
        <div className="pad-x"><div className="card list-card-ruled conn-mail-card"><div className="row" {...pressable(() => { if (!busy) void toggleTrackOpens(); })}>
          <div className="row-grow">
            <div className="conn-name">Know When Your Email Is Opened</div>
            <div className="conn-meta">Read Receipts on Sent Mail, Which Power Opened</div>
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

      {(() => {
        const a = sheetEmail ? g.accounts.find((x) => x.email === sheetEmail) : undefined;
        if (!a) return null;
        const signedOut = !g.tokenEmails.includes(a.email);
        return (
          <FormSheet title="Google Account" onCancel={() => { setSheetEmail(null); setArmDisc(null); }} onSave={() => { setSheetEmail(null); setArmDisc(null); }} saveLabel="Done">
            <Group label={a.email}>
              <SwitchRow tone="teal" glyph={<Mail className="ic" />} label="Email" ariaLabel={"Email for " + a.email}
                on={a.mail} onToggle={() => { if (!busy) void toggleFeature(a.email, "mail", !a.mail); }} />
              <SwitchRow tone="sky" glyph={<CalendarDays className="ic" />} label="Calendar" ariaLabel={"Calendar for " + a.email}
                on={a.cal} onToggle={() => { if (!busy) void toggleFeature(a.email, "cal", !a.cal); }} />
              {/* NO DRIVE SWITCH (2026-10-04). It stored a flag that nothing
                  read: Grant Access still only opens Google's own request
                  page and no code calls Drive, so it was a switch wired to
                  nothing. The stored field stays readable in the profile for
                  the day a Drive call exists. */}
            </Group>
            <Group className="xs-actions">
              <SheetRow tone="blue" glyph={<RotateCcw className="ic" />} label={signedOut ? "Reconnect" : "Sign In Again"} chev
                onClick={() => { if (!busy) { setSheetEmail(null); void reconnectOne(a.email, signedOut); } }} />
            </Group>
            {/* Armed two-tap (2026-08-09): disconnect sat one accidental tap away, styled like the harmless toggles beside it. */}
            <Group className="xs-actions">
              <DeleteRow label={armDisc === a.email ? "Tap Again to Disconnect" : "Disconnect"}
                onClick={() => {
                  if (busy) return;
                  if (armDisc !== a.email) { setArmDisc(a.email); return; }
                  setArmDisc(null);
                  setSheetEmail(null);
                  void run(async () => { await g.disconnect(a.email); return a.email + " Disconnected"; });
                }} />
            </Group>
          </FormSheet>
        );
      })()}
      {status && <div className="pad-x conn-status">{status}</div>}
      {error && <div className="pad-x conn-error">{error}</div>}
      <div className="screen-foot" />
    </div>
  );
}
