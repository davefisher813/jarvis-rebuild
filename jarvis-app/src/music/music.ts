// Music, Tier 1 (addendum item 5). No SDKs, no OAuth, no playback control:
// a REMEMBERED DEEP LINK per context. The first use introduces itself as a
// picker; the choice is remembered for that context and becomes one tap;
// Forget deletes the memory (self-deleting). Tier 2 (Spotify Connect) is a
// separate build gated on OAuth env vars; nothing here assumes it.

export interface MusicChoice {
  label: string;
  url: string;
}

export type MusicContext = "focus" | "gym";

const KEY = "jarvis.music.v1";

type Shape = Partial<Record<MusicContext, MusicChoice>>;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readAll(): Shape {
  const s = storage();
  if (!s) return {};
  try {
    return (JSON.parse(s.getItem(KEY) || "{}") as Shape) || {};
  } catch {
    return {};
  }
}

export function musicFor(context: MusicContext): MusicChoice | null {
  const c = readAll()[context];
  return c && typeof c.url === "string" && c.url ? c : null;
}

export function rememberMusic(context: MusicContext, choice: MusicChoice): void {
  const s = storage();
  if (!s) return;
  try {
    const all = readAll();
    all[context] = choice;
    s.setItem(KEY, JSON.stringify(all));
  } catch { /* memory is a nicety */ }
}

export function forgetMusic(context: MusicContext): void {
  const s = storage();
  if (!s) return;
  try {
    const all = readAll();
    delete all[context];
    s.setItem(KEY, JSON.stringify(all));
  } catch { /* already effectively forgotten */ }
}

// The app-open presets. A pasted playlist link replaces these with something
// sharper; these just open the player.
export const MUSIC_PRESETS: MusicChoice[] = [
  { label: "Spotify", url: "https://open.spotify.com" },
  { label: "Apple Music", url: "https://music.apple.com" },
];

// A pasted link earns a label from its host; anything unrecognized keeps a
// plain name rather than a guess.
export function labelForUrl(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (host.includes("spotify")) return "Spotify Playlist";
    if (host.includes("music.apple")) return "Apple Music Playlist";
    if (host.includes("youtube") || host.includes("youtu.be")) return "YouTube";
    return "Your Link";
  } catch {
    return "Your Link";
  }
}
