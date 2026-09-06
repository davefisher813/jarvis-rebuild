import { apiUrl } from "../../shared/apiBase";
import { requestGoogleCode, type TokenOpts } from "./gis";
import { nativeGoogleAvailable, requestGoogleCodeNative } from "./nativeAuth";

// The token broker (persistent sign-in, 2026-08-04): how the session gets
// Google access tokens.
//   authorize: interactive (popup), used the FIRST time an account connects
//              or when a stored sign-in has been revoked.
//   silent:    no user interaction, the server mints a fresh access token
//              from the stored refresh token. This is "stays signed in".
//   forget:    drop the stored sign-in (disconnect).
// The server does the exchange because refresh tokens must never reach the
// client; see api/google.ts.

export interface TokenBroker {
  authorize: (opts: TokenOpts) => Promise<{ token: string; email?: string }>;
  silent?: (email: string) => Promise<string | null>;
  forget?: (email: string) => Promise<void>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export function serverBroker(getAuthToken: () => string | undefined, doFetch: FetchLike = fetch): TokenBroker {
  const call = async (body: Record<string, string>): Promise<{ accessToken?: string; email?: string; error?: string; status: number }> => {
    const auth = getAuthToken();
    if (!auth) return { status: 401 };
    try {
      const r = await doFetch(apiUrl("/api/google"), {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: "Bearer " + auth },
        body: JSON.stringify(body),
      });
      const j = (await r.json().catch(() => ({}))) as { accessToken?: string; email?: string; error?: string };
      return { ...j, status: r.status };
    } catch {
      return { status: 0 };
    }
  };

  return {
    // UP-LAUNCH-12 (2026-09-05): the same exchange, two ways of getting the
    // code. The web keeps the GIS popup; the phone opens the system sign-in
    // sheet with PKCE, because a popup code client posts back to the page's
    // origin and in the App Store build that origin is capacitor://localhost,
    // which Google will not accept. The server half is identical apart from
    // the verifier, which is what proves the exchange belongs to this sheet.
    async authorize(opts) {
      if (nativeGoogleAvailable()) {
        const { code, verifier, redirectUri } = await requestGoogleCodeNative(opts);
        const res = await call({ code, verifier, redirectUri });
        if (!res.accessToken) throw new Error(res.error || "Google sign-in failed");
        return { token: res.accessToken, email: res.email };
      }
      const code = await requestGoogleCode(opts);
      const res = await call({ code });
      if (!res.accessToken) throw new Error(res.error || "Google sign-in failed");
      return { token: res.accessToken, email: res.email };
    },
    async silent(email) {
      const res = await call({ refresh: email });
      return res.accessToken ?? null; // 410 (revoked/absent) and errors both mean: not silently
    },
    async forget(email) {
      await call({ forget: email });
    },
  };
}
