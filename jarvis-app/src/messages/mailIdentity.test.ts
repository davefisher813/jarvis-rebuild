import { describe, it, expect } from "vitest";
import { mailAccountKey, mailMessageKey, mailThreadKey, normalizeAccount, type MailScope } from "./mailIdentity";

const scope: MailScope = { userId: "u1", account: "Dave@Gmail.com" };

describe("normalizeAccount", () => {
  it("trims and lowercases and does nothing else", () => {
    expect(normalizeAccount("  Dave@Gmail.COM \n")).toBe("dave@gmail.com");
  });
  it("leaves gmail dot and plus semantics alone", () => {
    expect(normalizeAccount("d.ave+jobs@gmail.com")).toBe("d.ave+jobs@gmail.com");
    expect(normalizeAccount("d.ave@gmail.com")).not.toBe(normalizeAccount("dave@gmail.com"));
  });
});

describe("mail keys", () => {
  it("the same mailbox written two ways is one key", () => {
    expect(mailAccountKey({ userId: "u1", account: "  DAVE@gmail.com" })).toBe(mailAccountKey(scope));
    expect(mailThreadKey({ userId: "u1", account: " dave@GMAIL.com " }, "t1")).toBe(mailThreadKey(scope, "t1"));
  });

  it("the same thread id in two accounts is two keys", () => {
    const other = { userId: "u1", account: "work@x.com" };
    expect(mailThreadKey(scope, "18abc")).not.toBe(mailThreadKey(other, "18abc"));
    expect(mailMessageKey(scope, "18abc")).not.toBe(mailMessageKey(other, "18abc"));
  });

  it("the same account under two users is two keys", () => {
    expect(mailAccountKey(scope)).not.toBe(mailAccountKey({ ...scope, userId: "u2" }));
    expect(mailThreadKey(scope, "t")).not.toBe(mailThreadKey({ ...scope, userId: "u2" }, "t"));
  });

  it("a thread and a message with the same raw id never collide", () => {
    expect(mailThreadKey(scope, "x")).not.toBe(mailMessageKey(scope, "x"));
  });

  it("raw ids are kept as given, case included", () => {
    expect(mailThreadKey(scope, "AbC")).not.toBe(mailThreadKey(scope, "abc"));
    expect(mailThreadKey(scope, "abc")).toContain(":t:abc");
  });

  it("a separator inside a part cannot forge another key", () => {
    const a = mailThreadKey({ userId: "u1", account: "a@x.com" }, "t:m:1");
    const b = mailMessageKey({ userId: "u1", account: "a@x.com" }, "1");
    expect(a).not.toBe(b);
    const c = mailAccountKey({ userId: "u:1", account: "a@x.com" });
    const d = mailAccountKey({ userId: "u", account: "1:a@x.com" });
    expect(c).not.toBe(d);
  });
});
