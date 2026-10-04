// @vitest-environment jsdom
//
// OPEN IT FROM THE AI HUB LANDS SOMEWHERE (2026-10-04, the dead-button sweep).
// hubClient.destinationKindOf sends "money" for a captured bill or receipt, and
// the shell's jumpToEntity had a Money branch spelled "bill" only: the tap
// recorded a Back origin and opened nothing. The Hub is stubbed to a single
// button that makes the same call ReceiptDetail's Open It makes; the shell,
// the Brain door and the tab bar are the real ones.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { AppearanceProvider } from "../appearance/AppearanceProvider";
import { AuthProvider } from "../auth/AuthProvider";
import { destinationKindOf } from "../hub/hubClient";
import AppShell from "./AppShell";

vi.mock("../substrate/flags", async (orig) => {
  const real = await orig<typeof import("../substrate/flags")>();
  return { ...real, flagOn: (f: Parameters<typeof real.flagOn>[0]) => (f === "substrate_v1" ? true : real.flagOn(f)) };
});
vi.mock("../hub/HubFlow", () => ({
  default: ({ onOpenEntity }: { onOpenEntity?: (kind: string, id: string) => void }) => (
    <div>
      <button onClick={() => onOpenEntity?.("money", "captured-item-1")}>open-it-bill</button>
    </div>
  ),
}));

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
(Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};

const tab = (label: string) => screen.getByText(label, { selector: ".tab" });

async function openHub() {
  render(<AppearanceProvider><AuthProvider><NotesProvider userId="u-hub-open-it"><AppShell /></NotesProvider></AuthProvider></AppearanceProvider>);
  await screen.findByText("Brain", { selector: ".tab" }, { timeout: 8000 });
  fireEvent.click(tab("Brain"));
  fireEvent.click(await screen.findByText("AI Hub", { selector: ".lib-name" }, { timeout: 8000 }));
}

describe("Open It on a Bill or Receipt capture", () => {
  it("the Hub's own word for the destination is the one the shell now answers", () => {
    expect(destinationKindOf("capture_bill")).toBe("money");
    expect(destinationKindOf("capture_receipt")).toBe("money");
  });

  it("leaves the Hub for the Money tab instead of doing nothing", async () => {
    await openHub();
    expect(tab("Brain")).toHaveClass("active");
    fireEvent.click(await screen.findByText("open-it-bill"));
    // Money is not a tab of its own; its empty state is the proof it is up.
    expect(await screen.findByText("Add an Account", undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryByText("open-it-bill")).toBeNull();
  }, 40_000);
});
