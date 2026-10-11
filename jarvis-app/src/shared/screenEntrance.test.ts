// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { watchScreenEntrances, resetScreenEntrances, claimFirstOpen } from "./screenEntrance";

// THE FIRST OPEN (Dave 2026-10-11, visual catalog, Motion: "Use New"): on the first open of a screen per launch its cards
// rise and fade in; a second open in the same launch does not animate.
const tick = () => new Promise((r) => setTimeout(r, 0));

function screen(title: string, cards: number): HTMLElement {
  const s = document.createElement("div");
  s.className = "screen ruled";
  s.innerHTML = `<div class="pagebar-title">${title}</div>` +
    Array.from({ length: cards }, () => `<div class="pad-x"><div class="card"><div class="card">row</div></div></div>`).join("");
  return s;
}

describe("the first open entrance", () => {
  beforeEach(() => {
    resetScreenEntrances();
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-motion");
  });

  it("animates a screen's cards on its first open, staggered and capped, and not on a second open", async () => {
    const scroller = document.createElement("div");
    document.body.appendChild(scroller);
    let tab = "life";
    const stop = watchScreenEntrances(scroller, () => tab);

    const first = screen("Tasks", 8);
    scroller.appendChild(first);
    await tick();
    const cards = [...first.querySelectorAll<HTMLElement>(".pad-x > .card")];
    expect(cards.every((c) => c.classList.contains("card-enter"))).toBe(true);
    expect(cards.map((c) => c.style.getPropertyValue("--enter-i"))).toEqual(["0", "1", "2", "3", "4", "5", "5", "5"]);
    // A card inside a card is a row: never marked.
    expect(first.querySelector(".card .card")!.classList.contains("card-enter")).toBe(false);

    // Away and back in the same launch: the screen is new DOM, but it is not a first open.
    scroller.innerHTML = "";
    tab = "today";
    scroller.appendChild(screen("Today", 2));
    await tick();
    tab = "life";
    scroller.innerHTML = "";
    const again = screen("Tasks", 3);
    scroller.appendChild(again);
    await tick();
    expect(again.querySelectorAll(".card-enter").length).toBe(0);
    stop();
  });

  it("never animates under the app's own Reduce Motion", async () => {
    document.documentElement.setAttribute("data-motion", "reduce");
    const scroller = document.createElement("div");
    document.body.appendChild(scroller);
    const stop = watchScreenEntrances(scroller, () => "today");
    const s = screen("Today", 2);
    scroller.appendChild(s);
    await tick();
    expect(s.querySelectorAll(".card-enter").length).toBe(0);
    stop();
  });

  it("remembers a screen for the launch", () => {
    expect(claimFirstOpen("more|Notes")).toBe(true);
    expect(claimFirstOpen("more|Notes")).toBe(false);
  });
});
