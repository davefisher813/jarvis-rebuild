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
//   POST {forget: email}   authed. Deletes the stored token (disconnect).
//
// Requires: GOOGLE_CLIENT_SECRET, GOOGLE_TOKEN_KEY (32-byte base64) alongside
// the existing client id + Supabase env.
export const config = { runtime: "edge" };

const TOKEN_URL = "https://oauth2.googleapis.com/token";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function authedUserId(req: Request, supaUrl: string, supaAnon: string): Promise<string | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const who = await fetch(`${supaUrl}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: supaAnon } });
  if (!who.ok) return null;
  const me = (await who.json()) as { id?: string };
  return me.id || null;
}

// --- AES-GCM around the refresh token ---
async function cipherKey(secretB64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encrypt(plain: string, secretB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await cipherKey(secretB64);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv); packed.set(ct, iv.length);
  return btoa(String.fromCharCode(...packed));
}
async function decrypt(packedB64: string, secretB64: string): Promise<string> {
  const packed = Uint8Array.from(atob(packedB64), (c) => c.charCodeAt(0));
  const key = await cipherKey(secretB64);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: packed.slice(0, 12) }, key, packed.slice(12));
  return new TextDecoder().decode(plain);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const clientId = process.env.VITE_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  const tokenKey = process.env.GOOGLE_TOKEN_KEY || "";
  const supaUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const supaAnon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!clientId || !clientSecret || !tokenKey || !supaUrl || !service) {
    return json({ error: "Persistent sign-in is not configured on the server" }, 501);
  }
  const userId = await authedUserId(req, supaUrl, supaAnon);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  let body: { code?: unknown; refresh?: unknown; forget?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  const rest = supaUrl + "/rest/v1/google_tokens";
  const svc = { apikey: service, Authorization: "Bearer " + service, "content-type": "application/json" };

  if (typeof body.code === "string" && body.code) {
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: body.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: "postmessage", // the GIS popup code client's convention
        grant_type: "authorization_code",
      }),
    });
    const tok = (await r.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
    if (!r.ok || !tok.access_token) return json({ error: tok.error || "Exchange failed" }, 400);

    // Whose account is this? Google's answer, from the token itself.
    const prof = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: "Bearer " + tok.access_token },
    });
    const email = prof.ok ? (((await prof.json()) as { emailAddress?: string }).emailAddress || "").toLowerCase() : "";
    if (!email) return json({ error: "Could not identify the account" }, 400);

    if (tok.refresh_token) {
      await fetch(rest, {
        method: "POST",
        headers: { ...svc, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ user_id: userId, email, token_enc: await encrypt(tok.refresh_token, tokenKey), updated_at: new Date().toISOString() }),
      });
    }
    return json({ accessToken: tok.access_token, email, expiresIn: tok.expires_in ?? 3600, remembered: !!tok.refresh_token });
  }

  if (typeof body.refresh === "string" && body.refresh) {
    const email = body.refresh.toLowerCase();
    const rowRes = await fetch(rest + "?user_id=eq." + userId + "&email=eq." + encodeURIComponent(email) + "&select=token_enc", { headers: svc });
    const rows = rowRes.ok ? ((await rowRes.json()) as { token_enc: string }[]) : [];
    if (rows.length !== 1) return json({ error: "No stored sign-in" }, 410);
    let refreshToken: string;
    try {
      refreshToken = await decrypt(rows[0]!.token_enc, tokenKey);
    } catch {
      return json({ error: "Stored sign-in unreadable" }, 410);
    }
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" }),
    });
    const tok = (await r.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (!r.ok || !tok.access_token) {
      if (tok.error === "invalid_grant") {
        // Revoked at Google: forget it so the app re-asks interactively once.
        await fetch(rest + "?user_id=eq." + userId + "&email=eq." + encodeURIComponent(email), { method: "DELETE", headers: svc });
        return json({ error: "Sign-in revoked" }, 410);
      }
      return json({ error: tok.error || "Refresh failed" }, 502);
    }
    return json({ accessToken: tok.access_token, email, expiresIn: tok.expires_in ?? 3600 });
  }

  if (typeof body.forget === "string" && body.forget) {
    await fetch(rest + "?user_id=eq." + userId + "&email=eq." + encodeURIComponent(body.forget.toLowerCase()), { method: "DELETE", headers: svc });
    return json({ ok: true });
  }

  return json({ error: "Bad request" }, 400);
}
