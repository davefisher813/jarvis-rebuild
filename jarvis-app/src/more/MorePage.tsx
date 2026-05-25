import type { ReactNode } from "react";
import type { Destination } from "../shell/destinations";

const svg = (children: ReactNode) => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const Gear = () => svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>);
const Chev = () => (
  <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
);

export type MoreRoute = "settings" | "profile" | "appearance" | "categories" | "edittabs" | "account" | "notifsettings" | "about" | "advanced" | "backup";

const EXTRA_TILE: Record<string, string> = {
  today: "ico-accent", tasks: "cat-bg-blue", schedule: "cat-bg-sky", brain: "cat-bg-green", notes: "ico-accent",
  goals: "ico-accent", projects: "cat-bg-sky", messages: "cat-bg-green", notifications: "cat-bg-red", money: "cat-bg-green", insights: "cat-bg-blue",
};

export default function MorePage({ extras, onOpenExtra, onNavigate }: {
  extras: Destination[]; onOpenExtra: (key: string) => void; onNavigate: (route: MoreRoute) => void;
}) {
  return (
    <div className="screen">
      <div className="nav-bar"><div className="nav-large">More</div></div>

      <div className="pad-x"><div className="card">
        <div className="row" role="button" tabIndex={0} onClick={() => onNavigate("settings")}>
          <div className="sec-ico ico-surface"><Gear /></div>
          <div className="row-grow"><div className="conn-name">Settings</div></div>
          <Chev />
        </div>
      </div></div>

      {extras.length > 0 && (
        <>
          <div className="grp"><div className="eyebrow">Your Stuff</div></div>
          <div className="pad-x"><div className="card">
            {extras.map((d) => (
              <div className="row" role="button" tabIndex={0} key={d.key} onClick={() => onOpenExtra(d.key)}>
                <div className={"sec-ico " + (EXTRA_TILE[d.key] ?? "ico-surface")}><d.Icon className="ic" /></div>
                <div className="row-grow"><div className="conn-name">{d.label}</div></div>
                <Chev />
              </div>
            ))}
          </div></div>
        </>
      )}
    </div>
  );
}
