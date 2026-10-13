import { describe, it, expect } from "vitest";
import {
  cleanFields, composeSignatureText, hasSignatureContent, pictureSize, signatureBodyHtml, signatureCid, signatureHtml, signatureLines,
  SIGNATURE_DELIM, SIGNATURE_FIELD_MAX, SIGNATURE_FIELDS, SIGNATURE_PICTURE_SCALE, textToHtml, travellingPicture, websiteHref,
} from "./signature";
import { signatureBlock, withSignature } from "./drafts";

// The same cases jarvis-core/supabase/tests/signature_builder.sh runs through jarvis_signature_text (migration 0072): the lines
// the database composes and the lines this file composes are one definition written twice, and these rows hold them together.
const PARITY: Array<{ name: string; fields: Record<string, string>; text: string }> = [
  { name: "four filled, two blank", fields: { name: "Dave Fisher", title: " Founder ", organization: "Bridge", phone: "", email: "dave@example.test", website: " " }, text: "Dave Fisher\nFounder\nBridge\ndave@example.test" },
  { name: "all six, in the fixed order whatever order they arrive", fields: { website: "bridge.example", email: "d@bridge.example", phone: "(555) 010-0199", organization: "Bridge", title: "Founder", name: "Dave Fisher" }, text: "Dave Fisher\nFounder\nBridge\n(555) 010-0199\nd@bridge.example\nbridge.example" },
  { name: "only a name", fields: { name: "Dave" }, text: "Dave" },
  { name: "only a website", fields: { website: "bridge.example" }, text: "bridge.example" },
  { name: "nothing", fields: { name: "  ", title: "" }, text: "" },
];

describe("cleanFields", () => {
  it("keeps only the six fields, as text, one line each, trimmed", () => {
    expect(cleanFields({ name: "  Dave\tFisher\n", title: "Founder", nickname: "Dd", phone: 5 } as never)).toEqual({ name: "Dave Fisher", title: "Founder" });
  });
  it("leaves a blank field out entirely (blank fields simply do not appear)", () => {
    expect(cleanFields({ name: "Dave", title: "", organization: "   ", phone: "\n\t" })).toEqual({ name: "Dave" });
    expect(Object.keys(cleanFields({ name: "", title: " " }))).toEqual([]);
  });
  it("turns control characters and runs of spaces into one space", () => {
    expect(cleanFields({ name: "Dave\u0000\u0007    Fisher\r\nEvil: header" }).name).toBe("Dave Fisher Evil: header");
  });
  it("is safe on nothing at all", () => {
    expect(cleanFields(null)).toEqual({});
    expect(cleanFields(undefined)).toEqual({});
    expect(cleanFields({})).toEqual({});
  });
  it("cuts at the field's limit, an email address at its longer one, and never through the middle of an emoji", () => {
    expect(cleanFields({ name: "x".repeat(300) }).name).toHaveLength(SIGNATURE_FIELD_MAX.name);
    expect(cleanFields({ email: "x".repeat(300) }).email).toHaveLength(SIGNATURE_FIELD_MAX.email);
    const cut = cleanFields({ name: "a".repeat(199) + "\u{1F600}\u{1F600}" }).name!;
    expect([...cut]).toHaveLength(200);
    expect(cut.endsWith("\u{1F600}")).toBe(true);
    expect(JSON.stringify(cut)).not.toMatch(/\\ud[89a-f][0-9a-f]{2}(?!\\ud)/i);
  });
  it("is idempotent: cleaning clean fields changes nothing", () => {
    const once = cleanFields({ name: "  Dave   Fisher ", email: " d@x.test " });
    expect(cleanFields(once)).toEqual(once);
  });
});

describe("the composed lines", () => {
  for (const row of PARITY) {
    it(`matches the database: ${row.name}`, () => {
      expect(composeSignatureText(row.fields)).toBe(row.text);
    });
  }
  it("is name, title, organization, phone, email, website, one to a line", () => {
    expect([...SIGNATURE_FIELDS]).toEqual(["name", "title", "organization", "phone", "email", "website"]);
    expect(signatureLines({ email: "e@x.test", name: "N" }).map((l) => l.key)).toEqual(["name", "email"]);
  });
  it("has content only when a line is filled (a picture alone has no lines to carry it)", () => {
    expect(hasSignatureContent({})).toBe(false);
    expect(hasSignatureContent({ name: "   " })).toBe(false);
    expect(hasSignatureContent({ website: "bridge.example" })).toBe(true);
    expect(hasSignatureContent(null)).toBe(false);
  });
  it("is the block the draft holds, so the composer, the draft and the preview share it", () => {
    const text = composeSignatureText({ name: "Dave", email: "d@x.test" });
    expect(withSignature("Hello", text)).toBe("Hello" + SIGNATURE_DELIM + "Dave\nd@x.test");
    expect(signatureBlock(text)).toBe(SIGNATURE_DELIM + text);
  });
});

