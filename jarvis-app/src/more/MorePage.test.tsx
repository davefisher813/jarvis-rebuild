// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import MorePage from "./MorePage";
import { DESTINATIONS } from "../shell/destinations";

// A DESTINATION'S GLYPH WEARS ITS TYPE'S COLOUR (Dave 2026-10-05, D5: the More list was every glyph the same flat brand
// red, which says "tap me" eight times and "this is Email" never).
describe("MorePage glyph tones", () => {
  const extras = DESTINATIONS.filter((d) => ["brain", "notes", "messages", "notifications", "money", "chat"].includes(d.key));
  const view = () => render(<MorePage extras={extras} onOpenExtra={() => {}} onNavigate={() => {}} />);
  const tone = (el: Element) => [...el.classList].find((c) => c.startsWith("cat-fg-") || c === "lib-ico-brand");

  it("Email is teal, Money green, Notes yellow, Brain purple, Notifications orange: not one flat brand red", () => {
    const { container } = view();
    const rows = [...container.querySelectorAll(".lib-row")];
    const byName = Object.fromEntries(rows.map((r) => [r.querySelector(".lib-name")!.textContent, tone(r.querySelector(".lib-ico")!)]));
    expect(byName).toMatchObject({
      Email: "cat-fg-teal", Money: "cat-fg-green", Notes: "cat-fg-yellow", Brain: "cat-fg-purple", Notifications: "cat-fg-orange",
    });
  });

  it("Chat is JARVIS's own and keeps the brand red; Settings is chrome and takes the neutral", () => {
    const { container } = view();
    const rows = [...container.querySelectorAll(".lib-row")];
    const byName = Object.fromEntries(rows.map((r) => [r.querySelector(".lib-name")!.textContent, tone(r.querySelector(".lib-ico")!)]));
    expect(byName.Chat).toBe("lib-ico-brand");
    expect(byName.Settings).toBe("cat-fg-graphite");
  });

  it("the glyphs are never the text ink and never all the same colour", () => {
    const { container } = view();
    const tones = [...container.querySelectorAll(".lib-ico")].map((i) => tone(i));
    expect(new Set(tones).size).toBeGreaterThan(4);
    expect(tones.every((t) => !!t)).toBe(true);
  });
});
