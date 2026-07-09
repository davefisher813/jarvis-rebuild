// Where the serverless APIs live. On the website this is empty (same-origin
// relative paths, exactly the current behavior). Inside the native app the
// bundle is served from capacitor://localhost, so relative /api paths have
// nowhere to go: the native build sets VITE_API_BASE to the deployed origin
// (e.g. https://jarvis-rebuild.vercel.app) and every API call routes there.
export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
