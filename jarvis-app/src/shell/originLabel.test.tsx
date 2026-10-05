// @vitest-environment jsdom
//
// THE RETURN PILL NAMES THE SCREEN YOU CAME FROM (Dave 2026-10-05, the ship-blocker review: a project or goal opened from the
// Life tab wore a "Brain" pill). An area's page is Brain's screen drawn under a lit Life tab, so a jump made from it must carry
// the Life origin, never a Brain one.
import { describe, it, expect } from "vitest";
import { useEffect } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useProjects, useCategories } from "../data/NotesProvider";
import { AppearanceProvider } from "../appearance/AppearanceProvider";
import { AuthProvider } from "../auth/AuthProvider";
import { originPlace } from "./navOrigin";
import AppShell from "./AppShell";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
(Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};

const tab = (label: string) => screen.getByText(label, { selector: ".tab" });

describe("originPlace: where a jump returns to", () => {
  it("is the tab you are on", () => {
    expect(originPlace("today", false)).toBe("today");
    expect(originPlace("brain", false)).toBe("brain");
    expect(originPlace("life", false)).toBe("life");
  });
  it("is Life while Brain is only drawing an area page the Life tab opened", () => {
    expect(originPlace("brain", true)).toBe("life");
  });
  it("never rewrites another tab", () => {
    expect(originPlace("money", true)).toBe("money");
  });
});

// Files one project in the Work area, so the area page has a row to open.
function Seed() {
  const projects = useProjects();
  const cats = useCategories();
  useEffect(() => {
    let off = false;
    // The areas seed after first paint, so ask until Work is there, then file once.
    void (async () => {
      for (let i = 0; i < 60 && !off; i++) {
        const c = (await cats.list()).find((x) => x.data.name === "Work");
        if (c) { await projects.create({ title: "origin probe project", status: "active", category: c.id }); return; }
        await new Promise((r) => setTimeout(r, 100));
      }
    })();
    return () => { off = true; };
  }, [projects, cats]);
  return null;
}

describe("a project opened from an area reached from Life", () => {
  it("says Life on the return pill, never Brain", async () => {
    render(<AppearanceProvider><AuthProvider><NotesProvider userId="u-origin-label"><Seed /><AppShell /></NotesProvider></AuthProvider></AppearanceProvider>);
    await screen.findByText("Life", { selector: ".tab" }, { timeout: 8000 });
    fireEvent.click(tab("Life"));
    const area = await waitFor(() => {
      const el = [...document.querySelectorAll(".area-card")].find((a) => /Work/.test(a.textContent ?? "")) as HTMLElement | undefined;
      if (!el) throw new Error("no Work area yet");
      return el;
    }, { timeout: 8000 });
    fireEvent.click(area);
    await screen.findByLabelText("Back", {}, { timeout: 8000 });
    const row = await waitFor(() => {
      const el = document.querySelector(".proj-row-ruled") as HTMLElement | null;
      if (!el) throw new Error("no project row yet");
      return el;
    }, { timeout: 8000 });
    fireEvent.click(row);
    const pill = await waitFor(() => {
      const el = document.querySelector(".return-pill, .nav-back");
      if (!el) throw new Error("no way back yet");
      return el;
    }, { timeout: 8000 });
    expect(document.querySelector(".return-pill")?.textContent ?? pill.textContent).not.toBe("Brain");
    expect(document.querySelector(".return-pill")?.textContent).toBe("Life");
  }, 40_000);
});
