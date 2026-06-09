import type { GCalEvent, GmailMeta, GmailFull } from "./map";

// The network surface, as an interface so the orchestration above it can be
// tested with a mock. createGoogleApi is the real implementation; pass a fake
// fetch to exercise it without a network.
export interface GoogleApi {
  listUpcomingEvents(max: number): Promise<GCalEvent[]>;
  listRecentMessages(max: number): Promise<GmailMeta[]>;
  getMessage(id: string): Promise<GmailFull>;
  sendMessage(raw: string, threadId?: string): Promise<{ id: string }>;
  listInbox(max: number): Promise<GmailMeta[]>;
  modifyMessage(id: string, add: string[], remove: string[]): Promise<void>;
  listDrafts(max: number): Promise<{ id: string; message: GmailMeta }[]>;
  getDraft(id: string): Promise<{ id: string; message: GmailFull }>;
  deleteDraft(id: string): Promise<void>;
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

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
      return (await r.json()) as { id: string };
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
  };
}
