import { useEffect, useState } from "react";
import { useProfile } from "../data/NotesProvider";

// Client-side admin check, for UX gating only. Real enforcement is server-side
// (RLS + privileged endpoints); a client flag never grants real access to data.
export function useIsAdmin(): boolean {
  const profile = useProfile();
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let on = true;
    profile.get().then((p) => { if (on) setAdmin(p?.role === "admin"); });
    return () => { on = false; };
  }, [profile]);
  return admin;
}
