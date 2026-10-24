// @vitest-environment jsdom
// THE REBUILT GOLF SCREENS, through the real Notes flow over the real store (Dave's Golf decision, 2026-10-23): the stats strip a tap deep,
// the real grid with a tap to fix any hole, Finish writing the Rounds page, and a course coming back with its pars.
import "../../shared/tiptapTest";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useNotes } from "../../data/NotesProvider";
import NotesFlow from "../NotesFlow";
import { newScorecardPage, type PageData } from "./pageModel";
import { setHolePar } from "./golf";

let svcRef: ReturnType<typeof useNotes> | null = null;
function Grab() { svcRef = useNotes(); return null; }
const svc = () => svcRef!;
afterEach(() => { cleanup(); svcRef = null; });

async function openRound(user: string, page: PageData) {
  svcRef = null;
  const view = render(<NotesProvider userId={user}><Grab /><NotesFlow /></NotesProvider>);
  await waitFor(() => expect(svcRef).toBeTruthy());
  let id = "";
  await act(async () => { id = (await svc().createPage("Pebble Beach", page))!; });
  view.rerender(<NotesProvider userId={user}><Grab /><NotesFlow openId={id} /></NotesProvider>);
  return id;
}
const withPars = (n: 9 | 18 = 9): PageData => {
  let p = newScorecardPage({ course: "Pebble Beach", holes: n, players: ["Dave"], date: "2026-10-23" });
  for (let h = 1; h <= n; h++) p = setHolePar(p, h, 4);
  return p;
};
const rec = async (id: string) => (await svc().note(id))!.page!.records[0]!.v;

describe("golf screens", () => {
  it("the stats strip is one tap deep, one tap per stat, and the green is worked out and never asked", async () => {
    const id = await openRound("u-golf-stats", withPars());
    fireEvent.click(await screen.findByText("Start Hole 1", {}, { timeout: 4000 }));
    fireEvent.click(await screen.findByLabelText("Strokes 4 for Dave"));
    fireEvent.click(screen.getByText("Stats"));
    fireEvent.click(screen.getByLabelText("Putts 2 for Dave"));
    fireEvent.click(screen.getByLabelText("Fairway Left for Dave"));
    fireEvent.click(screen.getByLabelText("Penalties 1 for Dave"));
    fireEvent.click(screen.getByLabelText("Sand shot for Dave"));
    expect(await screen.findByText("Green in Regulation")).toBeInTheDocument();
    await waitFor(async () => expect(await rec(id)).toMatchObject({ h1: "4", pt1: "2", fw1: "L", pn1: "1", sd1: "1" }));
    // Tapping the chosen putts chip again clears it.
    fireEvent.click(screen.getByLabelText("Putts 2 for Dave"));
    await waitFor(async () => expect((await rec(id)).pt1).toBeUndefined());
  });

  it("the grid is on the page, and a tap on any score opens that hole", async () => {
    let p = withPars();
    p = { ...p, records: p.records.map((r) => ({ ...r, v: { ...r.v, h1: "4", h2: "6", h3: "3" } })) };
    await openRound("u-golf-grid", p);
    const grid = await screen.findByRole("table", {}, { timeout: 4000 });
    expect(within(grid).getByLabelText("Edit Hole 2, Dave, 6")).toBeInTheDocument();
    expect(within(grid).getByLabelText("Edit Hole 5, Dave, No Score")).toBeInTheDocument();
    fireEvent.click(within(grid).getByLabelText("Edit Hole 2, Dave, 6"));
    expect(await screen.findByText("Hole 2")).toBeInTheDocument();
    // The selected chip is the six; tapping it clears the hole rather than setting it again.
    fireEvent.click(screen.getByLabelText("Strokes 6 for Dave"));
    await waitFor(async () => expect((await rec((await svc().listNotes())[0]!.id)).h2 ?? "").toBe(""));
  });

  it("Finish Round writes the Rounds page, keeps the course, and a new round on that course comes in with its pars", async () => {
    const id = await openRound("u-golf-finish", (() => { let p = withPars(18); p = { ...p, records: p.records.map((r) => ({ ...r, v: { ...r.v, h1: "5", h2: "4" } })) }; return p; })());
    fireEvent.click(await screen.findByText("Finish Round", {}, { timeout: 4000 }));
    await waitFor(async () => {
      const all = await svc().listNotes();
      const rounds = all.map((it) => (it.data as unknown as { page?: PageData }).page).find((pg) => pg?.kind === "rounds");
      expect(rounds).toBeTruthy();
      expect(rounds!.records).toHaveLength(1);
      expect(rounds!.records[0]!.v).toMatchObject({ player: "Dave", score: "9", topar: "+1", course: "Pebble Beach" });
      expect(Object.keys(rounds!.meta ?? {}).some((k) => k.startsWith("course:"))).toBe(true);
    });
    expect((await svc().note(id))!.page!.golf!.finishedAt).toBeGreaterThan(0);
    // Finishing again replaces the row and does not double it.
    fireEvent.click(await screen.findByText("Update Rounds"));
    await waitFor(async () => {
      const all = await svc().listNotes();
      const rounds = all.map((it) => (it.data as unknown as { page?: PageData }).page).find((pg) => pg?.kind === "rounds")!;
      expect(rounds.records).toHaveLength(1);
    });
  });

  it("a blocked stroke index says why", async () => {
    await openRound("u-golf-course", withPars());
    fireEvent.click(await screen.findByText("Pars", {}, { timeout: 4000 }));
    fireEvent.click(await screen.findByText("Add Stroke Index"));
    fireEvent.change(screen.getByLabelText("Stroke index for hole 1"), { target: { value: "3" } });
    expect(await screen.findByText("Stroke Index Needs a Number on Every Hole, or None")).toBeInTheDocument();
  });
});
