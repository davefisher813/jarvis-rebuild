import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useProfile } from "../../data/NotesProvider";
import { requestGoogleToken, type TokenOpts } from "./gis";
import { GOOGLE_SCOPES } from "./config";
import { serverBroker, type TokenBroker } from "./broker";
import { useOptionalSession } from "../../auth/AuthProvider";
import { createGoogleApi, withSilentRefresh, type FetchLike, type GoogleApi } from "./api";

// PLUMB-F-04 (2026-09-05): Google access tokens last about an hour. A token
// older than this is re-minted silently when the app comes back to the
// foreground, before any call has the chance to 401 in his face.
const TOKEN_STALE_MS = 50 * 60e3;

// App-wide Google session, multi-account (2026-08-04). Each account has its
// own in-memory token (never persisted); the ACCOUNT LIST persists on the
// profile (email + which features it powers), so after a reload we know who
// to re-auth, each with a login_hint so the chooser only appears for NEW
// accounts. The account an email arrived on is the account its reply leaves
// from; that mapping lives on the data (ThreadRow.account), not here.
//
// Legacy migration: profiles from the single-account era carry
// connections.gmail/googleCalendar booleans and no account list. They stay
// "connected" (the UI offers Connect), and the first successful connect
// learns the real address via getProfile and creates the account entry.

export interface GoogleAccount {
  email: string; mail: boolean; cal: boolean;
  /** The scope string this account actually authorized under. Absent on
   *  accounts from before 2026-08-26, which authorized as readonly. */
  scopes?: string;
}

// THE SCOPE GATE (2026-08-26). A stored refresh token keeps minting access
// tokens with the scopes it was BORN with, whatever config.ts says today. So
// when the app's scope list changes, every silent path must refuse to mint
// for accounts that authorized under the old list, or the app looks signed
// in while every mutation quietly 403s, which is exactly the state Dave
// found it in ("deleting literally doesn't work"). An account that fails
// this check simply gets no silent token: the UI's existing signed-out
// state shows, and the one interactive reconnect (code flow, prompt=consent)
// re-authorizes under the current scopes and stamps them.
const scopesCurrent = (a: GoogleAccount): boolean => a.scopes === GOOGLE_SCOPES;

interface GoogleSessionValue {
  connected: boolean; // any account known (or legacy flag)
  accounts: GoogleAccount[];
  hasToken: boolean; // any live token this session
  tokenEmails: string[]; // which accounts hold a live token (2026-08-09): lets settings show per-account signed-out state
  /** Reconnect every known account (login_hint each); first connect runs the chooser. Returns the first ready api. */
  connect: () => Promise<GoogleApi>;
  /** Force the account chooser to add a new account. */
  addAccount: () => Promise<{ api: GoogleApi; email: string }>;
  reconnect: (email: string) => Promise<GoogleApi>;
  /** No email: disconnect everything (legacy behavior). */
  disconnect: (email?: string) => Promise<void>;
  setFeature: (email: string, key: "mail" | "cal", on: boolean) => Promise<void>;
  /** No email: the first account with a live token (single-account call sites keep working). */
  api: (email?: string) => GoogleApi | null;
  /** Every tokened account, optionally filtered to a feature. */
  apis: (feature?: "mail" | "cal") => { email: string; api: GoogleApi }[];
}

const Ctx = createContext<GoogleSessionValue | null>(null);

