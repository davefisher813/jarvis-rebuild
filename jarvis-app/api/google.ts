import { IOS_TAG, encrypt, decrypt, refreshAccessToken, googleFailure, type GoogleCode } from "./_google";

// Persistent Google sign-in (2026-08-04). The ONLY place refresh tokens live.
//
//   POST {code}            authed. Exchanges a one-time auth code (from the
//                          GIS code client) for tokens. The refresh token is
//                          AES-GCM-encrypted and upserted per (user, email);
//                          the short-lived access token goes back to the app.
//   POST {refresh: email}  authed. Decrypts the stored refresh token and
//                          mints a fresh access token: this is the silent
//                          "stays signed in" path, no popup involved.
//                          A revoked grant (Google: invalid_grant) deletes
//                          the row and returns 410 so the app falls back to
//                          the interactive connect exactly once.
//                          Every failure carries a stable `code` and a plain
//                          `message` (see googleFailure in _google.ts), so the
//                          app can tell a revoked grant from a dead network
//                          and only opens the chooser for the first.
//   POST {forget: email}   authed. Deletes the stored token (disconnect).
//
// Requires: GOOGLE_CLIENT_SECRET, GOOGLE_TOKEN_KEY (32-byte base64) alongside
// the existing client id + Supabase env.
export const config = { runtime: "edge" };

const TOKEN_URL = "https://oauth2.googleapis.com/token";

// MOVED, NOT COPIED (2026-09-19). The cipher, the iOS client tag and the
// refresh itself live in api/_google.ts now, because the booking confirmation
// needs to send from the host's mailbox with no session on the request. This
// file still owns everything about SIGNING IN: the code exchange, which
// account a token belongs to, and forgetting a grant Google has revoked.

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// A failure with its code, its plain message and its status. The `error`
// field stays (the app has always read it) and now holds the same plain
// message rather than a machine string.
function fail(code: GoogleCode, account = ""): Response {
  const f = googleFailure(code, account);
  return json({ error: f.message, code: f.code, message: f.message, retryable: f.retryable }, f.status);
}

