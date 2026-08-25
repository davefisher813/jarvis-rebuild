import { describe, it, expect } from "vitest";
import { cleanBody, leadIn } from "./bodyText";

// Every case here is a line off Dave's own screen, 2026-08-25, reading a
// RushOrderTees marketing blast in the live app.

describe("what the URL leaves behind", () => {
  it("keeps the label and drops the empty brackets", () => {
    // Shown on a line that SURVIVES the dead-label rule below, because the
    // bracket-stripping and the nav-label dropping are two different jobs and
    // a test that conflates them cannot tell which one broke.
    expect(cleanBody("Sign the waiver here. ( https://x.com/w )")).toBe("Sign the waiver here.");
    expect(cleanBody("Order #D2565 ( https://x.com/o )")).toBe("Order #D2565");
  });

  it("keeps the phone number, which is the one useful line in that footer", () => {
    // Dropping the whole line would be tidier and would delete this.
    expect(cleanBody("Call (267) 332-4101 ( tel:2673324101 )")).toBe("Call (267) 332-4101");
  });

  it("strips every scheme, not just http", () => {
    // The old rule took https:// and left the rest, so Dave's screen read
    // "Call (267) 332-4101 ( tel:2673324101 )".
    expect(cleanBody("Email sales@x.com ( mailto:sales@x.com )")).toBe("Email sales@x.com");
    expect(cleanBody("Reach us on (555) 010-9988 ( sms:+15550109988 )")).toBe("Reach us on (555) 010-9988");
    expect(cleanBody("Read the report. ( ftp://files.x.com/r.pdf )")).toBe("Read the report.");
  });

  it("still drops a line that was nothing but a link", () => {
    expect(cleanBody("https://rushordertees.com/track/abc")).toBe("");
    expect(cleanBody("< https://x.com/y >")).toBe("");
  });
});

describe("the footer every bulk sender appends", () => {
  it("drops the boilerplate block", () => {
    const body = [
      "Free Shipping on All Orders!",
      "",
      "2727 Commerce Way, Philadelphia, PA 19154",
      "",
      "Copyright © 2026 RushOrderTees, All rights reserved.",
      "",
      "This message was sent to davefisher813@gmail.com",
      "",
      "No longer interested? Unsubscribe ( https://x.com/u )",
    ].join("\n");
    const out = cleanBody(body);
    expect(out).toContain("Free Shipping on All Orders!");
    expect(out).not.toMatch(/2727 Commerce Way/);
    expect(out).not.toMatch(/Copyright/i);
    expect(out).not.toMatch(/all rights reserved/i);
    expect(out).not.toMatch(/davefisher813/);
    expect(out).not.toMatch(/No longer interested/i);
  });

  it("does not eat a sentence that merely contains a number", () => {
    // The address rule has to look like a real mailing address, not like any
    // line starting with a digit.
    const keep = "2 day delivery is guaranteed when you choose Rush at checkout.";
    expect(cleanBody(keep)).toBe(keep);
    expect(cleanBody("500 shirts, printed and shipped")).toBe("500 shirts, printed and shipped");
  });

  it("keeps the company name, which is not the address line", () => {
    expect(cleanBody("RushOrderTees, A Printfly Company")).toBe("RushOrderTees, A Printfly Company");
  });

  it("keeps a real person's sign-off that happens to mention sending", () => {
    const keep = "Sent the waiver over this morning, let me know if it landed.";
    expect(cleanBody(keep)).toBe(keep);
  });
});

describe("the preview a person actually reads", () => {
  it("no longer opens with a column of empty parens", () => {
    // The exact lead-in off his screenshot.
    const body = 'Custom gear from Nike, Under Armour, Stanley, and more, all printed with your design.\n'
      + 'RushOrderTees Logo ( https://x.com/1 )\n'
      + 'Products ( https://x.com/2 )\n'
      + 'My Saved Designs ( https://x.com/3 )\n'
      + 'Premium gear for "Vector Sports"\n'
      + 'front ( https://x.com/4 )\n'
      + 'back ( https://x.com/5 )';
    const out = leadIn(body);
    expect(out).not.toContain("( )");
    expect(out).toContain("Custom gear from Nike");
  });
});

describe("a label whose link is gone points nowhere", () => {
  it("drops the flattened website menu", () => {
    const body = [
      "Custom gear from Nike, all printed with your design.",
      "RushOrderTees Logo ( https://x.com/1 )",
      "Products ( https://x.com/2 )",
      "My Saved Designs ( https://x.com/3 )",
      "front ( https://x.com/4 )",
      "back ( https://x.com/5 )",
      "Premium Brands ( https://x.com/6 )",
    ].join("\n");
    expect(cleanBody(body)).toBe("Custom gear from Nike, all printed with your design.");
  });

  it("keeps a label carrying a number, because that is a phone or an order", () => {
    expect(cleanBody("Call (267) 332-4101 ( tel:2673324101 )")).toBe("Call (267) 332-4101");
    expect(cleanBody("Order #D2565 ( https://x.com/o )")).toBe("Order #D2565");
  });

  it("keeps a sentence, however short, and whatever it links to", () => {
    expect(cleanBody("Sign it here. ( https://x.com/s )")).toBe("Sign it here.");
    expect(cleanBody("Can you take a look? ( https://x.com/s )")).toBe("Can you take a look?");
  });

  it("keeps a short line that never held a link", () => {
    // The rule may only fire on chrome. Prose that happens to be short is
    // still prose.
    expect(cleanBody("See you Friday")).toBe("See you Friday");
    expect(cleanBody("Thanks")).toBe("Thanks");
  });

  it("keeps a longer link label, which is usually a real title", () => {
    const t = "The full quarterly report for the northern region ( https://x.com/r )";
    expect(cleanBody(t)).toBe("The full quarterly report for the northern region");
  });
});
