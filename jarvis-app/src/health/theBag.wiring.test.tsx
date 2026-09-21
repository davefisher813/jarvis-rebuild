// @vitest-environment jsdom
//
// THE BAG, FROM TAP TO STORED FACT (button audit phase 3, 2026-09-19).
//
// bag.ts's helpers are covered (bag.test.ts) and the screen renders, but the
// WRITE between them was not: nothing in the suite named logBagCheck. So the
// pure functions were proven and the wiring that makes them matter was not,
// which is the exact gap that let the event editor ship half-connected.
//
// The Bag is a game-day checklist: it answers "is the inhaler in the bag"
// on the way out of the door. A tap that does not persist is worse than no
// checklist, because it answers the question wrongly.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter } from "@core";
import { HealthService } from "./HealthService";
import type { Storage2 } from "./offlineQueue";
import { defaultBagItems, latestBagCheck, toggleItem, checkAll, allChecked, BAG_ITEMS } from "./bag";
import TheBagScreen from "./screens/TheBagScreen";

const EVENT = { eventId: "ev-1", eventTitle: "Elite Squad vs Northlake", date: "2026-09-20" };

// The app's own Storage2 (health/offlineQueue.ts), not the DOM's Storage.
function mem(): Storage2 {
  const m = new Map<string, string>();
  return {
    read: (k) => m.get(k) ?? null,
    write: (k, v) => { m.set(k, v); },
    remove: (k) => { m.delete(k); },
  };
}

beforeEach(() => { localStorage.clear(); });

describe("The Bag: the write behind the tap", () => {
  it("a toggled item survives being read back, and the latest check wins", async () => {
    const store = mem();
    const svc = new HealthService(new Store(new InMemoryAdapter()), "u-bag");

    // One item ticked.
    const first = toggleItem(defaultBagItems(), "inhaler");
    svc.logBagCheck({ ...EVENT, items: first }, 1000, store);
    let back = latestBagCheck(await svc.listBagCheck(store), EVENT.eventId);
    expect(back).toBeTruthy();
    expect(back!.data.items.find((i) => i.key === "inhaler")?.checked).toBe(true);
    expect(back!.data.items.find((i) => i.key === "water")?.checked).toBe(false);

    // A later check replaces it rather than stacking: "latest wins" is how
    // the screen reads current status (bag.ts's own note).
    svc.logBagCheck({ ...EVENT, items: checkAll(first) }, 2000, store);
    back = latestBagCheck(await svc.listBagCheck(store), EVENT.eventId);
    expect(allChecked(back!.data.items)).toBe(true);
    expect(back!.data.at).toBe(2000);

    // And it is filed against THIS event, not the bag in general.
    expect(latestBagCheck(await svc.listBagCheck(store), "ev-other")).toBeNull();
  });

  it("every row reports its own key, and Check Everything goes dead once it has nothing to do", () => {
    const toggled: string[] = [];
    let checkedAll = 0;
    const { rerender } = render(
      <TheBagScreen
        eventTitle={EVENT.eventTitle}
        items={defaultBagItems()}
        onToggle={(k) => toggled.push(k)}
        onCheckAll={() => { checkedAll++; }}
        onBack={() => {}}
      />,
    );
    // Each row hands back the key the write is keyed on. A row that reported
    // the wrong key would tick the wrong item and read as a lost tap.
    fireEvent.click(screen.getByText("Inhaler").closest(".row")!);
    fireEvent.click(screen.getByText("Mouthguard").closest(".row")!);
    expect(toggled).toEqual(["inhaler", "mouthguard"]);

    const all = screen.getByRole("button", { name: "Check Everything" });
    expect(all).toBeEnabled();
    fireEvent.click(all);
    expect(checkedAll).toBe(1);

    // Nothing left to check: the control says so rather than firing again.
    rerender(
      <TheBagScreen
        eventTitle={EVENT.eventTitle}
        items={checkAll(defaultBagItems())}
        onToggle={() => {}}
        onCheckAll={() => { checkedAll++; }}
        onBack={() => {}}
      />,
    );
    const done = screen.getByRole("button", { name: "Check Everything" });
    expect(done).toBeDisabled();
    fireEvent.click(done);
    expect(checkedAll).toBe(1);
    expect(BAG_ITEMS.length).toBeGreaterThan(0);
  });
});
