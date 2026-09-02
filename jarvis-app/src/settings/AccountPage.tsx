import { useEffect, useState } from "react";
import { useProfile } from "../data/NotesProvider";
import type { ProfileData } from "../profile/types";
import LargeTitleNav from "../shared/LargeTitleNav";
import { Head, Card, Row, DangerRow } from "./kit";

export default function AccountPage({ onBack, onEditProfile, onSignOut }: { onBack: () => void; onEditProfile?: () => void; onSignOut?: () => void }) {
  const svc = useProfile();
  const [p, setP] = useState<ProfileData | null>(null);
  useEffect(() => { void svc.get().then(setP); }, [svc]);
  // Armed two-tap (2026-08-09): Redo Setup used to fire on one tap and drop
  // him into intake with no way to say "I didn't mean that". Arms for four
  // seconds, then relaxes.
  const [redoArmed, setRedoArmed] = useState(false);
  useEffect(() => {
    if (!redoArmed) return;
    const id = setTimeout(() => setRedoArmed(false), 4000);
    return () => clearTimeout(id);
  }, [redoArmed]);
  const initial = (p?.name?.trim()?.[0] ?? "?").toUpperCase();
  const tmpl = p?.template ? p.template[0]!.toUpperCase() + p.template.slice(1) : "Personal";
  return (
    <div className="screen ruled">
      <LargeTitleNav title="Account" back="Settings" onBack={onBack} />
      <div className="pad-x"><div className="card list-card-ruled set-card account-hero">
        <div className="av av-72 av-accent">{initial}</div>
        <div className="account-name">{p?.name || "Your name"}</div>
        <div className="account-sub">{tmpl} plan</div>
      </div></div>
      <Head label="Account" />
      <Card>
        {onEditProfile && <Row label="Edit Profile" onClick={onEditProfile} chev />}
        <Row label="Template" value={tmpl} />
        <Row label="Status" value="Active" />
        <Row label={redoArmed ? "Tap again to redo setup" : "Redo Setup"} meta={redoArmed ? "Your data stays · Intake runs again" : undefined} chev
          onClick={async () => {
            if (!redoArmed) { setRedoArmed(true); return; }
            await svc.save({ onboarded: false });
            window.location.reload();
          }} />
      </Card>
      {onSignOut && <div className="set-gap"><Card><DangerRow label="Sign Out" onClick={onSignOut} /></Card></div>}
      <div className="screen-foot" />
    </div>
  );
}
