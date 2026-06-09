import type { GoogleApi } from "./api";
import type { GCalEvent, GmailMeta, GmailFull } from "./map";

// A complete GoogleApi stub for tests and the bench. Override only the methods a
// given test exercises; the rest return empty/no-op so the type stays satisfied.
export function makeFakeGoogleApi(o: Partial<GoogleApi> = {}): GoogleApi {
  return {
    listUpcomingEvents: o.listUpcomingEvents ?? (async () => [] as GCalEvent[]),
    listRecentMessages: o.listRecentMessages ?? (async () => [] as GmailMeta[]),
    listInbox: o.listInbox ?? (async () => [] as GmailMeta[]),
    getMessage: o.getMessage ?? (async (id: string) => ({ id }) as GmailFull),
    sendMessage: o.sendMessage ?? (async () => ({ id: "sent_1" })),
    modifyMessage: o.modifyMessage ?? (async () => {}),
    listDrafts: o.listDrafts ?? (async () => []),
    getDraft: o.getDraft ?? (async (id: string) => ({ id, message: { id } as GmailFull })),
    deleteDraft: o.deleteDraft ?? (async () => {}),
  };
}
