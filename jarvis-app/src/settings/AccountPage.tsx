import { useEffect, useState } from "react";
import { useProfile } from "../data/NotesProvider";
import type { ProfileData } from "../profile/types";
import LargeTitleNav from "../shared/LargeTitleNav";

const BACK = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>;

export default function AccountPage({ onBack, onEditProfile, onSignOut }: { onBack: () => void; onEditProfile?: () => void; onSignOut?: () => void }) {
  const svc = useProfile();
  const [p, setP] = useState<ProfileData | null>(null);
  useEffect(() => { void svc.get().then(setP); }, [svc]);
  // Redo Setup arms on the first tap and fires on the second, replacing the
  // window.confirm dialog (audit 2026-08-07): a native popup in an app that
  // otherwise never uses one, over an action that is not even destructive.
  // Same armed pattern as the schedule's Running Late control; disarms itself
  // so a stray tap can never leave a loaded button waiting.
  const [redoArmed, setRedoArmed] = useState(false);
  useEffect(() => {
    if (!redoArmed) return;
    const id = setTimeout(() => setRedoArmed(false), 4000);
    return () => clearTimeout(id);
  }, [redoArmed]);
  const initial = (p?.name?.trim()?.[0] ?? "?").toUpperCase();
  const tmpl = p?.template ? p.template[0]!.toUpperCase() + p.template.slice(1) : "Personal";
  return (
    <div className="screen">
      <LargeTitleNav title="Account" back="Settings" onBack={onBack} />
      <div className="pad-x"><div className="card account-hero">
        <div className="av av-72 av-accent">{initial}</div>
        <div className="account-name">{p?.name || "Your name"}</div>
        <div className="account-sub">{tmpl} plan</div>
      </div></div>
      <div className="grp"><div className="eyebrow">Account</div></div>
      <div className="pad-x"><div className="card">
        {onEditProfile && (
          <div className="row" role="button" tabIndex={0} onClick={onEditProfile}>
            <div className="row-grow"><div className="conn-name">Edit Profile</div></div>
            <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </div>
        )}
        <div className="row"><div className="row-grow"><div className="conn-name">Template</div></div><span className="row-value">{tmpl}</span></div>
        <div className="row"><div className="row-grow"><div className="conn-name">Status</div></div><span className="row-value">Active</span></div>
        <div className="row" role="button" tabIndex={0} onClick={async () => {
          if (!redoArmed) { setRedoArmed(true); return; }
          await svc.save({ onboarded: false });
          window.location.reload();
        }}>
          <div className="row-grow">
            <div className="conn-name">{redoArmed ? "Tap again to redo setup" : "Redo Setup"}</div>
            {redoArmed && <div className="conn-meta">Your data stays. You'll answer the intake questions again.</div>}
          </div>
          <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </div>
      </div></div>
      {onSignOut && <div className="pad-x"><div className="card"><button className="row row-signout" onClick={onSignOut}>Sign Out</button></div></div>}
    </div>
  );
}