// Whose request is this. An expired JARVIS sign-in and an auth service that
// could not be reached are different answers: only the first means "sign in
// again", and telling a person their sign-in expired because Supabase blinked
// is how a temporary problem turns into a chooser.
async function authedUser(req: Request, supaUrl: string, supaAnon: string): Promise<{ id: string } | { fail: GoogleCode }> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { fail: "GOOGLE_AUTH_EXPIRED" };
  let who: Response;
  try {
    who = await fetch(`${supaUrl}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: supaAnon } });
  } catch {
    return { fail: "GOOGLE_NETWORK_ERROR" };
  }
  if (who.status === 429 || who.status >= 500) return { fail: "GOOGLE_NETWORK_ERROR" };
  if (!who.ok) return { fail: "GOOGLE_AUTH_EXPIRED" };
  const me = (await who.json().catch(() => ({}))) as { id?: string };
  return me.id ? { id: me.id } : { fail: "GOOGLE_AUTH_EXPIRED" };
}

// Store the refresh token Google just sent, or confirm the one already there,
// and say which. Never throws: every failure is a code.
async function keepSignIn(o: {
  rest: string; svc: Record<string, string>; userId: string; email: string; tokenKey: string; fresh: string;
}): Promise<{ remembered: true } | { remembered: false; code: GoogleCode }> {
  const { rest, svc, userId, email, tokenKey, fresh } = o;
  try {
    if (fresh) {
      const w = await fetch(rest, {
        method: "POST",
        headers: { ...svc, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ user_id: userId, email, token_enc: await encrypt(fresh, tokenKey), updated_at: new Date().toISOString() }),
      });
      return w.ok ? { remembered: true } : { remembered: false, code: "GOOGLE_STORAGE_FAILURE" };
    }
    // Google sent no new refresh token. Leave whatever is stored alone.
    const r = await fetch(rest + "?user_id=eq." + userId + "&email=eq." + encodeURIComponent(email) + "&select=token_enc", { headers: svc });
    if (!r.ok) return { remembered: false, code: "GOOGLE_STORAGE_FAILURE" };
    const rows = (await r.json()) as { token_enc: string }[];
    if (rows.length === 0) return { remembered: false, code: "GOOGLE_NO_STORED_SIGNIN" };
    if (rows.length !== 1) return { remembered: false, code: "GOOGLE_STORAGE_FAILURE" };
    try {
      await decrypt(rows[0]!.token_enc, tokenKey);
    } catch {
      return { remembered: false, code: "GOOGLE_STORED_SIGNIN_UNREADABLE" };
    }
    return { remembered: true };
  } catch {
    return { remembered: false, code: "GOOGLE_STORAGE_FAILURE" };
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const clientId = process.env.VITE_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  // The iOS OAuth client (UP-LAUNCH-12). Optional: only the native connect
  // and the refresh of the tokens it stored need it.
  const iosClientId = process.env.VITE_GOOGLE_IOS_CLIENT_ID || process.env.GOOGLE_IOS_CLIENT_ID || "";
  const tokenKey = process.env.GOOGLE_TOKEN_KEY || "";
  const supaUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const supaAnon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  // Names only, never values: a 501 that does not say WHICH piece is missing
  // costs an hour of guessing at the dashboard.
  const missing = [
    !clientId && "GOOGLE_CLIENT_ID",
    !clientSecret && "GOOGLE_CLIENT_SECRET",
    !tokenKey && "GOOGLE_TOKEN_KEY",
    !supaUrl && "SUPABASE_URL",
    !service && "SUPABASE_SERVICE_ROLE_KEY",
  ].filter(Boolean) as string[];
  if (missing.length > 0) {
    return json({ error: "Persistent sign-in is not configured on the server", missing }, 501);
  }
  const who = await authedUser(req, supaUrl, supaAnon);
  if ("fail" in who) return fail(who.fail);
  const userId = who.id;

  let body: { code?: unknown; refresh?: unknown; forget?: unknown; verifier?: unknown; redirectUri?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  const rest = supaUrl + "/rest/v1/google_tokens";
  const svc = { apikey: service, Authorization: "Bearer " + service, "content-type": "application/json" };

  if (typeof body.code === "string" && body.code) {
    // UP-LAUNCH-12 (2026-09-05): two shapes of the same exchange.
    //
    //   web    the GIS popup code client, redirect_uri "postmessage", the
    //          web client id and its secret.
    //   native an iOS OAuth client, which HAS no secret (an installed app
    //          cannot keep one) and proves itself with the PKCE verifier
    //          instead, redirecting to its own reversed client id.
    //
    // The native branch is taken only when the caller sends a verifier AND
    // the iOS client is configured, and the redirect_uri it may name is
    // checked against that client's own scheme rather than trusted: a
    // redirect_uri parameter accepted verbatim is how an exchange endpoint
    // becomes somebody else's.
    const iosScheme = iosClientId.endsWith(".apps.googleusercontent.com")
      ? "com.googleusercontent.apps." + iosClientId.slice(0, -".apps.googleusercontent.com".length)
      : "";
    const verifier = typeof body.verifier === "string" ? body.verifier : "";
    const redirectUri = typeof body.redirectUri === "string" ? body.redirectUri : "";
    const native = !!verifier && !!iosScheme && redirectUri.startsWith(iosScheme + ":");
    if (verifier && !native) return json({ error: "Native sign-in is not configured" }, 400);
    let r: Response;
    try {
      r = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(native ? {
          code: body.code,
          client_id: iosClientId,
          code_verifier: verifier,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        } : {
          code: body.code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: "postmessage", // the GIS popup code client's convention
          grant_type: "authorization_code",
        }),
      });
    } catch {
      return fail("GOOGLE_NETWORK_ERROR");
    }
    const tok = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
    if (!r.ok || !tok.access_token) return json({ error: tok.error || "Exchange failed" }, 400);

    // Whose account is this? Google's answer, from the token itself.
    let email = "";
    try {
      const prof = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: { Authorization: "Bearer " + tok.access_token },
      });
      email = prof.ok ? (((await prof.json()) as { emailAddress?: string }).emailAddress || "").trim().toLowerCase() : "";
    } catch {
      return fail("GOOGLE_NETWORK_ERROR");
    }
    if (!email) return json({ error: "Could not identify the account" }, 400);

    // DURABLE MEANS STORED (2026-09-29). This answered `remembered: !!refresh_token`
    // whether or not the write had landed, so a failed upsert (the fetch result
    // was never even read) still told the app it would stay signed in, and the
    // first refresh an hour later found nothing. `remembered` is now true only
    // when a stored token exists and was confirmed: either the one we just
    // wrote and saw accepted, or, when Google sent no new refresh token (it
    // does that for an account that already consented), the OLD one, which is
    // left exactly as it was. A database error on the way is a storage
    // failure, never "no token".
    const stored = await keepSignIn({
      rest, svc, userId, email, tokenKey,
      fresh: tok.refresh_token ? (native ? IOS_TAG : "") + tok.refresh_token : "",
    });
    const why = stored.remembered ? null : googleFailure(stored.code, email);
    return json({
      accessToken: tok.access_token,
      email,
      expiresIn: tok.expires_in ?? 3600,
      remembered: stored.remembered,
      ...(tok.scope ? { scope: tok.scope } : {}),
      ...(why ? { code: why.code, message: why.message, retryable: why.retryable } : {}),
    });
  }

  if (typeof body.refresh === "string" && body.refresh) {
    const email = body.refresh.trim().toLowerCase();
    let rows: { token_enc: string }[];
    try {
      const rowRes = await fetch(rest + "?user_id=eq." + userId + "&email=eq." + encodeURIComponent(email) + "&select=token_enc", { headers: svc });
      // A failed SELECT is a storage failure. It used to read as an empty
      // table, which said "no stored sign-in" and started a reconnect for a
      // person whose sign-in was sitting there untouched.
      if (!rowRes.ok) return fail("GOOGLE_STORAGE_FAILURE", email);
      rows = (await rowRes.json()) as { token_enc: string }[];
    } catch {
      return fail("GOOGLE_STORAGE_FAILURE", email);
    }
    if (rows.length === 0) return fail("GOOGLE_NO_STORED_SIGNIN", email);
    // One row per (user, email) is the table's shape; anything else is
    // something wrong with storage, not an answer about the person.
    if (rows.length !== 1) return fail("GOOGLE_STORAGE_FAILURE", email);
    let stored: string;
    try {
      stored = await decrypt(rows[0]!.token_enc, tokenKey);
    } catch {
      return fail("GOOGLE_STORED_SIGNIN_UNREADABLE", email);
    }
    // The client fallback lives in _google.ts; what belongs HERE is what to do
    // when every client refuses the token, because only the sign-in path can
    // forget a grant and ask the person for a new one.
    let got: Awaited<ReturnType<typeof refreshAccessToken>>;
    try {
      got = await refreshAccessToken(stored, { clientId, clientSecret, iosClientId });
    } catch {
      // The request to Google never completed. Nothing is wrong with the
      // grant, so nothing is forgotten and the app must not open a chooser.
      return fail("GOOGLE_NETWORK_ERROR", email);
    }
    if (!got.ok) {
      if (got.error === "invalid_grant") {
        // Revoked at Google: forget it so the app re-asks interactively once.
        await fetch(rest + "?user_id=eq." + userId + "&email=eq." + encodeURIComponent(email), { method: "DELETE", headers: svc }).catch(() => {});
        return fail("GOOGLE_SIGNIN_REVOKED", email);
      }
      return fail("GOOGLE_REFRESH_UNAVAILABLE", email);
    }
    return json({
      accessToken: got.got.accessToken,
      email,
      expiresIn: got.got.expiresIn,
      remembered: true, // there is a stored token, or it could not have been refreshed
      ...(got.got.scope ? { scope: got.got.scope } : {}),
    });
  }

  if (typeof body.forget === "string" && body.forget) {
    try {
      const d = await fetch(rest + "?user_id=eq." + userId + "&email=eq." + encodeURIComponent(body.forget.trim().toLowerCase()), { method: "DELETE", headers: svc });
      if (!d.ok) return fail("GOOGLE_STORAGE_FAILURE", body.forget);
    } catch {
      return fail("GOOGLE_STORAGE_FAILURE", body.forget);
    }
    return json({ ok: true });
  }

  return json({ error: "Bad request" }, 400);
}
