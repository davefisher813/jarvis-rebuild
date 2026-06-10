// Google integration config. The whole integration is dormant until a Google
// OAuth client id is provided at build time (VITE_GOOGLE_CLIENT_ID). Scopes are
// read-only: we never modify the user's mail or calendar.
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
].join(" ");

export function googleClientId(): string {
  try {
    return (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_GOOGLE_CLIENT_ID || "";
  } catch {
    return "";
  }
}

export function googleConfigured(clientId: string = googleClientId()): boolean {
  return clientId.trim().length > 0;
}