describe("websiteHref: a link only for a real web address", () => {
  it("assumes https when none was typed", () => {
    expect(websiteHref("bridge.example")).toBe("https://bridge.example");
    expect(websiteHref("www.bridge.example/about?x=1#top")).toBe("https://www.bridge.example/about?x=1#top");
  });
  it("keeps an http or https address as typed", () => {
    expect(websiteHref("http://bridge.example/a")).toBe("http://bridge.example/a");
    expect(websiteHref("HTTPS://bridge.example")).toBe("HTTPS://bridge.example");
  });
  it("is not a link when it is not a web address", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "mailto:d@x.test", "ftp://x.test", "see my page", "bridge", "d@x.test", "", "   "]) expect(websiteHref(bad)).toBeNull();
  });
});

const IMAGE = { storage_id: "owner/signature-acct/a.png", sha256: "ab".repeat(32), size_bytes: 23456, mime_type: "image/png" as const, width: 384, height: 256 };
const FIELDS = { name: "Dave Fisher", title: "Founder", organization: "Bridge & Co", phone: "(555) 010-0199", email: "dave@bridge.example", website: "bridge.example" };
const slot = { src: "cid:" + signatureCid(IMAGE.sha256), ...pictureSize(IMAGE) };

/** A recipient's eyes: the tags gone, the entities back, one line per block. */
const readable = (html: string): string[] =>
  html.replace(/<br>|<\/(div|tr)>/g, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").split("\n").map((l) => l.trim()).filter(Boolean);

describe("the signature as HTML", () => {
  it("shows exactly the composed lines, in order, and nothing else", () => {
    expect(readable(signatureHtml(FIELDS, slot)).join("\n")).toBe(composeSignatureText(FIELDS));
    expect(readable(signatureHtml({ name: "Dave", website: "bridge.example" })).join("\n")).toBe("Dave\nbridge.example");
  });
  it("is empty when nothing is filled", () => {
    expect(signatureHtml({})).toBe("");
    expect(signatureHtml({ name: " " }, slot)).toBe("");
  });
  it("puts the picture on the left at its drawn size and says nothing about it (decorative)", () => {
    const html = signatureHtml(FIELDS, slot);
    expect(html).toContain(`<img src="cid:${signatureCid(IMAGE.sha256)}" width="192" height="128" alt=""`);
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf("Dave Fisher"));
    expect(signatureHtml(FIELDS)).not.toContain("<img");
  });
  it("escapes every value: a name cannot open a tag or a link", () => {
    const html = signatureHtml({ name: '<script>alert("x")</script>', organization: "A&B <i>", title: `"quoted" 'single'` });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<i>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("A&amp;B &lt;i&gt;");
    expect(html).toContain("&quot;quoted&quot; &#39;single&#39;");
  });
  it("escapes the picture address too", () => {
    expect(signatureHtml({ name: "D" }, { src: 'x" onerror="alert(1)', width: 10, height: 10 })).not.toContain('onerror="alert');
  });
  it("links a real phone, address and website, and nothing else", () => {
    const html = signatureHtml(FIELDS);
    expect(html).toContain('href="tel:5550100199"');
    expect(html).toContain('href="mailto:dave@bridge.example"');
    expect(html).toContain('href="https://bridge.example"');
    expect(html).not.toMatch(/href="[^"]*(javascript|data):/i);
    const plain = signatureHtml({ phone: "ext 12", email: "not an address", website: "see my page" });
    expect(plain).not.toContain("<a ");
  });
  it("draws plain text for the builder's preview when links are off", () => {
    expect(signatureHtml(FIELDS, slot, { links: false })).not.toContain("<a ");
    expect(readable(signatureHtml(FIELDS, slot, { links: false })).join("\n")).toBe(composeSignatureText(FIELDS));
  });
  it("loads nothing from outside the message: no script, no remote picture, no stylesheet", () => {
    const html = signatureHtml(FIELDS, slot);
    expect(html).not.toMatch(/<script|<link|<style|url\(|https?:\/\/[^"]*\.(png|jpe?g|gif)/i);
    expect(html.match(/src="/g)).toHaveLength(1);
  });
  it("makes the name bold and nothing else", () => {
    const html = signatureHtml(FIELDS);
    // bold, not a number: the older mail engines (Outlook's) read the word and not 600
    expect(html.match(/font-weight:bold/g)).toHaveLength(1);
    expect(html).toMatch(/<div style="font-weight:bold">Dave Fisher<\/div>/);
  });
});

describe("the picture", () => {
  it("is drawn at half its stored size, so a retina screen gets a sharp one", () => {
    expect(SIGNATURE_PICTURE_SCALE).toBe(2);
    expect(pictureSize({ width: 384, height: 256 })).toEqual({ width: 192, height: 128 });
    expect(pictureSize({ width: 192, height: 192 })).toEqual({ width: 96, height: 96 });
    expect(pictureSize({ width: 1, height: 1 })).toEqual({ width: 1, height: 1 });
  });
  it("has a content id that is the same for the same picture, differs for another, and stays inside the message", () => {
    expect(signatureCid(IMAGE.sha256)).toBe("sig-" + "ab".repeat(8) + "@jarvis.local");
    expect(signatureCid("cd".repeat(32))).not.toBe(signatureCid(IMAGE.sha256));
  });
});

describe("textToHtml", () => {
  it("escapes, keeps the line breaks and keeps the spaces", () => {
    expect(textToHtml("a < b & c\r\nline two")).toBe("a &lt; b &amp; c<br>line two");
    expect(textToHtml("  indented\n    code")).toBe("&nbsp;&nbsp;indented<br>&nbsp;&nbsp;&nbsp;&nbsp;code");
    expect(textToHtml("a  b")).toBe("a &nbsp;b");
    expect(textToHtml("a\tb")).toBe("a&nbsp;&nbsp;&nbsp;&nbsp;b");
  });
});

describe("the HTML part of a message that carries a built signature", () => {
  const text = composeSignatureText(FIELDS);
  const body = "Hi Sam,\n\nThe transcript is attached.\nThanks.";
  it("is the person's words, then the signature in place of the plain-text block, the lines once", () => {
    const html = signatureBodyHtml(body + SIGNATURE_DELIM + text, FIELDS, slot)!;
    expect(html).not.toBeNull();
    expect(html).toContain("Hi Sam,<br><br>The transcript is attached.<br>Thanks.");
    expect(html.indexOf("Thanks.")).toBeLessThan(html.indexOf("<img"));
    expect(readable(html).join("\n")).toBe(["Hi Sam,", "The transcript is attached.", "Thanks."].join("\n") + "\n" + text);
    expect(html.match(/Dave Fisher/g)).toHaveLength(1);
    expect(html).not.toContain("-- ");
  });
  it("is the signature alone when there are no words above it", () => {
    const html = signatureBodyHtml(SIGNATURE_DELIM + text, FIELDS, slot)!;
    expect(html.startsWith('<div style="')).toBe(true);
    expect(html).not.toContain("<br>");
  });
  it("is null unless the body ends with exactly that block: a picture never rides next to words the person changed", () => {
    expect(signatureBodyHtml(body, FIELDS, slot)).toBeNull();
    expect(signatureBodyHtml(body + SIGNATURE_DELIM + text + "\nP.S. one more thing", FIELDS, slot)).toBeNull();
    expect(signatureBodyHtml(body + SIGNATURE_DELIM + text.replace("Founder", "Founder & CEO"), FIELDS, slot)).toBeNull();
    expect(signatureBodyHtml(body + "\n\n--\n" + text, FIELDS, slot)).toBeNull();
    expect(signatureBodyHtml(body + SIGNATURE_DELIM + text, {}, slot)).toBeNull();
  });
  it("works without a picture (info only)", () => {
    const html = signatureBodyHtml(body + SIGNATURE_DELIM + text, FIELDS)!;
    expect(html).toContain("Dave Fisher");
    expect(html).not.toContain("<img");
  });
});

describe("travellingPicture: when the account's picture goes with a draft (the same rule send_review applies)", () => {
  const text = composeSignatureText(FIELDS);
  const acct = { signature_text: text, signature_revision: 4, signature_kind: "built" as const, signature_fields: FIELDS, signature_image: IMAGE };
  const body = "Hi" + SIGNATURE_DELIM + text;
  it("goes when the signature is built with a picture, the draft is at its revision and the block is untouched", () => {
    expect(travellingPicture(body, 4, acct)).toBe(IMAGE);
  });
  it("does not go when the block was edited, anything follows it, or it is missing", () => {
    expect(travellingPicture(body + " P.S.", 4, acct)).toBeNull();
    expect(travellingPicture("Hi" + SIGNATURE_DELIM + text.replace("Founder", "Boss"), 4, acct)).toBeNull();
    expect(travellingPicture("Hi", 4, acct)).toBeNull();
  });
  it("does not go for a draft made against another revision, or one that never recorded a revision", () => {
    expect(travellingPicture(body, 3, acct)).toBeNull();
    expect(travellingPicture(body, null, acct)).toBeNull();
  });
  it("does not go when the saved details no longer say the lines the draft holds (the sender would draw other lines)", () => {
    expect(travellingPicture(body, 4, { ...acct, signature_fields: { ...FIELDS, title: "Boss" } })).toBeNull();
    expect(travellingPicture(body, 4, { ...acct, signature_fields: undefined })).toBeNull();
  });
  it("does not go for typed text, a signature with no picture, or no account", () => {
    expect(travellingPicture(body, 4, { ...acct, signature_kind: "text" })).toBeNull();
    expect(travellingPicture(body, 4, { ...acct, signature_kind: undefined })).toBeNull();
    expect(travellingPicture(body, 4, { ...acct, signature_image: null })).toBeNull();
    expect(travellingPicture(body, 4, { ...acct, signature_text: "" })).toBeNull();
    expect(travellingPicture(body, 4, null)).toBeNull();
  });
});
