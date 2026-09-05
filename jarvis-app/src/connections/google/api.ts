import type { GCalEvent, GmailMeta, GmailFull, GmailThreadMeta, GmailThreadFull } from "./map";

// The network surface, as an interface so the orchestration above it can be
// tested with a mock. createGoogleApi is the real implementation; pass a fake
// fetch to exercise it without a network.
export interface GoogleApi {
  listUpcomingEvents(max: number): Promise<GCalEvent[]>;
  listRecentMessages(max: number): Promise<GmailMeta[]>;
  getMessage(id: string): Promise<GmailFull>;
  sendMessage(raw: string, threadId?: string): Promise<{ id: string; threadId?: string }>;
  listInbox(max: number): Promise<GmailMeta[]>;
  modifyMessage(id: string, add: string[], remove: string[]): Promise<void>;
  listDrafts(max: number): Promise<{ id: string; message: GmailMeta }[]>;
  getDraft(id: string): Promise<{ id: string; message: GmailFull }>;
  deleteDraft(id: string): Promise<void>;
  listThreads(max: number): Promise<GmailThreadMeta[]>;
  searchThreads(q: string, max: number): Promise<GmailThreadMeta[]>;
  getThread(id: string): Promise<GmailThreadFull>;
  modifyThread(id: string, add: string[], remove: string[]): Promise<void>;
  // Gmail's TRASH, which is recoverable for 30 days. The permanent-delete
  // endpoint exists and this app will never call it: an email the user cannot
  // get back is a bug they can never report.
  trashThread(id: string): Promise<void>;
  // Undo for a delete. Gmail keeps trashed mail for 30 days, so this always
  // works inside the window the app promises.
  untrashThread(id: string): Promise<void>;
  getProfile(): Promise<{ emailAddress: string }>;
  getAttachment(messageId: string, attachmentId: string): Promise<{ data: string; size: number }>;
}

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

// PLUMB-F-04 (2026-09-05): "Google access tokens are minted once at open and
// never refreshed." An access token lives about an hour; the app stays
// resident on the phone for days. Every method below threw on 401 and
// humanError turned that into "Your Google sign-in expired · Reconnect in
// Settings", where one tap on Reconnect worked instantly and silently,
// because the server still held the refresh token the whole time. This
// wraps the fetch every api instance uses: a 401 is met with ONE silent
// re-mint (the same broker.silent the Reconnect chip calls) and the same
// request replayed under the fresh token. Only when the re-mint itself comes
// back empty does the 401 reach the caller and the sentence get said. Nothing
// but 401 is touched: a 403 is a scope problem, a 429 a rate limit, and
// replaying either would be noise.
export function withSilentRefresh(doFetch: FetchLike, refresh: () => Promise<string | null>): FetchLike {
  return async (url, init) => {
    const res = await doFetch(url, init);
    if (res.status !== 401) return res;
    const fresh = await refresh().catch(() => null);
    if (!fresh) return res;
    return doFetch(url, { ...init, headers: { ...(init?.headers ?? {}), Authorization: "Bearer " + fresh } });
  };
}

