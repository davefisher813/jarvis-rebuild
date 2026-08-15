import type { Store, ItemData } from "@core";
import { ENTITY_CHAT, type ChatMessageData } from "./types";

export interface ChatMessage {
  id: string;
  data: ChatMessageData;
}

// Chat history, stored per user as entities (addendum item 23). Deletable by
// ONE real button in Settings (clearAll), same pattern as the event-log
// delete commitment: deleted means deleted.
export class ChatService {
  constructor(private store: Store, private ownerId: string) {}

  async list(): Promise<ChatMessage[]> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_CHAT);
    return items
      .map((i) => ({ id: i.id, data: i.data as unknown as ChatMessageData }))
      .sort((a, b) => a.data.ts.localeCompare(b.data.ts));
  }

  async append(data: Omit<ChatMessageData, "ts">): Promise<string> {
    const full: ChatMessageData = { ...data, ts: new Date().toISOString() };
    return this.store.create(this.ownerId, ENTITY_CHAT, full as unknown as ItemData);
  }

  // The Settings button. Hard deletes, every row.
  async clearAll(): Promise<number> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_CHAT);
    for (const i of items) await this.store.delete(this.ownerId, i.id);
    return items.length;
  }
}
