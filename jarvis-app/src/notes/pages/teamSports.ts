// TEAM SHEET POSITIONS BY SPORT (the 2026-10-13 spec, auto-adjust rule 3: "Team Sheet positions by sport" is one of the flagship
// adjustments). The sheet starts at its smallest: Position is a line of text. Pick the sport and Position offers that sport's spots
// instead; a position already typed stays exactly as it was, whatever the list says, and nothing else on the sheet moves. Pick
// "Any Sport" and Position is text again, every value kept.

import type { PageData, PageField } from "./pageModel";

export interface TeamSport { key: string; name: string; positions: string[] }

export const TEAM_SPORTS: TeamSport[] = [
  { key: "baseball", name: "Baseball", positions: ["Pitcher", "Catcher", "First Base", "Second Base", "Third Base", "Shortstop", "Left Field", "Center Field", "Right Field", "Designated Hitter"] },
  { key: "softball", name: "Softball", positions: ["Pitcher", "Catcher", "First Base", "Second Base", "Third Base", "Shortstop", "Left Field", "Center Field", "Right Field", "Utility"] },
  { key: "basketball", name: "Basketball", positions: ["Point Guard", "Shooting Guard", "Small Forward", "Power Forward", "Center"] },
  { key: "soccer", name: "Soccer", positions: ["Goalkeeper", "Defender", "Midfielder", "Forward"] },
  { key: "football", name: "Football", positions: ["Quarterback", "Running Back", "Wide Receiver", "Tight End", "Offensive Line", "Defensive Line", "Linebacker", "Cornerback", "Safety", "Kicker", "Punter"] },
  { key: "hockey", name: "Hockey", positions: ["Goalie", "Defense", "Center", "Left Wing", "Right Wing"] },
  { key: "volleyball", name: "Volleyball", positions: ["Setter", "Outside Hitter", "Middle Blocker", "Opposite", "Libero", "Defensive Specialist"] },
  { key: "lacrosse", name: "Lacrosse", positions: ["Goalie", "Defense", "Midfield", "Attack"] },
];

export const teamSportOf = (key: string | undefined): TeamSport | undefined => TEAM_SPORTS.find((s) => s.key === (key ?? ""));

/** The sheet's sport, and with it what Position offers. Values never move: a typed position that is not on the new list is still
 *  the row's position, drawn as typed. */
export function setTeamSport(page: PageData, key: string): PageData {
  const sp = teamSportOf(key);
  const { sport: _s, ...rest } = page.meta ?? {};
  void _s;
  const meta = sp ? { ...rest, sport: sp.key } : rest;
  const fields: PageField[] = page.fields.map((f) => {
    if (f.key !== "position") return f;
    if (sp) return { ...f, type: "choice", options: [...sp.positions] };
    const { options: _o, ...plain } = f;
    void _o;
    return { ...plain, type: "text" };
  });
  const { meta: _m, ...without } = page;
  void _m;
  return { ...without, fields, ...(Object.keys(meta).length ? { meta } : {}) };
}
