import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useProfile } from "../../data/NotesProvider";
import { requestGoogleToken, type TokenOpts } from "./gis";
import { GOOGLE_SCOPES } from "./config";
import {
  serverBroker, googleFailure, interactiveHelps, GoogleSessionError,
  type TokenBroker, type GoogleFailure, type GoogleSessionResult,
} from "./broker";
import { useOptionalSession } from "../../auth/AuthProvider";
import { createGoogleApi, withSilentRefresh, type FetchLike, type GoogleApi } from "./api";
import { normalizeAccount } from "../../messages/mailIdentity";

// PLUMB-F-04 (2026-09-05): Google access tokens last about an hour. One that
// is within this of expiring is re-minted silently when the app comes back to
// the foreground, before any call has the chance to 401 in his face. (It was
// "older than 50 minutes", the same ten minutes of room, once the session
// knew when a token dies rather than guessing from when it was born.)
const FOREGROUND_MARGIN_MS = 10 * 60e3;

// A write does not start on a token that is about to die: inside this margin
// the token is refreshed first, so a bulk action cannot fail halfway through
// on an expiry that was knowable before it began (2026-09-29).
const EXPIRY_MARGIN_MS = 60e3;

// Without a server answer for how long a token lives, the session assumes
// what Google has always given: an hour.
const DEFAULT_LIFETIME_MS = 3600e3;

const MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

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
  /** Linked to Google Drive (Dave 2026-09-29). Off until he turns it on; absent
   *  on every account from before, which reads as off. The link is a
   *  preference: the Drive scope itself is granted with the account's sign-in.
   *  No screen sets it since 2026-10-04 (the chip stored a flag nothing read);
   *  it stays in the type so a profile that holds it still reads. */
  drive?: boolean;
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

/** One account's live connection, for screens that must say what is true. */
export interface AccountConnection {
  email: string;
  /** A token is held this session. */
  connected: boolean;
  /** The server confirmed a stored sign-in behind it. False while connected
   *  is a temporary connection: it works now and is gone at the next launch. */
  durable: boolean;
  /** Epoch ms the held token dies, null when none is held. */
  expiresAt: number | null;
  /** The last thing that went wrong for this account, cleared by a good token. */
  failure: GoogleFailure | null;
}

export type EnsureGoogleResult =
  | { ok: true; email: string; api: GoogleApi; token: string; expiresAt: number; remembered: boolean }
  | ({ ok: false; email: string } & GoogleFailure);

interface GoogleSessionValue {
  connected: boolean; // any account known (or legacy flag)
  accounts: GoogleAccount[];
  hasToken: boolean; // any live token this session
  tokenEmails: string[]; // which accounts hold a live token (2026-08-09): lets settings show per-account signed-out state
  /** Reconnect every known account (login_hint each); first connect runs the chooser. Returns the first ready api. */
  connect: () => Promise<GoogleApi>;
  /** Force the account chooser to add a new account. */
  addAccount: () => Promise<{ api: GoogleApi; email: string; remembered: boolean }>;
  reconnect: (email: string) => Promise<GoogleApi>;
  /** No email: disconnect everything (legacy behavior). */
  disconnect: (email?: string) => Promise<void>;
  setFeature: (email: string, key: "mail" | "cal" | "drive", on: boolean) => Promise<void>;
  /** No email: the first account with a live token (single-account call sites keep working).
   *  READS ONLY. A write must go through ensureGoogleSession, which never
   *  falls back to another account. */
  api: (email?: string) => GoogleApi | null;
  /** Non-interactive: make sure THIS account holds a token that is good for
   *  the next minute, refreshing it if not, and hand back an api bound to it.
   *  With `forMutation` it also proves the account is connected, has mail on,
   *  holds the modify scope, and (one getProfile call per ensure, so once per
   *  mutation group) that the token really belongs to this address. It never
   *  opens Google, never picks another account, and on failure returns the
   *  cause instead of an api: the caller keeps its selection and touches
   *  nothing. Reconnecting is the person's tap, and a destructive action is
   *  not resumed after it: they tap it again. */
  ensureGoogleSession: (email: string, opts?: { forMutation?: boolean }) => Promise<EnsureGoogleResult>;
  /** The live state of one account: connected, durable, expiry, last failure. */
  connectionOf: (email: string) => AccountConnection;
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
  // When each token dies (epoch ms), from the server's own expires_in, so a
  // token near its end is re-minted on return to the foreground and before a
  // write, rather than waiting to fail.
  const expiries = useRef<Record<string, number>>({});
  // Per account: whether a stored sign-in stands behind the token, the scopes
  // Google said it carries, and the last thing that went wrong.
  const remembered = useRef<Record<string, boolean>>({});
  const granted = useRef<Record<string, string | undefined>>({});
  const failures = useRef<Record<string, GoogleFailure>>({});
  const [tokenVersion, setTokenVersion] = useState(0); // bumps re-render when tokens change
  const [stateVersion, setStateVersion] = useState(0); // bumps when only a failure changes
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

