import { useEffect, useState } from "react";
import { useAccessToken } from "../data/NotesProvider";
import { apiUrl } from "../shared/apiBase";

// Client-side admin check, for UX gating only. Asks the real server gate (the
// ADMIN_USER_IDS allowlist) instead of trusting anything client-writable: a
// 200 from an admin endpoint means the allowlist accepted this user. Real
// enforcement stays server-side either way; this only shows or hides UI.
export function useIsAdmin(): boolean {
  const token = useAccessToken();
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    if (!token) { setAdmin(false); return; }
    let on = true;
    fetch(apiUrl("/api/admin/usage"), { headers: { Authorization: "Bearer " + token } })
      .then((r) => { if (on) setAdmin(r.ok); })
      .catch(() => { if (on) setAdmin(false); });
    return () => { on = false; };
  }, [token]);
  return admin;
}
