// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render } from "@testing-library/react";
import MailHtmlView from "./MailHtmlView";

// THE FRAME FOLLOWS THE APP (Dave 2026-09-04). The view used to default to
// dark and nobody passed anything else, so with the app switched to Light the
// mail sat in a black slab with the sender's dark text lost in it.
describe("MailHtmlView", () => {
  afterEach(() => { delete document.documentElement.dataset.theme; });

  const scheme = (container: HTMLElement) =>
    /<meta name="color-scheme" content="(\w+)">/.exec(container.querySelector("iframe")!.getAttribute("srcdoc")!)![1];

  it("renders the mail light when the root is stamped light", () => {
    document.documentElement.dataset.theme = "light";
    const { container } = render(<MailHtmlView html="<p>hi</p>" />);
    expect(scheme(container)).toBe("light");
  });

  it("renders the mail dark when the root is stamped dark, and when it is not stamped at all (JARVIS DNA)", () => {
    document.documentElement.dataset.theme = "dark";
    expect(scheme(render(<MailHtmlView html="<p>hi</p>" />).container)).toBe("dark");
    delete document.documentElement.dataset.theme;
    expect(scheme(render(<MailHtmlView html="<p>hi</p>" />).container)).toBe("dark");
  });

  it("an explicit dark prop still wins over the root", () => {
    document.documentElement.dataset.theme = "light";
    expect(scheme(render(<MailHtmlView html="<p>hi</p>" dark />).container)).toBe("dark");
  });
});
