import type { ReactNode } from "react";

// The icon set a category may carry, shared by the Brain hub, the Categories
// list, and the icon picker so they never drift. Keys match defaults.ts.
const svg = (children: ReactNode) => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const Briefcase = () => svg(<><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></>);
const Heart = () => svg(<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" />);
const Dumbbell = () => svg(<><path d="m6.5 6.5 11 11" /><path d="m21 21-1-1" /><path d="m3 3 1 1" /><path d="m18 22 4-4" /><path d="m2 6 4-4" /><path d="m3 10 7-7" /><path d="m14 21 7-7" /></>);
const Wallet = () => svg(<><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" /><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" /></>);
const Users = () => svg(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>);
const User = () => svg(<><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>);
const Settings = () => svg(<><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>);
const Folder = () => svg(<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />);
const TrendingUp = () => svg(<><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></>);
const Book = () => svg(<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />);
const Trophy = () => svg(<><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z" /></>);
const Tag = () => svg(<><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" /><circle cx="7.5" cy="7.5" r=".5" fill="currentColor" /></>);

const Plane = () => svg(<path d="M17.8 19.2 16 11l3.5-3.5A2.12 2.12 0 0 0 16.5 4.5L13 8 4.8 6.2a.5.5 0 0 0-.5.8l3.2 3.2-2 2-1.7-.4a.5.5 0 0 0-.5.8L5 14.5l1.9 1.9 1.9-.9a.5.5 0 0 0 .8-.5l-.4-1.7 2-2 3.2 3.2a.5.5 0 0 0 .8-.5Z" />);
const Car = () => svg(<><path d="M19 17h2v-5.6a1 1 0 0 0-.1-.5l-1.9-3.4A2 2 0 0 0 17.2 6H6.8a2 2 0 0 0-1.8 1.5L3.1 10.9a1 1 0 0 0-.1.5V17h2" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /><path d="M9 17h6" /></>);
const Home = () => svg(<><path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M9 21v-8h6v8" /></>);
const School = () => svg(<><path d="m12 3 10 5-10 5L2 8Z" /><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" /></>);
const Pet = () => svg(<><circle cx="6" cy="9" r="2" /><circle cx="10" cy="5" r="2" /><circle cx="14" cy="5" r="2" /><circle cx="18" cy="9" r="2" /><path d="M12 11c-2.5 0-5 2.5-5 5.5 0 2 1.5 3 3 3 1 0 1.5-.5 2-.5s1 .5 2 .5c1.5 0 3-1 3-3 0-3-2.5-5.5-5-5.5Z" /></>);
const Music = () => svg(<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>);
const Palette = () => svg(<><circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /><path d="M12 2a10 10 0 0 0 0 20 2 2 0 0 0 2-2v-1a2 2 0 0 1 2-2h1a4 4 0 0 0 4-4 10 10 0 0 0-9-11Z" /></>);
const Ball = () => svg(<><circle cx="12" cy="12" r="10" /><path d="M12 2a8 8 0 0 0 0 20M12 2a8 8 0 0 1 0 20" /></>);
const Camera = () => svg(<><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3Z" /><circle cx="12" cy="13" r="3" /></>);
const Coffee = () => svg(<><path d="M17 8h1a4 4 0 1 1 0 8h-1" /><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" /><path d="M6 2v2M10 2v2M14 2v2" /></>);
const Globe = () => svg(<><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20Z" /></>);
const Medical = () => svg(<><path d="M11 2h2v20h-2z" /><path d="M2 11h20v2H2z" /></>);
const Pill = () => svg(<><path d="m10.5 20.5 10-10a5 5 0 0 0-7-7l-10 10a5 5 0 0 0 7 7Z" /><path d="m8.5 8.5 7 7" /></>);
const Leaf = () => svg(<><path d="M11 20A7 7 0 0 1 4 13c0-6 5-9 16-10 1 10-2 17-9 17Z" /><path d="M4 21c2-6 5-9 9-11" /></>);
const Bed = () => svg(<><path d="M2 8v12M2 12h20v8" /><path d="M22 12V9a2 2 0 0 0-2-2h-8v5" /><circle cx="7" cy="10" r="2" /></>);
const Card = () => svg(<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>);
const Bank = () => svg(<><path d="m3 10 9-6 9 6" /><path d="M5 10v9M9 10v9M15 10v9M19 10v9" /><path d="M2 21h20" /></>);
const Cart = () => svg(<><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M2 3h3l2.4 11.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 7H6" /></>);
const Chart = () => svg(<><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></>);
const Bulb = () => svg(<><path d="M9 18h6M10 22h4" /><path d="M12 2a6 6 0 0 0-4 10.5c.6.7 1 1.5 1 2.5h6c0-1 .4-1.8 1-2.5A6 6 0 0 0 12 2Z" /></>);
const Scale = () => svg(<><path d="M12 3v18M7 21h10" /><path d="m5 7 14-2" /><path d="M5 7 2 14h6ZM19 5l-3 7h6Z" /></>);
const Code = () => svg(<><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></>);
const Mail = () => svg(<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="m2 7 10 6 10-6" /></>);
const Phone = () => svg(<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" />);
const Note = () => svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M9 13h6M9 17h4" /></>);
const Building = () => svg(<><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 6h1M14 6h1M9 10h1M14 10h1M9 14h1M14 14h1" /><path d="M10 22v-4h4v4" /></>);
const Flag = () => svg(<><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1Z" /><path d="M4 22v-7" /></>);
const Star = () => svg(<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.3-6.2 3.3L7 14.2l-5-4.9 6.9-1Z" />);
const Fire = () => svg(<path d="M12 2s4 4 4 8a4 4 0 0 1-8 0c0-1 .5-2 .5-2S6 11 6 14a6 6 0 0 0 12 0c0-5-6-12-6-12Z" />);
const Target = () => svg(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /></>);

// FORTY ICONS, GROUPED (Dave 2026-08-21: "I need way more icon options").
// The order here IS the picker order, and the groups are what keep forty
// findable: you scan to the family, then pick inside it. Eleven was not a
// set, it was what happened to get drawn first.
export const ICON_GROUPS: { label: string; keys: string[] }[] = [
  { label: "Work", keys: ["briefcase", "building", "chart", "code", "note", "mail", "phone", "scale"] },
  { label: "People & Home", keys: ["users", "user", "heart", "home", "pet", "coffee", "bed"] },
  { label: "Health & Body", keys: ["dumbbell", "medical", "pill", "leaf", "ball", "target", "fire"] },
  { label: "Money", keys: ["wallet", "bank", "card", "cart", "trending-up"] },
  { label: "Play & Places", keys: ["trophy", "music", "palette", "book", "camera", "plane", "car", "globe", "school", "star", "flag", "bulb"] },
  { label: "Other", keys: ["settings", "folder"] },
];

export const CAT_ICONS: Record<string, () => ReactNode> = {
  briefcase: Briefcase, building: Building, chart: Chart, code: Code,
  note: Note, mail: Mail, phone: Phone, scale: Scale,
  users: Users, user: User, heart: Heart, home: Home, pet: Pet,
  coffee: Coffee, bed: Bed,
  dumbbell: Dumbbell, medical: Medical, pill: Pill, leaf: Leaf,
  ball: Ball, target: Target, fire: Fire,
  wallet: Wallet, bank: Bank, card: Card, cart: Cart, "trending-up": TrendingUp,
  trophy: Trophy, music: Music, palette: Palette, book: Book, camera: Camera,
  plane: Plane, car: Car, globe: Globe, school: School, star: Star,
  flag: Flag, bulb: Bulb,
  settings: Settings, folder: Folder,
};
export const ICON_KEYS = Object.keys(CAT_ICONS);
export function catIcon(key?: string): ReactNode {
  return (CAT_ICONS[key ?? ""] ?? Tag)();
}
