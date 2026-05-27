import { backendConfigured } from "../data/store";

export interface AIMessage {
  role: "user" | "assistant";
  content: string;
}

interface AIServiceOpts {
  endpoint?: string;
  available?: boolean;
  fetchImpl?: typeof fetch;
  getToken?: () => string | undefined;
}

// Client for the AI layer. It never holds the Anthropic key; it POSTs to the
// server function (/api/ai), which is the only thing that talks to Anthropic.
// "available" is false in the in-memory / no-backend build, so the UI can hide AI.
export class AIService {
  private endpoint: string;
  private fetchImpl: typeof fetch;
  private getToken?: () => string | undefined;
  readonly available: boolean;

  constructor(opts: AIServiceOpts = {}) {
    this.endpoint = opts.endpoint ?? "/api/ai";
    this.fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.getToken = opts.getToken;
    this.available = opts.available ?? backendConfigured;
  }

  async complete(messages: AIMessage[], system?: string): Promise<string> {
    if (!this.available) throw new Error("AI is not configured in this build.");
    const token = this.getToken?.();
    const res = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ messages, system }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`AI request failed (${res.status}). ${detail}`.trim());
    }
    const data = (await res.json()) as { text?: string };
    return data.text ?? "";
  }
}
