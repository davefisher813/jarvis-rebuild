import { useEffect, useSyncExternalStore } from "react";
import { apiUrl } from "../shared/apiBase";
import { isAdminAiBlocked, setAdminAiBlocked, subscribeAdminAiBlock } from "./levelStore";

// THE ADMIN SWITCH, FOR THE APP TO EXPLAIN (Dave 2026-09-30). Asks the server
// whether the admin has left AI on for this account, and mirrors the answer
// into the level store so every screen reads Off the same way. The proxy
// refuses regardless; this only stops the app offering what cannot work, and
// brings AI back the moment the admin turns it on again. Asked on mount, on
// every return to the foreground and every few minutes. A failed or slow ask
// changes nothing: the proxy's answer is the one that counts.
const EVERY_MS = 5 * 60 * 1000;

export async function fetchAdminAiAllowed(token: string, doFetch: typeof fetch = fetch): Promise<boolean | null> {
  try {
    const r = await doFetch(apiUrl("/api/ai-usage?status=1"), { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const j = (await r.json()) as { allowed?: unknown };
    return typeof j.allowed === "boolean" ? j.allowed : null;
  } catch { return null; }
}

export function useAdminAiGate(token: string | null | undefined): void {
  useEffect(() => {
    if (!token) return;
    let on = true;
    const ask = async () => {
      const allowed = await fetchAdminAiAllowed(token);
      if (on && allowed !== null) setAdminAiBlocked(!allowed);
    };
    void ask();
    const onVisible = () => { if (document.visibilityState === "visible") void ask(); };
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => void ask(), EVERY_MS);
    return () => { on = false; document.removeEventListener("visibilitychange", onVisible); clearInterval(timer); };
  }, [token]);
}

/** True while the admin has turned AI off for this account. */
export function useAdminAiBlocked(): boolean {
  return useSyncExternalStore(subscribeAdminAiBlock, isAdminAiBlocked, () => false);
}
