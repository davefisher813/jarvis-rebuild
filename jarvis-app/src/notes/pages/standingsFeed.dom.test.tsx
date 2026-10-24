// @vitest-environment jsdom
// Finishing a two-team Scoreboard game puts it in the League Standings the person already has, through the real Notes flow.
import "../../shared/tiptapTest";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useNotes } from "../../data/NotesProvider";
import NotesFlow from "../NotesFlow";
import { addRecord, type PageData } from "./pageModel";
import { newTemplatePage } from "./templateDefs";
import { newScoreboardPage, setPeriodScore } from "./scoreboard";

let svcRef: ReturnType<typeof useNotes> | null = null;
function Grab() { svcRef = useNotes(); return null; }
afterEach(() => { cleanup(); svcRef = null; });

const gamesOf = async (id: string) => (await svcRef!.note(id))!.page!.games ?? [];

async function setup(user: string, teams: string[]) {
  svcRef = null;
  const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
  await waitFor(() => expect(svcRef).toBeTruthy());
  let league: PageData = newTemplatePage("standings");
  for (const n of teams) league = addRecord(league, { name: n }).page;
  let game = newScoreboardPage("basketball", ["Tigers", "Bears"], "2026-10-23");
  game = setPeriodScore(game, game.records[0]!.id, 1, 20);
  game = setPeriodScore(game, game.records[1]!.id, 1, 12);
  let lid = "", gid = "";
  await act(async () => {
    lid = (await svcRef!.createPage("Town League", league))!;
    gid = (await svcRef!.createPage("Tigers vs Bears", game))!;
  });
  view.rerender(<NotesProvider userId={user}><Grab /><NotesFlow openId={gid} /></NotesProvider>);
  // Keep Scoring opens the next quarter (the second, with the first already in); Next walks to the fourth; Finish is the last tap.
  fireEvent.click(await screen.findByText("Keep Scoring", {}, { timeout: 4000 }));
  for (let q = 3; q <= 4; q++) fireEvent.click(await screen.findByText(`Next: Quarter ${q}`));
  return { lid };
}

describe("a finished Scoreboard game feeds the League Standings", () => {
  it("lands in the table when the league has both teams", async () => {
    const { lid } = await setup("u-feed-yes", ["Tigers", "Bears"]);
    fireEvent.click(await screen.findByText("Finish"));
    await waitFor(async () => expect(await gamesOf(lid)).toHaveLength(1), { timeout: 4000 });
    expect((await gamesOf(lid))[0]).toMatchObject({ sa: 20, sb: 12 });
  });
  it("does not land, and makes no team, when the league does not know both names", async () => {
    const { lid } = await setup("u-feed-no", ["Tigers", "Owls"]);
    fireEvent.click(await screen.findByText("Finish"));
    await screen.findByText("Keep Scoring", {}, { timeout: 4000 }).catch(() => undefined);
    expect(await gamesOf(lid)).toHaveLength(0);
    expect((await svcRef!.note(lid))!.page!.records).toHaveLength(2);
  });
});