export function createGoogleApi(token: string, doFetch: FetchLike = fetch as unknown as FetchLike): GoogleApi {
  const auth = { headers: { Authorization: "Bearer " + token } };
  return {
    async listUpcomingEvents(max) {
      const now = new Date().toISOString();
      const url =
        "https://www.googleapis.com/calendar/v3/calendars/primary/events" +
        "?singleEvents=true&orderBy=startTime&timeMin=" + encodeURIComponent(now) + "&maxResults=" + max;
      const res = await doFetch(url, auth);
      if (!res.ok) throw new Error("calendar " + res.status);
      const json = (await res.json()) as { items?: GCalEvent[] };
      return json.items || [];
    },
    async listRecentMessages(max) {
      const listRes = await doFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=" + max, auth);
      if (!listRes.ok) throw new Error("gmail " + listRes.status);
      const list = (await listRes.json()) as { messages?: { id: string }[] };
      const ids = (list.messages || []).map((m) => m.id);
      const metas: GmailMeta[] = [];
      for (const id of ids) {
        const r = await doFetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + id +
          "?format=metadata&metadataHeaders=From&metadataHeaders=Subject",
          auth,
        );
        if (r.ok) metas.push((await r.json()) as GmailMeta);
      }
      return metas;
    },
    async getMessage(id) {
      const r = await doFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/" + id + "?format=full", auth);
      if (!r.ok) throw new Error("message " + r.status);
      return (await r.json()) as GmailFull;
    },
    async sendMessage(raw, threadId) {
      const payload = threadId ? { raw, threadId } : { raw };
      const r = await doFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { ...auth.headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error("send " + r.status);
      return (await r.json()) as { id: string; threadId?: string };
    },
    async listInbox(max) {
      const listRes = await doFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&maxResults=" + max, auth);
      if (!listRes.ok) throw new Error("inbox " + listRes.status);
      const list = (await listRes.json()) as { messages?: { id: string }[] };
      const metas: GmailMeta[] = [];
      for (const m of list.messages || []) {
        const r = await doFetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + m.id +
          "?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date", auth);
        if (r.ok) metas.push((await r.json()) as GmailMeta);
      }
      return metas;
    },
    async modifyMessage(id, add, remove) {
      const r = await doFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + id + "/modify", {
          method: "POST",
          headers: { ...auth.headers, "Content-Type": "application/json" },
          body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
        });
      if (!r.ok) throw new Error("modify " + r.status);
    },
    async listDrafts(max) {
      const lr = await doFetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts?maxResults=" + max, auth);
      if (!lr.ok) throw new Error("drafts " + lr.status);
      const list = (await lr.json()) as { drafts?: { id: string }[] };
      const out: { id: string; message: GmailMeta }[] = [];
      for (const d of list.drafts || []) {
        const r = await doFetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/drafts/" + d.id +
          "?format=metadata&metadataHeaders=To&metadataHeaders=Subject", auth);
        if (r.ok) {
          const j = (await r.json()) as { message: GmailMeta };
          out.push({ id: d.id, message: j.message });
        }
      }
      return out;
    },
    async getDraft(id) {
      const r = await doFetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts/" + id + "?format=full", auth);
      if (!r.ok) throw new Error("draft " + r.status);
      return (await r.json()) as { id: string; message: GmailFull };
    },
    async deleteDraft(id) {
      const r = await doFetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts/" + id, { method: "DELETE", headers: auth.headers });
      if (!r.ok) throw new Error("draft del " + r.status);
    },
    async listThreads(max) {
      return fetchThreadMetas(doFetch, auth, "labelIds=INBOX&maxResults=" + max);
    },
    async searchThreads(q, max) {
      return fetchThreadMetas(doFetch, auth, "q=" + encodeURIComponent(q) + "&maxResults=" + max);
    },
    async getThread(id) {
      const r = await doFetch("https://gmail.googleapis.com/gmail/v1/users/me/threads/" + id + "?format=full", auth);
      if (!r.ok) throw new Error("thread " + r.status);
      return (await r.json()) as GmailThreadFull;
    },
    async modifyThread(id, add, remove) {
      const r = await doFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/threads/" + id + "/modify", {
          method: "POST",
          headers: { ...auth.headers, "Content-Type": "application/json" },
          body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
        });
      if (!r.ok) throw new Error("thread modify " + r.status);
    },
    async trashThread(id) {
      const r = await doFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/threads/" + id + "/trash",
        { method: "POST", headers: auth.headers },
      );
      if (!r.ok) throw new Error("thread trash " + r.status);
    },
    async untrashThread(id) {
      const r = await doFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/threads/" + id + "/untrash",
        { method: "POST", headers: auth.headers },
      );
      if (!r.ok) throw new Error("thread untrash " + r.status);
    },
    async getProfile() {
      const r = await doFetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", auth);
      if (!r.ok) throw new Error("profile " + r.status);
      return (await r.json()) as { emailAddress: string };
    },
    async getAttachment(messageId, attachmentId) {
      const r = await doFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + messageId + "/attachments/" + attachmentId, auth);
      if (!r.ok) throw new Error("attachment " + r.status);
      return (await r.json()) as { data: string; size: number };
    },
  };
}

// threads.list gives only ids; each thread's headers come from a metadata get.
// Same N+1 shape the message paths already use; fine at inbox sizes.
async function fetchThreadMetas(
  doFetch: FetchLike,
  auth: { headers: Record<string, string> },
  query: string,
): Promise<GmailThreadMeta[]> {
  const lr = await doFetch("https://gmail.googleapis.com/gmail/v1/users/me/threads?" + query, auth);
  if (!lr.ok) throw new Error("threads " + lr.status);
  const list = (await lr.json()) as { threads?: { id: string }[] };
  const out: GmailThreadMeta[] = [];
  for (const t of list.threads || []) {
    const r = await doFetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/threads/" + t.id +
      "?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=To",
      auth,
    );
    if (r.ok) out.push((await r.json()) as GmailThreadMeta);
  }
  return out;
}
