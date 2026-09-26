import { useEffect, useRef, useState } from "react";
import { useProfile } from "../data/NotesProvider";
import { useAuth } from "../auth/AuthProvider";
import type { ProfileData } from "../profile/types";
import LargeTitleNav from "../shared/LargeTitleNav";
import { backendConfigured } from "../data/store";
import { Head, Card, Row, DangerRow, Foot } from "./kit";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import RowActionSheet from "../shared/RowActionSheet";
import { avatarFromFile, announceAvatar } from "../profile/avatarPhoto";

export default function AccountPage({ onBack, onEditProfile, onSignOut }: { onBack: () => void; onEditProfile?: () => void; onSignOut?: () => void }) {
  const svc = useProfile();
  const { deleteAccount } = useAuth();
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

  // S3-Q18 (2026-09-04): Sign Out used to fire on one unguarded tap while
  // Redo Setup right above it was already an armed two-tap -- same screen,
  // same red row styling, two different levels of protection. Same pattern,
  // same four seconds, now.
  const [signOutArmed, setSignOutArmed] = useState(false);
  useEffect(() => {
    if (!signOutArmed) return;
    const id = setTimeout(() => setSignOutArmed(false), 4000);
    return () => clearTimeout(id);
  }, [signOutArmed]);

  // S3-Q18: there was no way to delete an account at all, though the Privacy
  // Policy already promises "request deletion of your account." Armed the
  // same way -- this is the one action on this screen an undo can never
  // reach.
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  useEffect(() => {
    if (!deleteArmed) return;
    const id = setTimeout(() => setDeleteArmed(false), 4000);
    return () => clearTimeout(id);
  }, [deleteArmed]);
  const runDelete = async () => {
    if (!deleteArmed) { setDeleteArmed(true); setDeleteError(""); return; }
    setDeleteArmed(false);
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteAccount();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Couldn't delete your account · Try again");
    } finally {
      setDeleteBusy(false);
    }
  };
  // THE DISC IS A TAP (Dave's pick, 2026-09-26: "your avatar keeps its
  // brand-red disc, and it is a tap"). It opens the app's one action sheet
  // (RowActionSheet): Choose Photo, Remove Photo when there is one, Cancel.
  // Choose Photo opens the system picker through a hidden file input; the
  // photo is cut to a 256px square on the phone and saved on the profile.
  const [photoSheet, setPhotoSheet] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const photo = p?.avatar ?? "";
  const savePhoto = async (next: string): Promise<boolean> => {
    const ok = await attemptWrite(async () => setP(await svc.save({ avatar: next })));
    if (!ok) return false;
    announceAvatar(next);
    return true;
  };
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    let next: string;
    try { next = await avatarFromFile(file); } catch {
      showToast({ message: "Couldn't read that photo · Try another" });
      return;
    }
    await savePhoto(next);
  };
  const removePhoto = async () => {
    const was = photo;
    if (!(await savePhoto(""))) return;
    showToast({ message: "Photo removed", actionLabel: "Undo", onAction: () => { void savePhoto(was); } });
  };
  const initial = (p?.name?.trim()?.[0] ?? "?").toUpperCase();
  const tmpl = p?.template ? p.template[0]!.toUpperCase() + p.template.slice(1) : "Personal";
  return (
    <div className="screen ruled">
      <LargeTitleNav title="Account" back="Settings" onBack={onBack} />
      <div className="pad-x"><div className="card list-card-ruled set-card account-hero">
        <button type="button" className="account-av" aria-haspopup="dialog"
          aria-label={photo ? "Change profile photo" : "Add profile photo"} onClick={() => setPhotoSheet(true)}>
          <div className="av av-72 av-accent">{photo ? <img className="av-photo" src={photo} alt="" /> : initial}</div>
        </button>
        <input ref={fileRef} type="file" accept="image/*" hidden aria-label="Profile photo"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void onFile(f); }} />
        <div className="account-name">{p?.name || "Your name"}</div>
        <div className="account-sub">{tmpl} plan</div>
      </div></div>
      <Head label="Account" />
      <Card>
        {onEditProfile && <Row label="Edit Profile" onClick={onEditProfile} chev />}
        <Row label="Template" value={tmpl} />
        {/* B4 (2026-09-04): "Active" was a literal string, true only by
            coincidence when a real account exists. This page also renders in
            the no-backend local/demo build (App.tsx), where there is no
            account to be active, so the honest value follows the same signal
            BackupPage uses. */}
        <Row label="Status" value={backendConfigured ? "Active" : "Local"} />
        <Row label={redoArmed ? "Tap again to redo setup" : "Redo Setup"} meta={redoArmed ? "Your data stays" : undefined} chev
          onClick={async () => {
            if (!redoArmed) { setRedoArmed(true); return; }
            // SHELL-F-14 (2026-09-05): this write had no catch, so a failed
            // save reloaded the app straight back into the same screen with
            // nothing to explain why intake had not started.
            const ok = await attemptWrite(() => svc.save({ onboarded: false }));
            if (!ok) return;
            window.location.reload();
          }} />
      </Card>
      {onSignOut && (
        <div className="set-gap"><Card>
          <DangerRow
            label={signOutArmed ? "Tap Again to Sign Out" : "Sign Out"}
            onClick={() => { if (!signOutArmed) { setSignOutArmed(true); return; } onSignOut(); }}
          />
        </Card></div>
      )}
      {backendConfigured && (
        <div className="set-gap">
          <Card>
            <DangerRow
              label={deleteBusy ? "Deleting..." : deleteArmed ? "Tap Again to Delete Account" : "Delete Account"}
              onClick={() => void runDelete()}
              disabled={deleteBusy}
            />
          </Card>
          {deleteArmed && <Foot><span className="slip-warn">Permanent · Every note, task and event is erased</span></Foot>}
          {deleteError && <Foot><span className="slip-warn">{deleteError}</span></Foot>}
        </div>
      )}
      <div className="screen-foot" />
      {photoSheet && (
        <RowActionSheet
          title="Profile Photo"
          actions={[
            { label: "Choose Photo", onPick: () => fileRef.current?.click() },
            ...(photo ? [{ label: "Remove Photo", destructive: true, onPick: () => { void removePhoto(); } }] : []),
          ]}
          onCancel={() => setPhotoSheet(false)}
        />
      )}
    </div>
  );
}
