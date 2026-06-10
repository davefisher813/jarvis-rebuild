import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useProfile } from "../../data/NotesProvider";
import { requestGoogleToken } from "./gis";
import { createGoogleApi, type GoogleApi } from "./api";

// App-wide Google session: holds the access token for this session so both the
// Connections screen and the Messages tab can use it. connect() returns a ready
// GoogleApi built from the fresh token, so callers never race React state. The
// token is in-memory only (never persisted); the connected flag persists on the
// profile, so after a reload we know to re-auth on demand.
interface GoogleSessionValue {
  connected: boolean;
  hasToken: boolean;
  connect: () => Promise<GoogleApi>;
  disconnect: () => Promise<void>;
  api: () => GoogleApi | null;
}

const Ctx = createContext<GoogleSessionValue | null>(null);

export function GoogleSessionProvider({
  children,
  requestToken = requestGoogleToken,
  makeApi = (t: string) => createGoogleApi(t),
}: {
  children: ReactNode;
  requestToken?: () => Promise<string>;
  makeApi?: (token: string) => GoogleApi;
}) {
  const profile = useProfile();
  const [token, setToken] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    (async () => {
      const p = await profile.get();
      const c = p?.connections || {};
      setConnected(!!(c.gmail || c.googleCalendar || p?.gmail || p?.calendar));
    })();
  }, [profile]);

  const connect = useCallback(async (): Promise<GoogleApi> => {
    const t = await requestToken();
    setToken(t);
    const p = await profile.get();
    await profile.save({ connections: { ...(p?.connections || {}), gmail: true, googleCalendar: true } });
    setConnected(true);
    return makeApi(t);
  }, [profile, requestToken, makeApi]);

  const disconnect = useCallback(async () => {
    setToken(null);
    setConnected(false);
    const p = await profile.get();
    await profile.save({ connections: { ...(p?.connections || {}), gmail: false, googleCalendar: false } });
  }, [profile]);

  const api = useCallback(() => (token ? makeApi(token) : null), [token, makeApi]);

  return (
    <Ctx.Provider value={{ connected, hasToken: !!token, connect, disconnect, api }}>{children}</Ctx.Provider>
  );
}

export function useGoogle(): GoogleSessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("GoogleSession provider missing");
  return v;
}
