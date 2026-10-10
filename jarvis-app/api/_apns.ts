// APPLE PUSH, THE SERVER'S HALF (2026-10-10; Email v1 spec section 10, L1 and L5; migration 0054 is the phone's half).
//
// One alert to one person's phones, through Apple's token-based provider API. Dave's key (APNS_KEY_P8, key ID
// APNS_KEY_ID, team APNS_TEAM_ID) lives in the host's sensitive env and nowhere else: never in the repo, a log or a
// response. The topic is the app's bundle ID (capacitor.config.ts), overridable by APNS_TOPIC.
//
// The provider token is an ES256 JWT signed with WebCrypto, so this runs on the edge runtime with no dependency. Apple
// wants it refreshed no more often than every 20 minutes and accepts it for 60, so one is kept for 40.
//
// ENVIRONMENT. A token minted by a debug build (aps-environment "development", ios/App/App/App.entitlements) only works
// against the sandbox host, and the phone cannot tell which it is from the web bundle (push.ts reports "production" from
// any production web build). So the row's environment is tried first and, on BadDeviceToken alone, the other host once.
//
// WHAT IS SAID. Apple accepting a push is "submitted", never "delivered": Apple does not report delivery. A network
// failure after the request may have left is "unknown" and is never retried blind. 410 Unregistered (the app was
// removed, or the token retired) is the one answer that removes a token; nothing else deletes a row.

export interface ApnsConfig {
  keyP8: string;
  keyId: string;
  teamId: string;
  topic: string;
}

export type ApnsEnvironment = "production" | "development";

export const APNS_HOSTS: Record<ApnsEnvironment, string> = {
  production: "https://api.push.apple.com",
  development: "https://api.sandbox.push.apple.com",
};

/** The app's bundle ID (capacitor.config.ts appId). */
export const DEFAULT_TOPIC = "com.bridge.jarvis";
/** How long a provider token is reused. Apple: refresh at most every 20 minutes, valid for 60. */
export const TOKEN_TTL_MS = 40 * 60_000;
/** How long Apple may hold an alert for a phone that is off. An incident older than this is stale news. */
export const EXPIRY_S = 6 * 3600;

export function readApnsConfig(e: Record<string, string | undefined> = process.env): ApnsConfig | null {
  const keyP8 = (e.APNS_KEY_P8 || "").trim();
  const keyId = (e.APNS_KEY_ID || "").trim();
  const teamId = (e.APNS_TEAM_ID || "").trim();
  if (!keyP8 || !keyId || !teamId) return null;
  return { keyP8, keyId, teamId, topic: (e.APNS_TOPIC || "").trim() || DEFAULT_TOPIC };
}

const b64url = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const utf8 = (s: string) => new TextEncoder().encode(s);

async function importKey(p8: string): Promise<CryptoKey> {
  const body = p8.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

let cached: { jwt: string; madeAt: number; keyId: string } | null = null;

/** Forget the cached provider token (Apple refused it, or a test wants a clean slate). */
export function resetProviderToken(): void {
  cached = null;
}

/** The provider token: header {alg ES256, kid}, claims {iss team, iat}. WebCrypto's ECDSA signature is already the raw
 *  r||s pair a JWS wants. */
export async function providerToken(cfg: ApnsConfig, now: number = Date.now()): Promise<string> {
  if (cached && cached.keyId === cfg.keyId && now - cached.madeAt < TOKEN_TTL_MS) return cached.jwt;
  const head = b64url(utf8(JSON.stringify({ alg: "ES256", kid: cfg.keyId })));
  const claims = b64url(utf8(JSON.stringify({ iss: cfg.teamId, iat: Math.floor(now / 1000) })));
  const key = await importKey(cfg.keyP8);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(`${head}.${claims}`)));
  const jwt = `${head}.${claims}.${b64url(sig)}`;
  cached = { jwt, madeAt: now, keyId: cfg.keyId };
  return jwt;
}

export type ApnsResult =
  | { kind: "submitted"; environment: ApnsEnvironment }
  /** The token is gone for good (410): the row should go. */
  | { kind: "unregistered" }
  | { kind: "failed"; status: number; reason: string }
  /** The request may have reached Apple; nothing is known. */
  | { kind: "unknown" };

export interface ApnsAlert {
  body: string;
  /** Replaces an earlier alert with the same ID on the phone. Never an identifier of anyone. */
  collapseId?: string;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

async function sendOnce(cfg: ApnsConfig, env: ApnsEnvironment, device: string, alert: ApnsAlert, doFetch: FetchLike, now: number): Promise<ApnsResult | { kind: "bad_token" }> {
  const jwt = await providerToken(cfg, now);
  const headers: Record<string, string> = {
    authorization: `bearer ${jwt}`,
    "apns-topic": cfg.topic,
    "apns-push-type": "alert",
    "apns-priority": "10",
    "apns-expiration": String(Math.floor(now / 1000) + EXPIRY_S),
    "content-type": "application/json",
  };
  if (alert.collapseId) headers["apns-collapse-id"] = alert.collapseId;
  let r: Response;
  try {
    r = await doFetch(`${APNS_HOSTS[env]}/3/device/${encodeURIComponent(device)}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ aps: { alert: { body: alert.body }, sound: "default" } }),
    });
  } catch {
    return { kind: "unknown" };
  }
  if (r.status === 200) return { kind: "submitted", environment: env };
  const reason = String(((await r.json().catch(() => null)) as { reason?: unknown } | null)?.reason ?? "");
  if (r.status === 410) return { kind: "unregistered" };
  if (r.status === 400 && reason === "BadDeviceToken") return { kind: "bad_token" };
  if (r.status === 403 && (reason === "ExpiredProviderToken" || reason === "InvalidProviderToken")) resetProviderToken();
  return { kind: "failed", status: r.status, reason: reason.slice(0, 40) };
}

/** One alert to one device token: the row's environment first, the other host once on BadDeviceToken. */
export async function apnsSend(cfg: ApnsConfig, device: { token: string; environment: ApnsEnvironment }, alert: ApnsAlert, doFetch: FetchLike = fetch, now: number = Date.now()): Promise<ApnsResult> {
  const first = await sendOnce(cfg, device.environment, device.token, alert, doFetch, now);
  if (first.kind !== "bad_token") return first;
  const other: ApnsEnvironment = device.environment === "production" ? "development" : "production";
  const second = await sendOnce(cfg, other, device.token, alert, doFetch, now);
  return second.kind === "bad_token" ? { kind: "failed", status: 400, reason: "BadDeviceToken" } : second;
}
