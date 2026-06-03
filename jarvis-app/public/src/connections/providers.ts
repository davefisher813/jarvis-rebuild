import type { ProfileData } from "../profile/types";

// The integration surface. Adding a future source (Apple Health, a now-playing
// track from Apple Music, a Watch reading, a glasses photo) is a new entry here
// plus records in the existing entity model, never a rewrite. "kind" marks what
// a PWA can reach (web) versus what waits for the native build (native).
export type ProviderKind = "web" | "native";

export interface Provider {
  key: string;
  label: string;
  kind: ProviderKind;
  experimental?: boolean;
}

export const PROVIDERS: Provider[] = [
  { key: "gmail", label: "Gmail", kind: "web" },
  { key: "googleCalendar", label: "Google Calendar", kind: "web" },
  { key: "appleMusic", label: "Apple Music", kind: "web" },
  { key: "appleHealth", label: "Apple Health", kind: "native" },
  { key: "appleWatch", label: "Apple Watch", kind: "native" },
  { key: "metaGlasses", label: "Meta Glasses", kind: "native", experimental: true },
];

export const webProviders = (): Provider[] => PROVIDERS.filter((p) => p.kind === "web");
export const nativeProviders = (): Provider[] => PROVIDERS.filter((p) => p.kind === "native");
export const providerOf = (key: string): Provider | undefined => PROVIDERS.find((p) => p.key === key);

// Connection status, reading the generic map and falling back to the legacy
// onboarding flags so nothing already captured is lost.
export function isConnected(profile: ProfileData | null | undefined, key: string): boolean {
  if (!profile) return false;
  if (profile.connections && key in profile.connections) return !!profile.connections[key];
  if (key === "gmail") return !!profile.gmail;
  if (key === "googleCalendar") return !!profile.calendar;
  return false;
}