export function GoogleSessionProvider({
  children,
  requestToken = requestGoogleToken,
  makeApi,
  broker,
  fetchImpl,
}: {
  children: ReactNode;
  /** Test/bench override: forces the legacy direct-token flow (no persistence). */
  requestToken?: (opts?: TokenOpts) => Promise<string>;
  /** Test override: build the api for a token (and, when known, the account
   *  it belongs to). The default builds the real one with the 401 re-mint. */
  makeApi?: (token: string, email?: string) => GoogleApi;
  /** Test override: a full broker, so the silent path (and its scope gate)
   *  can be exercised without a server. Wins over both real and legacy. */
  broker?: TokenBroker;
  /** Test override for the network the DEFAULT makeApi uses, so the 401
   *  re-mint path can be exercised end to end without a real Google. */
  fetchImpl?: FetchLike;
}) {
  const profile = useProfile();
  const supaSession = useOptionalSession();
  const supaToken = supaSession?.access_token;
  const tokenRefValue = useRef<string | undefined>(supaToken);
  tokenRefValue.current = supaToken;
  const tokens = useRef<Record<string, string>>({});
  // PLUMB-F-04: when each token was minted, so a stale one can be re-minted
  // on return to the foreground rather than waiting to fail.
  const mintedAt = useRef<Record<string, number>>({});
  const [tokenVersion, setTokenVersion] = useState(0); // bumps re-render when tokens change
  const [accounts, setAccounts] = useState<GoogleAccount[]>([]);
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;
  const [legacyConnected, setLegacyConnected] = useState(false);

  // If a connect lands before the initial profile read resolves, the read must
  // not clobber it (a race the session tests caught; humans are slower but
  // the guard costs nothing).
  const dirty = useRef(false);

  useEffect(() => {
    (async () => {
      const p = await profile.get();
      if (!dirty.current) {
        const list = (p?.googleAccounts as GoogleAccount[] | undefined) || [];
        setAccounts(list.filter((a) => typeof a?.email === "string"));
      }
      const c = p?.connections || {};
      setLegacyConnected(!!(c.gmail || c.googleCalendar || p?.gmail || p?.calendar));
    })();
  }, [profile]);

  const persist = useCallback(async (list: GoogleAccount[]) => {
    dirty.current = true;
    setAccounts(list);
    const p = await profile.get();
    await profile.save({
      googleAccounts: list,
      connections: { ...(p?.connections || {}), gmail: list.some((a) => a.mail), googleCalendar: list.some((a) => a.cal) },
    });
  }, [profile]);

  const storeToken = useCallback((email: string, token: string) => {
    tokens.current[email.toLowerCase()] = token;
    mintedAt.current[email.toLowerCase()] = Date.now();
    setTokenVersion((v) => v + 1);
  }, []);

  // The broker: persistent (code flow + server refresh) by default; the
  // legacy direct-token flow when a requestToken override is injected
  // (tests, the bench), those environments have no server.
  const brokerRef = useRef<TokenBroker | null>(null);
  const legacy = requestToken !== requestGoogleToken;
  if (broker) {
    brokerRef.current = broker;
  } else if (!brokerRef.current || legacy) {
    brokerRef.current = legacy
      ? { authorize: async (opts) => ({ token: await requestToken(opts) }) }
      : serverBroker(() => tokenRefValue.current);
  }

  // PLUMB-F-04: one silent re-mint for one account, deduped so a burst of
  // 401s (every method of a screen's load failing at once) asks the server
  // once and every caller waits on the same answer. Same scope gate as the
  // mount-time mint: an account stamped with older scopes gets nothing, so
  // the UI tells the truth instead of arming a token that cannot write.
  const refreshing = useRef<Record<string, Promise<string | null>>>({});
  const refreshToken = useCallback((email: string): Promise<string | null> => {
    const key = email.toLowerCase();
    const inFlight = refreshing.current[key];
    if (inFlight) return inFlight;
    const silent = brokerRef.current?.silent;
    const known = accountsRef.current.find((a) => a.email === key);
    if (!silent || !known || !scopesCurrent(known)) return Promise.resolve(null);
    const p = silent(key)
      .then((t) => { if (t) storeToken(key, t); return t; })
      .catch(() => null)
      .finally(() => { delete refreshing.current[key]; });
    refreshing.current[key] = p;
    return p;
  }, [storeToken]);

  // The api for a token: the injected builder when a test gave one, else the
  // real client over a fetch that answers a 401 with one silent re-mint and
  // a replay. An api built before the account is known (the getProfile
  // right after an interactive authorize) has no one to re-mint for.
  const buildApi = useCallback((token: string, email?: string): GoogleApi => {
    if (makeApi) return makeApi(token, email);
    const base = fetchImpl ?? (fetch as unknown as FetchLike);
    return createGoogleApi(token, email ? withSilentRefresh(base, () => refreshToken(email)) : base);
  }, [makeApi, fetchImpl, refreshToken]);

  // A token grant always ends with getProfile when the broker didn't already
  // say whose it is: the USER picks the account in Google's UI, so the truth
  // of "who authorized" comes from Google, not from what we asked for.
  const authorize = useCallback(async (opts: TokenOpts): Promise<{ api: GoogleApi; email: string }> => {
    const got = await brokerRef.current!.authorize(opts);
    const email = (got.email ?? (await buildApi(got.token).getProfile()).emailAddress).toLowerCase();
    storeToken(email, got.token);
    return { api: buildApi(got.token, email), email };
  }, [buildApi, storeToken]);

  // "Stays signed in": on app open, mint tokens for every known account from
  // the stored sign-ins, no popup, no tap. Interactive connect remains the
  // fallback when an account was never stored or got revoked.
  const silentTried = useRef(false);
  // The supaToken gate exists for the SERVER broker, whose calls carry the
  // Supabase auth header; an injected test broker has no such dependency.
  const injectedBroker = !!broker;
  useEffect(() => {
    const broker = brokerRef.current;
    if (silentTried.current || !broker?.silent || accounts.length === 0 || (!supaToken && !injectedBroker)) return;
    silentTried.current = true;
    (async () => {
      for (const a of accounts) {
        // The scope gate: an account that authorized under an older scope
        // list gets no silent token, so the UI tells the truth (signed out)
        // instead of minting a token that cannot do what the buttons offer.
        if (!scopesCurrent(a)) continue;
        const t = await broker.silent!(a.email).catch(() => null);
        if (t) storeToken(a.email, t);
      }
    })();
  }, [accounts, supaToken, injectedBroker, storeToken]);

  // PLUMB-F-04: the app stays resident on the phone; the token does not.
  // When it comes back to the foreground, any token older than
  // TOKEN_STALE_MS is re-minted before a screen has the chance to load on
  // it and 401. The on-401 replay (buildApi) covers the case this misses,
  // such as a token that expires while the app is in front.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      for (const email of Object.keys(tokens.current)) {
        if (now - (mintedAt.current[email] ?? 0) >= TOKEN_STALE_MS) void refreshToken(email);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshToken]);

  // After an interactive authorize, the account's entry records the scopes it
  // was granted under, so the gate above can tell current sign-ins from
  // pre-scope-change ones without guessing.
  const stamped = useCallback((list: GoogleAccount[], email: string): GoogleAccount[] => {
    if (!list.some((a) => a.email === email)) {
      return [...list, { email, mail: true, cal: true, scopes: GOOGLE_SCOPES }];
    }
    return list.map((a) => (a.email === email ? { ...a, scopes: GOOGLE_SCOPES } : a));
  }, []);

  const addAccount = useCallback(async () => {
    const got = await authorize({ selectAccount: true });
    await persist(stamped(accounts, got.email));
    return got;
  }, [authorize, accounts, persist, stamped]);

  const reconnect = useCallback(async (email: string) => {
    // Silent first: with a stored sign-in this is popup-free. Gated on the
    // scopes being current, because a silent token under old scopes LOOKS
    // signed in and then fails every write.
    const known = accounts.find((a) => a.email === email.toLowerCase());
    const silent = brokerRef.current?.silent;
    if (silent && known && scopesCurrent(known)) {
      const t = await silent(email).catch(() => null);
      if (t) {
        storeToken(email.toLowerCase(), t);
        return buildApi(t, email.toLowerCase());
      }
    }
    const got = await authorize({ loginHint: email });
    // Stamp whoever ACTUALLY authorized (the user picks in Google's popup;
    // honoring reality also creates the entry when they picked someone new).
    await persist(stamped(accounts, got.email));
    return got.api;
  }, [authorize, accounts, persist, stamped, storeToken, buildApi]);

  const connect = useCallback(async (): Promise<GoogleApi> => {
    if (accounts.length === 0) return (await addAccount()).api;
    let first: GoogleApi | null = null;
    let lastErr: unknown = null;
    for (const a of accounts) {
      try {
        const api = await reconnect(a.email);
        if (!first) first = api;
      } catch (e) { lastErr = e; }
    }
    if (!first) throw (lastErr instanceof Error ? lastErr : new Error("Could not connect"));
    return first;
  }, [accounts, addAccount, reconnect]);

  const disconnect = useCallback(async (email?: string) => {
    const forget = brokerRef.current?.forget;
    if (email) {
      if (forget) void forget(email.toLowerCase()).catch(() => {});
      delete tokens.current[email.toLowerCase()];
      setTokenVersion((v) => v + 1);
      await persist(accounts.filter((a) => a.email !== email.toLowerCase()));
    } else {
      if (forget) for (const a of accounts) void forget(a.email).catch(() => {});
      tokens.current = {};
      setTokenVersion((v) => v + 1);
      setLegacyConnected(false);
      await persist([]);
    }
  }, [accounts, persist]);

  const setFeature = useCallback(async (email: string, key: "mail" | "cal", on: boolean) => {
    await persist(accounts.map((a) => (a.email === email.toLowerCase() ? { ...a, [key]: on } : a)));
  }, [accounts, persist]);

  const api = useCallback((email?: string) => {
    void tokenVersion;
    if (email) {
      const t = tokens.current[email.toLowerCase()];
      return t ? buildApi(t, email.toLowerCase()) : null;
    }
    const first = accounts.find((a) => tokens.current[a.email])?.email ?? Object.keys(tokens.current)[0];
    const t = first ? tokens.current[first] : undefined;
    return t ? buildApi(t, first) : null;
  }, [accounts, buildApi, tokenVersion]);

  const apis = useCallback((feature?: "mail" | "cal") => {
    void tokenVersion;
    const known = accounts.length > 0 ? accounts : Object.keys(tokens.current).map((email) => ({ email, mail: true, cal: true }));
    return known
      .filter((a) => (feature ? a[feature] : true))
      .map((a) => ({ email: a.email, api: tokens.current[a.email] ? buildApi(tokens.current[a.email]!, a.email) : null }))
      .filter((x): x is { email: string; api: GoogleApi } => x.api !== null);
  }, [accounts, buildApi, tokenVersion]);

  void tokenVersion; // token changes re-render, so this read is fresh
  const hasToken = Object.keys(tokens.current).length > 0;
  const tokenEmails = Object.keys(tokens.current);

  return (
    <Ctx.Provider value={{ connected: accounts.length > 0 || legacyConnected, accounts, hasToken, tokenEmails, connect, addAccount, reconnect, disconnect, setFeature, api, apis }}>
      {children}
    </Ctx.Provider>
  );
}

export function useGoogle(): GoogleSessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("GoogleSession provider missing");
  return v;
}

// For surfaces that render with or without the provider (onboarding renders
// before the shell mounts one). Null means "connecting is not possible from
// here", and the caller degrades to its providerless behavior. 2026-08-09.
export function useOptionalGoogle(): GoogleSessionValue | null {
  return useContext(Ctx) ?? null;
}