  // PLUMB-F-16 (2026-09-05): this set the screen first and saved after, and a
  // failed save left the new state on screen with nothing written. The chip
  // said Calendar was off, the next launch said it was on. The optimistic
  // update stays (the toggle has to feel instant), but a failure puts the
  // list back the way it was and rethrows, so the caller can say so.
  const persist = useCallback(async (list: GoogleAccount[]) => {
    const before = accountsRef.current;
    const wasDirty = dirty.current;
    dirty.current = true;
    setAccounts(list);
    try {
      const p = await profile.get();
      await profile.save({
        googleAccounts: list,
        connections: { ...(p?.connections || {}), gmail: list.some((a) => a.mail), googleCalendar: list.some((a) => a.cal) },
      });
    } catch (e) {
      setAccounts(before);
      dirty.current = wasDirty;
      throw e;
    }
  }, [profile]);

  // A good token clears whatever went wrong before it. `warning` is the one
  // exception: a connect that worked but could not be made durable keeps the
  // reason beside the token it belongs to.
  const storeToken = useCallback((
    email: string,
    t: { token: string; expiresAt?: number; remembered?: boolean; scope?: string },
    warning?: GoogleFailure,
  ) => {
    const key = normalizeAccount(email);
    tokens.current[key] = t.token;
    expiries.current[key] = t.expiresAt ?? Date.now() + DEFAULT_LIFETIME_MS;
    remembered.current[key] = t.remembered === true;
    granted.current[key] = t.scope;
    if (warning) failures.current[key] = warning; else delete failures.current[key];
    setTokenVersion((v) => v + 1);
  }, []);

  const recordFailure = useCallback((email: string, f: GoogleFailure) => {
    failures.current[normalizeAccount(email)] = f;
    setStateVersion((v) => v + 1);
  }, []);

