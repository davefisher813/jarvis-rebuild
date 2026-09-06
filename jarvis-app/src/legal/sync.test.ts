import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOCS, SUPPORT_EMAIL, PRIVACY, TERMS } from "./content";
import { renderPage } from "./html";

// UP-LAUNCH-05 (2026-09-05): the guarantee behind the one legal source.
//
// A generator nobody runs is two copies again. This regenerates every page in
// memory and compares it with what is committed under public/, so a content
// edit that is not published fails the suite with the command that fixes it.
// The failure message matters more than the assertion here: it is read by
// somebody who has just changed a policy and does not know there is a build
// step.
const PUBLIC = join(process.cwd(), "public");

describe("the published legal pages are generated, never edited", () => {
  for (const doc of DOCS) {
    it(`public/${doc.slug}.html matches src/legal/content.ts`, () => {
      const committed = readFileSync(join(PUBLIC, doc.slug + ".html"), "utf8");
      expect(
        renderPage(doc),
        `public/${doc.slug}.html is out of step with src/legal/content.ts. Run: npm run build:legal`,
      ).toEqual(committed);
    });
  }

  it("every page carries the one support address and no placeholder", () => {
    for (const doc of DOCS) {
      const committed = readFileSync(join(PUBLIC, doc.slug + ".html"), "utf8");
      expect(committed).not.toMatch(/your-domain|TODO|Template copy|before launch/);
    }
    expect(SUPPORT_EMAIL).not.toContain("your-domain");
    // The address appears in all three documents, which is the whole reason
    // it is a constant rather than a string typed six times.
    for (const doc of DOCS) {
      expect(JSON.stringify(doc), doc.slug + " must name the support address").toContain(SUPPORT_EMAIL);
    }
  });

  it("the two agreements carry a date, and Support does not pretend to be one", () => {
    expect(PRIVACY.updated).toBeTruthy();
    expect(TERMS.updated).toBeTruthy();
    expect(DOCS.find((d) => d.slug === "support")!.updated).toBeUndefined();
  });

  it("the Privacy Policy names every processor that receives anything", () => {
    // The App Store's privacy questions and Google's verification both ask
    // this directly, and the answer has to be in the linked policy. Each name
    // here is a vendor that actually receives data today; when one is added
    // (an analytics vendor, a crash SDK) this test is where it gets noticed.
    const text = JSON.stringify(PRIVACY);
    for (const vendor of ["Anthropic", "Supabase", "Vercel", "Google", "Sentry"]) expect(text).toContain(vendor);
    expect(text, "the Google limited use statement is required by Google's verification").toContain("Limited Use");
  });

  it("the Privacy Policy answers deletion, retention and minors", () => {
    const headings = PRIVACY.sections.map((s) => s.heading);
    expect(headings).toContain("How Long We Keep It");
    expect(headings).toContain("Children and Teens");
    expect(headings).toContain("Your Controls");
    expect(JSON.stringify(PRIVACY)).toContain("Delete Account");
  });

  it("no policy describes a purchase this app cannot make", () => {
    // Payments, subscriptions and refunds are out of scope until there is
    // something to buy. Terms for a paywall that does not exist are the same
    // failure as a policy for a feature that does not exist, in reverse.
    const text = JSON.stringify(DOCS).toLowerCase();
    for (const word of ["subscription", "auto-renew", "refund", "free trial"]) {
      expect(text, `"${word}" belongs in the terms only once there is a paywall`).not.toContain(word);
    }
  });
});
