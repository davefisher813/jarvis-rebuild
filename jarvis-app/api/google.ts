import { forgetGrant, getAccessToken, googleFailure, keepSignIn, type GoogleCode, type GoogleStore } from "./_google";
import { claimAttempt, closeOpenAttempt, completeReconnect, latestAttempt, ownsAccount, recordOutcome, startAttempt, verifyConsumers } from "./_reconnect";
import { verifyState } from "../src/connections/google/reconnect";

// Persistent Google sign-in (2026-08-04). The ONLY place refresh tokens live.
//
//   POST {code}            authed. Exchanges a one-time auth code (from the
//                          GIS code client) for tokens. The refresh token is
//                          AES-GCM-encrypted and upserted per (user, email);
//                          the short-lived access token goes back to the app.
//   POST {refresh: email}  authed. Decrypts the stored refresh token and
//                          mints a fresh access token: this is the silent
//                          "stays signed in" path, no popup involved.
//                          A revoked grant (Google: invalid_grant) is marked DEAD
//                          and KEPT for audit (never deleted, never used again),
//                          the mailbox moves to reauth, and this returns 410 so
//                          the app falls back to the interactive connect exactly
//                          once. See "THE TOKEN LIFECYCLE" in api/_google.ts.
//                          Every failure carries a stable `code` and a plain
//                          `message` (see googleFailure in _google.ts), so the
//                          app can tell a revoked grant from a dead network
//                          and only opens the chooser for the first.
//   POST {reconnectStart: email}   authed. ONE-TAP RECONNECT (Spec 4): persists the attempt (which account, whose request, when it
//                          expires) and returns the OAuth `state` the app must take to Google, signed, naming the account, and
//                          good for ten minutes. A newer start for the same account replaces the older one.
//   POST {code, state}     the same exchange, but with a reconnect's state: verified (signature, age, owner, single use) BEFORE the
//                          code is exchanged, then the six checks (identity, permissions, a renewable credential, a real refresh,
//                          a real mailbox read, a durable store) run in order, and nothing is stored or shown green until all
//                          six pass. A different Google account than the one being reconnected is refused and stores nothing.
//   POST {reconnectReport: {state, outcome, reason}}  the person closed the window (cancelled, silent) or Google refused (denied).
//   POST {reconnectStatus: email}  what became of the latest attempt, so an app killed mid-flow can say so honestly on reopen,
//                          with the consumers probed again (app, status; CLI and legacy are reported as gated).
//   POST {forget: email}   authed. Disconnect: the token row and the mailbox's
//                          credential reference are deleted together, and the
//                          grant is revoked at Google best-effort.
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
  const store: GoogleStore = {
    supaUrl, service, tokenKey,
    ...(process.env.GOOGLE_TOKEN_KEY_PREV ? { tokenKeyPrev: process.env.GOOGLE_TOKEN_KEY_PREV } : {}),
    clients: { clientId, clientSecret, iosClientId },
  };

  let body: { code?: unknown; refresh?: unknown; forget?: unknown; verifier?: unknown; redirectUri?: unknown; state?: unknown; reconnectStart?: unknown; reconnectStatus?: unknown; reconnectReport?: unknown; probe?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  const env = { ...store, anon: supaAnon };

  // ---- ONE-TAP RECONNECT (Foundation Fix Spec 4) ---------------------------------------------------------------------------
  if (typeof body.reconnectStart === "string" && body.reconnectStart) {
    const email = body.reconnectStart.trim().toLowerCase();
    if (!(await ownsAccount(store, userId, email))) return fail("GOOGLE_NO_STORED_SIGNIN", email);
    const a = await startAttempt(store, { userId, email });
    // The hint is the exact address: Google opens on that account, and the server compares what comes back regardless.
    return json({ state: a.state, loginHint: email, expiresAt: a.expiresAt, attemptId: a.attemptId });
  }

  if (typeof body.reconnectStatus === "string" && body.reconnectStatus) {
    const email = body.reconnectStatus.trim().toLowerCase();
    const { persisted, attempt } = await latestAttempt(store, userId, email);
    // The verification harness, on demand: every consumer is probed again and says what it sees (CLI and legacy are reported as gated).
    const propagation = body.probe === true && attempt?.status === "verified" ? await verifyConsumers(store, env, { userId, email }) : undefined;
    return json({ persisted, status: attempt?.status ?? "none", completedAt: attempt?.completed_at ?? null, expiresAt: attempt?.expires_at ?? null, outcome: attempt?.outcome ?? null, ...(propagation ? { propagation } : {}) });
  }

  if (body.reconnectReport && typeof body.reconnectReport === "object") {
    const rep = body.reconnectReport as { state?: unknown; outcome?: unknown; reason?: unknown };
    const chk = await verifyState(rep.state, tokenKey, { userId, nowMs: Date.now() });
    // A report for a state that is not ours, or is already over, changes nothing and says nothing.
    if (chk.ok && (rep.outcome === "cancelled" || rep.outcome === "denied")) {
      await closeOpenAttempt(store, chk.payload.a, rep.outcome, rep.outcome === "denied" ? { reason: String(rep.reason ?? "").slice(0, 80) } : {});
    }
    return json({ ok: true });
  }

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
    // A RECONNECT'S STATE IS CHECKED BEFORE ANY CODE IS EXCHANGED (Spec 4): signature, age (ten minutes at most), owner, and
    // single use. A code that comes with a state that fails is never sent to Google.
    let rc: Awaited<ReturnType<typeof verifyState>> & { ok: true } | null = null;
    if (typeof body.state === "string" && body.state) {
      const chk = await verifyState(body.state, tokenKey, { userId, nowMs: Date.now() });
      if (!chk.ok) {
        const expired = chk.reason === "expired";
        return json({ error: expired ? "That reconnect timed out" : "That reconnect did not match", code: expired ? "RECONNECT_EXPIRED" : "RECONNECT_STATE_INVALID", reconnect: { status: expired ? "expired" : "denied" } }, 400);
      }
      const claim = await claimAttempt(store, chk.payload, Date.now());
      if (!claim.ok) return json({ error: "That reconnect was already used", code: "RECONNECT_ATTEMPT_USED", reconnect: { status: "superseded" } }, 409);
      rc = chk;
    }
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
    const tok = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; refresh_token_expires_in?: number };
    if (!r.ok || !tok.access_token) {
      if (rc) await recordOutcome(store, rc.payload.a, "unverified", { stage: "code_exchange" });
      return json({ error: tok.error || "Exchange failed" }, 400);
    }

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
    if (!email) {
      if (rc) await recordOutcome(store, rc.payload.a, "unverified", { stage: "identity_read" });
      return json({ error: "Could not identify the account" }, 400);
    }

    // THE SIX CHECKS (Spec 4). Identity, permissions, a renewable credential, a real refresh, a real mailbox read, a durable store:
    // in that order, and nothing is stored or reported connected until every one has passed.
    if (rc) {
      const done = await completeReconnect(store, env, { payload: rc.payload, returnedEmail: email, tokens: { ...tok, access_token: tok.access_token }, native });
      if (!done.ok) {
        await recordOutcome(store, rc.payload.a, done.status, { intended: rc.payload.e, ...(done.selected ? { selected: done.selected } : {}) });
        const http = done.status === "unverified" && done.retryable ? 502 : 409;
        return json({
          error: "Reconnect did not complete", code: "RECONNECT_" + done.status.toUpperCase(), retryable: done.retryable,
          reconnect: { status: done.status, intended: rc.payload.e, ...(done.selected ? { selected: done.selected } : {}) },
        }, http);
      }
      await recordOutcome(store, rc.payload.a, "verified", { propagation: done.propagation });
      return json({
        accessToken: done.accessToken, email: rc.payload.e, expiresIn: done.expiresIn, remembered: true,
        ...(done.scope ? { scope: done.scope } : {}),
        reconnect: { status: "verified", propagation: done.propagation },
      });
    }

    // DURABLE MEANS STORED (2026-09-29). `remembered` is true only when a stored token exists and was confirmed: either the one we
    // just wrote and saw accepted, or, when Google sent no new refresh token (it does that for an account that already consented),
    // the OLD one, which is left exactly as it was. A database error on the way is a storage failure, never "no token".
    // Spec 2: the sign-in is sealed in its own envelope, stored VALID, and the mailbox is mirrored as connected in the SAME
    // transaction (migration 0057). Consent that returned no refresh token cannot revive a DEAD grant, and says so.
    const stored = await keepSignIn(store, {
      userId, email, accessToken: tok.access_token,
      ...(tok.refresh_token ? { refreshToken: tok.refresh_token } : {}),
      ...(typeof tok.expires_in === "number" ? { expiresIn: tok.expires_in } : {}),
      ...(tok.scope ? { scope: tok.scope } : {}),
      ...(typeof tok.refresh_token_expires_in === "number" ? { refreshTokenExpiresIn: tok.refresh_token_expires_in } : {}),
      native,
    });
    const why = stored.remembered ? null : googleFailure(stored.code, email);
    return json({
      accessToken: tok.access_token,
      email,
      // Zero when Google said nothing usable: the app refreshes next time rather than assuming an hour.
      expiresIn: typeof tok.expires_in === "number" && tok.expires_in > 0 ? tok.expires_in : 0,
      remembered: stored.remembered,
      ...(tok.scope ? { scope: tok.scope } : {}),
      ...(why ? { code: why.code, message: why.message, retryable: why.retryable } : {}),
    });
  }

  if (typeof body.refresh === "string" && body.refresh) {
    const email = body.refresh.trim().toLowerCase();
    // The one path every consumer uses: a cached token when it is good, one refresh at Google when it is not, never a DEAD grant, and
    // the one revocation path when Google says the grant is gone. Each failure arrives already carrying the code the app keys on.
    const got = await getAccessToken(store, { userId, email, source: "app" });
    if (!got.ok) return fail(got.code, email);
    return json({
      accessToken: got.accessToken,
      email,
      expiresIn: got.expiresIn,
      remembered: true, // there is a stored token, or it could not have been refreshed
      ...(got.scope ? { scope: got.scope } : {}),
    });
  }

  if (typeof body.forget === "string" && body.forget) {
    // THE KILL SWITCH: invalid locally the moment this answers, revoked at Google best-effort.
    const gone = await forgetGrant(store, { userId, email: body.forget, source: "app" });
    if (!gone.ok) return fail("GOOGLE_STORAGE_FAILURE", body.forget);
    return json({ ok: true, revokedAtGoogle: gone.revokedAtGoogle });
  }

  return json({ error: "Bad request" }, 400);
}
