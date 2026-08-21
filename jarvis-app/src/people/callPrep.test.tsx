// @vitest-environment jsdom
// Call Prep laws (addendum item 2): the attempt is logged automatically with
// undo and restores exactly (including never-called); the card shows a
// section only when it has data; the app never stores duration or outcome.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter } from "@core";
import { PeopleService } from "./PeopleService";
import CallPrepSheet from "./CallPrepSheet";
import type { Person, PersonData } from "./types";

const U = "user1";

function svc() {
  return new PeopleService(new Store(new InMemoryAdapter()), U);
}

const person = (data: Partial<PersonData>): Person => ({
  id: "p1",
  data: { name: "Tony Ridgeley", group: "contacts", ...data },
});

describe("call attempt logging", () => {
  it("logs one attempt and undo restores never-called exactly", async () => {
    const people = svc();
    const id = (await people.create({ name: "Tony", group: "contacts", phone: "555" }))!;
    const out = await people.logCallAttempt(id, "2026-08-15T12:00:00.000Z");
    expect(out!.prior).toBeUndefined();
    expect((await people.get(id))!.data.lastCallAttempt).toBe("2026-08-15T12:00:00.000Z");
    await people.restoreCallAttempt(id, out!.prior);
    // Falsy = never called, everywhere it is read.
    expect((await people.get(id))!.data.lastCallAttempt || undefined).toBeUndefined();
  });

  it("undo after a second call restores the FIRST call, not nothing", async () => {
    const people = svc();
    const id = (await people.create({ name: "Tony", group: "contacts", phone: "555" }))!;
    await people.logCallAttempt(id, "2026-08-10T12:00:00.000Z");
    const second = await people.logCallAttempt(id, "2026-08-15T12:00:00.000Z");
    await people.restoreCallAttempt(id, second!.prior);
    expect((await people.get(id))!.data.lastCallAttempt).toBe("2026-08-10T12:00:00.000Z");
  });

  it("the person record never grows duration or outcome fields", async () => {
    const people = svc();
    const id = (await people.create({ name: "Tony", group: "contacts", phone: "555" }))!;
    await people.logCallAttempt(id);
    const keys = Object.keys((await people.get(id))!.data);
    expect(keys.some((k) => /duration|length|outcome|result/i.test(k))).toBe(false);
  });
});

describe("the card renders sections only when they have data", () => {
  const noop = { onCall: vi.fn(async () => ({ prior: undefined })), onUndoCall: vi.fn(async () => {}), onClose: () => {} };

  it("a bare person shows no Relationship, Notes, or Linked Notes sections", () => {
    render(<CallPrepSheet person={person({ phone: "555" })} {...noop} />);
    expect(screen.queryByText("Relationship")).not.toBeInTheDocument();
    expect(screen.queryByText("Notes")).not.toBeInTheDocument();
    expect(screen.queryByText("Linked Notes")).not.toBeInTheDocument();
    expect(screen.getByText("Call")).toBeInTheDocument();
  });

  it("facts render when they exist", () => {
    render(
      <CallPrepSheet
        person={person({ phone: "555", relationship: "Facility owner", notes: "Prefers morning calls", register: "professional" })}
        linkedNotes={[{ id: "n1", title: "Fall Clinic Plan" }]}
        {...noop}
      />,
    );
    expect(screen.getByText("Facility owner")).toBeInTheDocument();
    expect(screen.getByText("Prefers morning calls")).toBeInTheDocument();
    expect(screen.getByText("Fall Clinic Plan")).toBeInTheDocument();
    expect(screen.getByText("Professional")).toBeInTheDocument();
  });

  it("no phone means no Call button: the card never offers a dial it cannot make", () => {
    render(<CallPrepSheet person={person({})} {...noop} />);
    expect(screen.queryByText("Call")).not.toBeInTheDocument();
  });
});
