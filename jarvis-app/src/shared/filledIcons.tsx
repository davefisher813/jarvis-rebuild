// THE FILLED GLYPH SET (Catalog V4, Dave 2026-08-18). Nav lists wear filled
// brand-red glyphs the way Apple Music's Library does. LAW: filled glyphs are
// DRAWN as filled shapes with detail cut out in the page black; pouring
// fill into a stroke icon makes blobs (the compass bug) and is banned.
// Outline icons stay the content-row state; a surface never mixes states.

import type { ReactNode } from "react";

const f = (children: ReactNode) => (
  <svg className="ic" viewBox="0 0 24 24" fill="none">{children}</svg>
);

// Cutout color: the page background. Nav lists render on pure black.
const CUT = "#000";

export const FILLED: Record<string, ReactNode> = {
  // ---- Brain hub rows ----
  contacts: f(<><circle cx="9" cy="7" r="4" fill="currentColor" /><path d="M1.5 21c0-3.6 3.2-6 7.5-6s7.5 2.4 7.5 6z" fill="currentColor" /><circle cx="17.5" cy="8" r="3" fill="currentColor" /><path d="M16 15.2c2.1-.9 6.5.3 6.5 4.3h-4.6z" fill="currentColor" /></>),
  decisions: f(<><line x1="6" y1="4" x2="6" y2="14" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" /><circle cx="18" cy="6" r="3.4" fill="currentColor" /><circle cx="6" cy="18" r="3.4" fill="currentColor" /><path d="M18 9a9 9 0 0 1-9 9" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" /></>),
  philosophy: f(<><circle cx="12" cy="12" r="10" fill="currentColor" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88" fill={CUT} /></>),
  writing: f(<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" fill="currentColor" />),
  values: f(<><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" fill="currentColor" /><line x1="4" y1="22" x2="4" y2="15" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" /></>),
  routine: f(<><circle cx="12" cy="12" r="10" fill="currentColor" /><polyline points="12 6.5 12 12 15.5 14" stroke={CUT} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" /></>),

  // ---- More rows (destination keys) ----
  today: f(<path d="M3 10.5 12 3l9 7.5V21h-6v-6h-6v6H3z" fill="currentColor" />),
  tasks: f(<><rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" /><polyline points="8 12 11 15 16 9" stroke={CUT} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" /></>),
  schedule: f(<><rect x="3" y="4" width="18" height="17" rx="3" fill="currentColor" /><rect x="3" y="4" width="18" height="6" rx="3" fill="currentColor" /><line x1="3" y1="10" x2="21" y2="10" stroke={CUT} strokeWidth={1.6} /><line x1="8" y1="2.5" x2="8" y2="6" stroke={CUT} strokeWidth={2} strokeLinecap="round" /><line x1="16" y1="2.5" x2="16" y2="6" stroke={CUT} strokeWidth={2} strokeLinecap="round" /></>),
  brain: f(<path d="M12 3c-1.6 0-2.9.8-3.6 2A4.4 4.4 0 0 0 4 9.4c0 .8.2 1.5.6 2.2A4.4 4.4 0 0 0 6 19.5c.6 1.5 2 2.5 3.7 2.5 1 0 1.8-.3 2.3-.9.5.6 1.4.9 2.3.9 1.7 0 3.1-1 3.7-2.5a4.4 4.4 0 0 0 1.4-7.9c.4-.7.6-1.4.6-2.2A4.4 4.4 0 0 0 15.6 5 4.1 4.1 0 0 0 12 3z" fill="currentColor" />),
  notes: f(<><path d="M13.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8.5z" fill="currentColor" /><path d="M13.5 2v6.5H20z" fill={CUT} opacity="0.45" /></>),
  bigger: f(<><circle cx="12" cy="12" r="10" fill="currentColor" /><circle cx="12" cy="12" r="6" fill={CUT} /><circle cx="12" cy="12" r="3" fill="currentColor" /></>),
  messages: f(<path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4V5a2 2 0 0 1 2-2z" fill="currentColor" />),
  notifications: f(<><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" fill="currentColor" /><path d="M13.73 21a2 2 0 0 1-3.46 0z" fill="currentColor" /></>),
  money: f(<><path d="M3 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1H5a2 2 0 0 1-2-2z" fill="currentColor" /><path d="M3 7h17a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="currentColor" /><rect x="15" y="12" width="7" height="4" rx="1.4" fill={CUT} /></>),
  chat: f(<path d="M12 2.5l2 5.3 5.3 2-5.3 2-2 5.3-2-5.3-5.3-2 5.3-2zM19 14.5l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z" fill="currentColor" />),
  settings: f(<><path d="M10.9 2h2.2l.5 2.4 1.9.8 2-1.3 1.6 1.6-1.3 2 .8 1.9 2.4.5v2.2l-2.4.5-.8 1.9 1.3 2-1.6 1.6-2-1.3-1.9.8-.5 2.4h-2.2l-.5-2.4-1.9-.8-2 1.3-1.6-1.6 1.3-2-.8-1.9L2 13.1v-2.2l2.4-.5.8-1.9-1.3-2 1.6-1.6 2 1.3 1.9-.8z" fill="currentColor" /><circle cx="12" cy="12" r="3.2" fill={CUT} /></>),
};

// A nav destination with no drawn filled glyph yet falls back to a filled
// disc so the wash stays uniform (and the gap is obvious in review).
export const FILLED_FALLBACK: ReactNode = f(<circle cx="12" cy="12" r="9" fill="currentColor" />);

export function filledIcon(key: string): ReactNode {
  return FILLED[key] ?? FILLED_FALLBACK;
}

// ---- Settings hub rows (Dave 2026-08-18: "settings in all red too") ----
// Line-built icons (link, sliders) take the filled state as bold 2.6 strokes,
// same treatment as the decisions fork; solid shapes fill with cutouts.
export const FILLED_SETTINGS: Record<string, ReactNode> = {
  account: f(<><circle cx="12" cy="7" r="4.2" fill="currentColor" /><path d="M3.5 21c0-4 3.8-6.4 8.5-6.4s8.5 2.4 8.5 6.4z" fill="currentColor" /></>),
  notifsettings: f(<><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" fill="currentColor" /><path d="M13.73 21a2 2 0 0 1-3.46 0z" fill="currentColor" /></>),
  appearance: f(<><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.504 5.555-5.555C21.965 6.012 17.461 2 12 2z" fill="currentColor" /><circle cx="13.5" cy="6.5" r="1" fill={CUT} /><circle cx="8.5" cy="7.5" r="1" fill={CUT} /><circle cx="6.5" cy="12.5" r="1" fill={CUT} /></>),
  categories: f(<><path d="M10.9 2h2.2l.5 2.4 1.9.8 2-1.3 1.6 1.6-1.3 2 .8 1.9 2.4.5v2.2l-2.4.5-.8 1.9 1.3 2-1.6 1.6-2-1.3-1.9.8-.5 2.4h-2.2l-.5-2.4-1.9-.8-2 1.3-1.6-1.6 1.3-2-.8-1.9L2 13.1v-2.2l2.4-.5.8-1.9-1.3-2 1.6-1.6 2 1.3 1.9-.8z" fill="currentColor" /><circle cx="12" cy="12" r="3.2" fill={CUT} /></>),
  edittabs: f(<><rect x="3" y="3" width="18" height="18" rx="3" fill="currentColor" /><line x1="3" y1="15" x2="21" y2="15" stroke={CUT} strokeWidth={1.8} /><line x1="9" y1="15" x2="9" y2="21" stroke={CUT} strokeWidth={1.8} /><line x1="15" y1="15" x2="15" y2="21" stroke={CUT} strokeWidth={1.8} /></>),
  connections: f(<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" /></>),
  aicontrol: f(<path d="M12 2.5l2 5.3 5.3 2-5.3 2-2 5.3-2-5.3-5.3-2 5.3-2zM19 14.5l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z" fill="currentColor" />),
  learned: f(<><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.4 1 2.3h6c0-.9.4-1.8 1-2.3A7 7 0 0 0 12 2z" fill="currentColor" /><line x1="9" y1="19.2" x2="15" y2="19.2" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" /><line x1="10" y1="22" x2="14" y2="22" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" /></>),
  backup: f(<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" fill="currentColor" />),
  advanced: f(<><line x1="4" y1="21" x2="4" y2="14" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" /><line x1="4" y1="10" x2="4" y2="3" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" /><line x1="12" y1="21" x2="12" y2="12" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" /><line x1="12" y1="8" x2="12" y2="3" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" /><line x1="20" y1="21" x2="20" y2="16" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" /><line x1="20" y1="12" x2="20" y2="3" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" /><line x1="1" y1="14" x2="7" y2="14" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" /><line x1="9" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" /><line x1="17" y1="16" x2="23" y2="16" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" /></>),
  about: f(<><circle cx="12" cy="12" r="10" fill="currentColor" /><line x1="12" y1="16.5" x2="12" y2="11.5" stroke={CUT} strokeWidth={2.4} strokeLinecap="round" /><circle cx="12" cy="8" r="1.3" fill={CUT} /></>),
};

export function filledSettingsIcon(route: string): ReactNode {
  return FILLED_SETTINGS[route] ?? FILLED_FALLBACK;
}