  const forgetAccountState = useCallback((key: string) => {
    delete tokens.current[key];
    delete expiries.current[key];
    delete remembered.current[key];
    delete granted.current[key];
    delete failures.current[key];
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
  // The answer is the typed result, never a bare null: the callers that
  // decide whether Google's chooser may open need the cause.
  const refreshing = useRef<Record<string, Promise<GoogleSessionResult>>>({});
  const refreshAccount = useCallback((email: string): Promise<GoogleSessionResult> => {
    const key = normalizeAccount(email);
    const inFlight = refreshing.current[key];
    if (inFlight) return inFlight;
    const refused = (f: GoogleFailure, record: boolean): Promise<GoogleSessionResult> => {
      if (record) recordFailure(key, f);
      return Promise.resolve({ ok: false, ...f });
    };
    const silent = brokerRef.current?.silent;
    const known = accountsRef.current.find((a) => normalizeAccount(a.email) === key);
    if (!known) return refused(googleFailure("GOOGLE_UNKNOWN_ACCOUNT", key), false);
    if (!scopesCurrent(known)) return refused(googleFailure("GOOGLE_MISSING_SCOPE", key), true);
    if (!silent) return refused(googleFailure("GOOGLE_NO_STORED_SIGNIN", key), true);
    const p = Promise.resolve()
      .then(() => silent(key))
      // A broker that throws is a call that did not complete.
      .catch((): GoogleSessionResult => ({ ok: false, ...googleFailure("GOOGLE_NETWORK_ERROR", key) }))
      .then((r) => {
        if (r.ok) storeToken(key, r); else recordFailure(key, r);
        return r;
      })
      .finally(() => { delete refreshing.current[key]; });
    refreshing.current[key] = p;
    return p;
  }, [storeToken, recordFailure]);
  const refreshToken = useCallback(
    (email: string): Promise<string | null> => refreshAccount(email).then((r) => (r.ok ? r.token : null)),
    [refreshAccount],
  );

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
  const authorize = useCallback(async (opts: TokenOpts): Promise<{ api: GoogleApi; email: string; remembered: boolean }> => {
    const got = await brokerRef.current!.authorize(opts);
    const email = normalizeAccount(got.email ?? (await buildApi(got.token).getProfile()).emailAddress);
    // remembered:false is shown as what it is, a connection that lasts until
    // the app is closed, not as a sign-in that stays.
    storeToken(email, got, got.remembered ? undefined : got.warning);
    return { api: buildApi(got.token, email), email, remembered: got.remembered === true };
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
    // Every account at once, not one after another: the tokens then land in
    // one render, so the inbox loads once with all of its accounts instead of
    // once per account as each arrives.
    //
    // The scope gate lives in refreshAccount: an account that authorized
    // under an older scope list gets no silent token, so the UI tells the
    // truth (signed out) instead of minting a token that cannot do what the
    // buttons offer.
    void Promise.all(accounts.map((a) => refreshAccount(a.email)));
  }, [accounts, supaToken, injectedBroker, refreshAccount]);

  // PLUMB-F-04: the app stays resident on the phone; the token does not.
  // When it comes back to the foreground, any token within
  // FOREGROUND_MARGIN_MS of dying is re-minted before a screen has the chance
  // to load on it and 401. The on-401 replay (buildApi) covers the case this
  // misses, such as a token that expires while the app is in front.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      for (const email of Object.keys(tokens.current)) {
        if ((expiries.current[email] ?? 0) - now <= FOREGROUND_MARGIN_MS) void refreshAccount(email);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshAccount]);

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
    const key = normalizeAccount(email);
    const known = accounts.find((a) => normalizeAccount(a.email) === key);
    const silent = brokerRef.current?.silent;
    if (silent && known && scopesCurrent(known)) {
      const r = await refreshAccount(key);
      if (r.ok) return buildApi(r.token, key);
      // Google's chooser answers a sign-in that is gone, not a network that
      // is down: a temporary failure is reported as itself and nothing opens.
      if (!interactiveHelps(r.code)) throw new GoogleSessionError(r);
    }
    // One tap, guarded: the server mints the attempt and its state, and checks who came back before anything is stored (Spec 4).
    const got = await authorize({ loginHint: email, reconnect: normalizeAccount(email) });
    // Stamp whoever ACTUALLY authorized (the user picks in Google's popup;
    // honoring reality also creates the entry when they picked someone new).
    await persist(stamped(accounts, got.email));
    return got.api;
  }, [authorize, accounts, persist, stamped, refreshAccount, buildApi]);

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
      if (forget) void forget(normalizeAccount(email)).catch(() => {});
      forgetAccountState(normalizeAccount(email));
      setTokenVersion((v) => v + 1);
      await persist(accounts.filter((a) => a.email !== normalizeAccount(email)));
    } else {
      if (forget) for (const a of accounts) void forget(a.email).catch(() => {});
      for (const key of Object.keys(tokens.current)) forgetAccountState(key);
      failures.current = {};
      setTokenVersion((v) => v + 1);
      setLegacyConnected(false);
      await persist([]);
    }
  }, [accounts, persist, forgetAccountState]);

  const setFeature = useCallback(async (email: string, key: "mail" | "cal" | "drive", on: boolean) => {
    await persist(accounts.map((a) => (a.email === normalizeAccount(email) ? { ...a, [key]: on } : a)));
  }, [accounts, persist]);

  const api = useCallback((email?: string) => {
    void tokenVersion;
    if (email) {
      const t = tokens.current[normalizeAccount(email)];
      return t ? buildApi(t, normalizeAccount(email)) : null;
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

  // THE PREFLIGHT FOR A WRITE (2026-09-29, Dave's "Delete refreshes the token
  // before mutating"). A write used to run on whatever token the session held
  // for whichever account the row said, falling back to the FIRST account when
  // the row's own was missing, so a Delete could land in the wrong mailbox, on
  // an expired token, or on a token that cannot write, and fail halfway
  // through a bulk action with the rows already gone from the screen. This is
  // the one gate every write passes first. It is non-interactive on purpose:
  // the only way to open Google's chooser is the person tapping Reconnect, and
  // whatever they had asked for is NOT resumed after it.
  const ensureGoogleSession = useCallback(async (email: string, opts?: { forMutation?: boolean }): Promise<EnsureGoogleResult> => {
    const key = normalizeAccount(email);
    const forMutation = opts?.forMutation === true;
    const refuse = (f: GoogleFailure): EnsureGoogleResult => ({ ok: false, email: key, ...f });

    // The exact account, never a stand-in: an address the session does not
    // know is an error on a write, not a reason to use the first one.
    const known = accountsRef.current.find((a) => normalizeAccount(a.email) === key);
    if (!known) return refuse(googleFailure("GOOGLE_UNKNOWN_ACCOUNT", key));
    if (forMutation) {
      if (!known.mail) return refuse(googleFailure("GOOGLE_MAIL_DISABLED", key));
      if (!scopesCurrent(known)) return refuse(googleFailure("GOOGLE_MISSING_SCOPE", key));
    }

    let token = tokens.current[key];
    let expiresAt = expiries.current[key] ?? 0;
    if (!token || expiresAt - Date.now() <= EXPIRY_MARGIN_MS) {
      const r = await refreshAccount(key);
      if (!r.ok) return refuse(r);
      token = r.token;
      expiresAt = r.expiresAt;
    }

    // Google reports the scopes a token carries. When it says, the answer is
    // checked on top of the stamp, because a person can untick a permission
    // on the consent screen and the stamp cannot know.
    const scope = granted.current[key];
    if (forMutation && scope !== undefined && !scope.split(" ").includes(MODIFY_SCOPE)) {
      return refuse(googleFailure("GOOGLE_MISSING_SCOPE", key));
    }

    // A new api object bound to exactly this token.
    const api = buildApi(token, key);
    if (forMutation) {
      // Ask Google whose token this is, once per ensure (one ensure is one
      // mutation group). A token filed under the wrong address is dropped so
      // nothing else reuses it.
      let profileEmail: string;
      try {
        profileEmail = normalizeAccount((await api.getProfile()).emailAddress);
      } catch (e) {
        const f = profileFailure(e, key);
        if (f.code === "GOOGLE_SIGNIN_REVOKED" || f.code === "GOOGLE_MISSING_SCOPE") recordFailure(key, f);
        return refuse(f);
      }
      if (profileEmail !== key) {
        forgetAccountState(key);
        setTokenVersion((v) => v + 1);
        const f = googleFailure("GOOGLE_ACCOUNT_MISMATCH", key);
        recordFailure(key, f);
        return refuse(f);
      }
    }
    return { ok: true, email: key, api, token, expiresAt, remembered: remembered.current[key] === true };
  }, [buildApi, refreshAccount, recordFailure, forgetAccountState]);

  const connectionOf = useCallback((email: string): AccountConnection => {
    void tokenVersion; void stateVersion;
    const key = normalizeAccount(email);
    const has = !!tokens.current[key];
    return {
      email: key,
      connected: has,
      durable: has && remembered.current[key] === true,
      expiresAt: has ? expiries.current[key] ?? null : null,
      failure: failures.current[key] ?? null,
    };
  }, [tokenVersion, stateVersion]);

  // EMAIL-F-12 (2026-09-05): "The Google session value is rebuilt every
  // render, so the Email tab reloads its whole inbox on any shell re-render."
  // This was an object literal in the JSX below, so every re-render of
  // AppShell (QuickCapture, the search overlay, any shell state) handed each
  // consumer a new `g`, and anything keyed on it (MessagesFlow's loadThreads,
  // the pumps' api lookups) ran again. The value now changes only when one of
  // its fields does; tokenEmails is memoised on the same version counter the
  // api callbacks already key on, so a token change still reaches everyone.
  const tokenEmails = useMemo(() => { void tokenVersion; return Object.keys(tokens.current); }, [tokenVersion]);
  const hasToken = tokenEmails.length > 0;
  const connected = accounts.length > 0 || legacyConnected;
  const value = useMemo<GoogleSessionValue>(
    () => ({ connected, accounts, hasToken, tokenEmails, connect, addAccount, reconnect, disconnect, setFeature, api, apis, ensureGoogleSession, connectionOf }),
    [connected, accounts, hasToken, tokenEmails, connect, addAccount, reconnect, disconnect, setFeature, api, apis, ensureGoogleSession, connectionOf],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// What a failed profile check means. api.ts throws "profile 401"; a fetch that
// never arrived throws the browser's own words. Nothing else is guessed.
function profileFailure(e: unknown, email: string): GoogleFailure {
  const raw = e instanceof Error ? e.message : "";
  const status = Number(/\b([1-5]\d\d)\b/.exec(raw)?.[1] ?? 0);
  if (status === 401) return googleFailure("GOOGLE_SIGNIN_REVOKED", email, status);
  if (status === 403) return googleFailure("GOOGLE_MISSING_SCOPE", email, status);
  if (status === 0) return googleFailure("GOOGLE_NETWORK_ERROR", email, 0);
  return googleFailure("GOOGLE_UNAVAILABLE", email, status);
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
