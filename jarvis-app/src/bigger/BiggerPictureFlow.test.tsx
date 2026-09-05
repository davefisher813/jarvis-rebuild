// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useEffect, useState } from "react";
import { NotesProvider, useGoals } from "../data/NotesProvider";
import type { GoalService } from "../life/GoalService";
import BiggerPictureFlow from "./BiggerPictureFlow";

// LIFE-F-18 (2026-09-05): "Savings entries are dated in UTC." Logging $200
// to a savings goal at 9pm Eastern on the 31st dated the receipt row the 1st
// and the month rollup counted it there. The entry must carry the local day.

let goalsRef: { svc: GoalService; id: string } | null = null;
function Seed() {
  const goals = useGoals();
  const [id, setId] = useState("");
  useEffect(() => {
    (async () => {
      const gid = await goals.create({ title: "Emergency Fund", state: "on_track", moneyTarget: 5000 });
      goalsRef = { svc: goals, id: gid! };
      setId(gid!);
    })();
  }, [goals]);
  return id ? <BiggerPictureFlow openGoalId={id} /> : null;
}

describe("BiggerPictureFlow savings (LIFE-F-18)", () => {
  it("dates a savings entry on the local day, late in the evening east of the UTC midnight", async () => {
    const prevTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    // 9pm Eastern on Aug 31 is already Sept 1 in UTC.
    vi.useFakeTimers({ now: new Date("2026-08-31T21:00:00"), toFake: ["Date"] });
    try {
      render(<NotesProvider userId="u-savings-tz"><Seed /></NotesProvider>);
      fireEvent.click(await screen.findByText("Add to Savings"));
      fireEvent.change(screen.getByLabelText("Amount in dollars"), { target: { value: "200" } });
      fireEvent.click(screen.getByText("Save"));
      await waitFor(async () => {
        const g = await goalsRef!.svc.get(goalsRef!.id);
        expect(g?.data.saved).toEqual([{ d: "2026-08-31", amount: 200 }]);
      });
    } finally {
      vi.useRealTimers();
      process.env.TZ = prevTz;
    }
  });
});
