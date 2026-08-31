import type { Destination } from "../shell/destinations";
import PageHeader from "../shared/PageHeader";
import { filledIcon } from "../shared/filledIcons";

const Chev = () => (
  <div className="chev" />
);

export type MoreRoute = "settings" | "profile" | "appearance" | "categories" | "edittabs" | "account" | "notifsettings" | "about" | "advanced" | "backup" | "connections" | "aicontrol" | "learned" | "training";

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
// CATALOG V4 (approved 2026-08-18): More is a NAV LIST, the Apple Music
// Library form exactly. One flat headerless list, every glyph the brand red
// in the FILLED state (drawn filled, never auto-filled strokes). Settings is
// the trailing system cluster, separated by the one legal unlabeled gap.
export default function MorePage({ extras, onOpenExtra, onNavigate }: {
  extras: Destination[]; onOpenExtra: (key: string) => void; onNavigate: (route: MoreRoute) => void;
}) {
  return (
    <div className="screen">
      <PageHeader title="More" />

      {extras.map((d) => (
        <div className="lib-row" role="button" tabIndex={0} key={d.key} onClick={() => onOpenExtra(d.key)}>
          <div className="lib-ico lib-ico-brand">{filledIcon(d.key)}</div>
          <div className="lib-name">{d.label}</div>
          <Chev />
        </div>
      ))}

      <div className="lib-row lib-gap" role="button" tabIndex={0} onClick={() => onNavigate("settings")}>
        <div className="lib-ico lib-ico-brand">{filledIcon("settings")}</div>
        <div className="lib-name">Settings</div>
        <Chev />
      </div>
    </div>
  );
}
