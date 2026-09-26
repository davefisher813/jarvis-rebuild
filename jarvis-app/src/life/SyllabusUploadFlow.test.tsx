// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import SyllabusUploadFlow from "./SyllabusUploadFlow";
import type { AIService } from "../ai/AIService";
import type { TasksService } from "../tasks/TasksService";
import type { ScheduleService } from "../schedule/ScheduleService";
import { weekdayShortDate } from "../shared/dateFormat";

// §AM (2026-09-26): the review row's read, as facts. The rowLine string it
// replaced was tested ("Task · No date found"); the rendered row was not.
// A missing date is amber because it needs a look before it lands, a date
// is a neutral small-caps date, and the grade share is a white number.
describe("SyllabusUploadFlow: the review row reads as facts (§AM)", () => {
  async function review() {
    const reply = JSON.stringify({
      items: [
        { title: "Essay 1", kind: "task", month: 9, day: 15, year: 2026, start: null, weight: "20%" },
        { title: "Read as we go", kind: "task", month: null, day: null, year: 2026, start: null, weight: null },
      ],
    });
    const ai = { complete: vi.fn(async () => reply) } as unknown as AIService;
    render(
      <SyllabusUploadFlow
        ai={ai}
        tasks={{} as TasksService}
        schedule={{} as ScheduleService}
        onDone={() => {}}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste the Syllabus/), { target: { value: "Essay 1 due Sep 15 (20%). Readings as we go." } });
    fireEvent.click(screen.getByText("Read the Pasted Text"));
    await screen.findByText("Review the Syllabus");
    const rowOf = (title: string) => screen.getByText(title).closest(".row") as HTMLElement;
    return { dated: rowOf("Essay 1"), undated: rowOf("Read as we go") };
  }

  it("a row with no date says so in amber, and shows no date fact", async () => {
    const { undated } = await review();
    const warn = undated.querySelector(".facts > .fact.warn");
    expect(warn).toHaveTextContent("No date found");
    expect(undated.querySelector(".fact.date")).toBeNull();
    expect(undated.querySelector(".facts")!.textContent).not.toMatch(/·|Task/);
  });

  it("a dated row wears its date in small caps and its weight as a white number", async () => {
    const { dated } = await review();
    const date = dated.querySelector(".facts > .fact.date");
    expect(date).toHaveTextContent(weekdayShortDate("2026-09-15"));
    expect(dated.querySelector(".fact.warn")).toBeNull();
    const weight = dated.querySelector(".facts > .fact > b");
    expect(weight).toHaveTextContent("20%");
    // The number carries the emphasis; the fact around it wears no tone.
    expect(weight!.parentElement!.className).toBe("fact");
    expect(dated.querySelector(".facts")!.textContent).not.toMatch(/·/);
  });
});
