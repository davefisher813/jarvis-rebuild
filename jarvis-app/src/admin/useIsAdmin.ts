import { useCallback, useEffect, useState } from "react";
import { useAccessToken } from "../data/NotesProvider";
import { apiUrl } from "../shared/apiBase";

// Client-side admin check, for UX gating only. Asks the real server gate (the
// ADMIN_USER_IDS allowlist) instead of trusting anything client-writable: a
// 200 from an admin endpoint means the allowlist accepted this user. Real
// enforcement stays server-side either way; this only shows or hides UI.
//
// Four answers, not two (slice 09 QA, 2026-10-04). The probe used to fold every
// failure into "not admin" and never ask again until the token changed, so a
// 502 from the usage route, a dropped connection, or a fifth tap that beat the
// first answer left the owner on "Not Authorized" with the AI Allowed switches
// out of reach. Now only the server's own 401 or 403 is a no; a network error,
// a 5xx or a 429 is retried twice and then reported as an error the Admin
// screen can offer to try again.
export type AdminProbe = "checking" | "yes" | "no" | "error";

const RETRY_MS = [1000, 3000];

export function useAdminProbe(): { state: AdminProbe; recheck: () => void } {
  const token = useAccessToken();
  const [state, setState] = useState<AdminProbe>(token ? "checking" : "no");
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!token) { setState("no"); return; }
    let on = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState("checking");
    const attempt = (n: number) => {
      fetch(apiUrl("/api/admin/usage"), { headers: { Authorization: "Bearer " + token } })
        .then((r) => {
          if (!on) return;
          if (r.ok) setState("yes");
          else if (r.status === 401 || r.status === 403) setState("no");
          else retry(n);
        })
        .catch(() => { if (on) retry(n); });
    };
    const retry = (n: number) => {
      if (n >= RETRY_MS.length) { setState("error"); return; }
      timer = setTimeout(() => attempt(n + 1), RETRY_MS[n]);
    };
    attempt(0);
    return () => { on = false; if (timer) clearTimeout(timer); };
  }, [token, round]);
  const recheck = useCallback(() => setRound((r) => r + 1), []);
  return { state, recheck };
}
