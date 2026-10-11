// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StepProgress, stepFraction } from "./StepCount";

// THE CHECKLIST LINE (Dave 2026-10-11, visual catalog, Checklist Progress): a task with steps gets a thin line under the
// row that fills as steps get done, width done over total, and a row without steps gets nothing.
describe("StepProgress", () => {
  it("fills done over total", () => {
    const { container } = render(<StepProgress done={1} total={3} />);
    const fill = container.querySelector(".tr-progress > .tr-progress-fill") as HTMLElement;
    expect(fill).toBeInTheDocument();
    expect(fill.style.width).toBe("33.3%");
    expect(container.querySelector(".tr-progress")).toHaveAttribute("aria-hidden", "true");
  });

  it("is empty at none done and full at all done", () => {
    expect((render(<StepProgress done={0} total={5} />).container.querySelector(".tr-progress-fill") as HTMLElement).style.width).toBe("0%");
    expect((render(<StepProgress done={5} total={5} />).container.querySelector(".tr-progress-fill") as HTMLElement).style.width).toBe("100%");
  });

  it("draws nothing for a row without steps", () => {
    expect(render(<StepProgress done={0} total={0} />).container.firstChild).toBeNull();
    expect(stepFraction({ done: 0, total: 0 })).toBe(0);
    expect(stepFraction({ done: 7, total: 5 })).toBe(1);
  });

  it("is drawn on both task lists, beside the count it echoes", () => {
    const src = join(__dirname, "..");
    expect(readFileSync(join(src, "tasks/screens/TasksPage.tsx"), "utf8")).toMatch(/showSteps && !renaming && <StepProgress \{\.\.\.steps\} \/>/);
    expect(readFileSync(join(src, "today/TodayPage.tsx"), "utf8")).toMatch(/steps\.total > 0 && <StepProgress \{\.\.\.steps\} \/>/);
  });

  it("wears the picked track and fill, and hangs in the row's foot so the row keeps its height", () => {
    const css = readFileSync(join(__dirname, "..", "styles/components.css"), "utf8");
    expect(css).toMatch(/\.task-row \.tr-progress \{ position: absolute;[^}]*height: 3px;[^}]*background: var\(--progress-track\)/);
    expect(css).toMatch(/\.tr-progress-fill \{[^}]*linear-gradient\(90deg, color-mix\(in srgb, var\(--accent\) 70%, white\), var\(--accent\)\)/);
  });
});
