import { useEffect, useRef, useState } from "react";
import { FormSheet, Group, FieldRow, ErrorLine, Note } from "../shared/FormSheet";
import { useAuth } from "../auth/AuthProvider";
import { MIN_PASSWORD_LENGTH, passwordErrorOf, passwordProblem, type PasswordField, type PasswordProblem } from "../auth/passwordRules";
import { showToast } from "../shared/toast";

// ACCOUNT > CHANGE PASSWORD (2026-10-04, Dave: "no way to edit username or
// password"). Three fields, one verb. The fields are checked before anything
// is sent and the first thing wrong is said in plain words under them; what
// Supabase refuses after that (a wrong current password, a password it calls
// too weak, no connection) is said the same way (auth/passwordRules.ts), and
// the typing stays where it is so the person fixes one field, not three.
//
// Save is dimmed until all three have something in them but is never dead:
// a tap on it is what surfaces what is missing, as on every sheet in the app.
// Success is a toast and the sheet closes; the person stays signed in here.
export default function ChangePasswordSheet({ onClose }: { onClose: () => void }) {
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problem, setProblem] = useState<PasswordProblem | null>(null);
  const [busy, setBusy] = useState(false);

  const edit = (set: (v: string) => void) => (v: string) => { set(v); if (problem) setProblem(null); };
  const bad = (f: PasswordField) => problem?.field === f;
  // Cancel and Escape stay live while a change is in flight (the request cannot
  // be taken back), so a save that finishes after the sheet is gone must not
  // call a stale onClose, which could close the next sheet someone opened, or
  // set state on nothing. The toast still says it worked: the password did change.
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  // Return moves through the fields the way the keyboard's label says it will,
  // and saves from the last one.
  const focus = (label: string) => () => document.querySelector<HTMLInputElement>(`.sheet-scrim input[aria-label="${label}"]`)?.focus();

  const save = async () => {
    if (busy) return;
    const found = passwordProblem({ current, next, confirm });
    if (found) { setProblem(found); return; }
    setBusy(true);
    setProblem(null);
    try {
      await changePassword(current, next);
      showToast({ message: "Password Updated" });
      if (mounted.current) onClose();
    } catch (e) {
      if (!mounted.current) return;
      setProblem(passwordErrorOf(e));
      setBusy(false);
    }
  };

  return (
    <FormSheet
      title="Change Password"
      onCancel={onClose}
      onSave={() => { void save(); }}
      saveDisabled={!current || !next || !confirm || busy}
      saveLabel={busy ? "Saving" : "Save"}
    >
      <Group label="Current Password">
        <FieldRow value={current} onChange={edit(setCurrent)} type="password" autoComplete="current-password"
          placeholder="Your Current Password" ariaLabel="Current password" error={bad("current")}
          enterKeyHint="next" onEnter={focus("New password")} />
      </Group>
      <Group label="New Password">
        <FieldRow value={next} onChange={edit(setNext)} type="password" autoComplete="new-password"
          placeholder={`At Least ${MIN_PASSWORD_LENGTH} Characters`} ariaLabel="New password" error={bad("next")}
          enterKeyHint="next" onEnter={focus("Confirm new password")} />
        <FieldRow value={confirm} onChange={edit(setConfirm)} type="password" autoComplete="new-password"
          placeholder="Type It Again" ariaLabel="Confirm new password" error={bad("confirm")}
          enterKeyHint="go" onEnter={() => { void save(); }} />
      </Group>
      <ErrorLine text={problem?.message} />
      <Note>You stay signed in on this device.</Note>
    </FormSheet>
  );
}
