import type { ReactNode } from "react";
import type { Destination } from "../shell/destinations";

const svg = (children: ReactNode) => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const Gear = () => svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>);
const Chev = () => (
  <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
);

export type MoreRoute = "settings" | "profile" | "appearance" | "categories" | "edittabs" | "account" | "notifsettings" | "about" | "advanced" | "backup" | "connections" | "aicontrol" | "learned";

// Section tiles. Two rules, both of them load-bearing:
//
// 1. NO RED. Every row here is navigation, not an action and not a selection.
//    Red is reserved for the selected tab, primary buttons, and capture. This
//    screen previously had four red tiles, which broke the one-red-per-screen
//    law and made red mean nothing.
// 2. These use their own nav-tile-* classes rather than the cat-bg-* category
//    palette, so section colour and user-category colour can evolve apart.
//    Note the hexes are currently the SAME: this is separation of meaning, not
//    of appearance. It is safe only because section tiles render on this screen
//    alone and this screen shows no user categories. If the two ever need to
//    share a surface, separate them by FORM (small solid dot vs rounded icon
//    tile), never by hue: users pick from the same 14 slots, so no hue can be
//    reserved for the app. The one exception is brand red, which the category
//    palette genuinely excludes (COLOR_SLOTS), which is what makes rule 1 hold.
//
// One stable hue per destination, loosely mnemonic: paper-yellow notes,
// money-green, sunrise-orange today. Anything unmapped falls back to neutral.
// Catalog V3.1 library form (approved 2026-08-18): content navigation renders
// as the Apple Music list, bare colored glyphs instead of tiles, each keeping
// its section hue. Chat is the one red glyph: it IS JARVIS, so the brand mark
// is honest there (the old no-red rule was about red meaning nothing when
// navigation borrowed it; chat is not borrowing).
const EXTRA_FG: Record<string, string> = {
  today: "cat-fg-orange",
  tasks: "cat-fg-blue",
  schedule: "cat-fg-sky",
  brain: "cat-fg-purple",
  notes: "cat-fg-yellow",
  bigger: "cat-fg-indigo",
  messages: "cat-fg-teal",
  notifications: "lib-ico-neutral",
  money: "cat-fg-green",
  chat: "cat-fg-red",
};

export default function MorePage({ extras, onOpenExtra, onNavigate }: {
  extras: Destination[]; onOpenExtra: (key: string) => void; onNavigate: (route: MoreRoute) => void;
}) {
  return (
    <div className="screen">
      <div className="nav-bar"><div className="nav-large">More</div></div>

      <div className="pad-x"><div className="card">
        <div className="lib-row" role="button" tabIndex={0} onClick={() => onNavigate("settings")}>
          <div className="lib-ico lib-ico-neutral"><Gear /></div>
          <div className="lib-name">Settings</div>
          <Chev />
        </div>
      </div></div>

      {extras.length > 0 && (
        <>
          <div className="grp"><div className="eyebrow">Your Stuff</div></div>
          <div className="pad-x"><div className="card">
            {extras.map((d) => (
              <div className="lib-row" role="button" tabIndex={0} key={d.key} onClick={() => onOpenExtra(d.key)}>
                <div className={"lib-ico " + (EXTRA_FG[d.key] ?? "lib-ico-neutral")}><d.Icon className="ic" /></div>
                <div className="lib-name">{d.label}</div>
                <Chev />
              </div>
            ))}
          </div></div>
        </>
      )}
    </div>
  );
}
