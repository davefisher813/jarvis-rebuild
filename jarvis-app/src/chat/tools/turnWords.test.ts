import { describe, it, expect } from "vitest";
import { claimsDone, looksLikeEdit, notDoneLine } from "./turnWords";

// TWO JUDGEMENTS ABOUT A TURN'S WORDS (chat box order, 2026-10-24). The first keeps a claim of something done out of the thread, because
// in the tool lane nothing is done until the person taps; the second sends "move the plumber to Friday" to the model instead of filing it
// as a new task.

describe("a claim that something was done", () => {
  it("is found in the shapes a model uses", () => {
    for (const said of [
      "I've added that task.", "I added it to your list", "I have moved it to Friday.", "I just marked it done", "We've saved the decision.",
      "I already rescheduled it", "Done.", "Done: Call the plumber", "Added!", "All set", "All done.", "Saved: call the plumber",
      "It has been moved to Friday", "The task has now been completed", "It's done", "That's now on your list", "Sure. I've deleted it.",
    ]) expect(claimsDone(said), said).toBe(true);
  });

  it("leaves honest words alone: a card waiting, a question, a report about someone else or the past of a record", () => {
    for (const said of [
      "I've put that on a card for you to confirm.", "I set up a card to move it to Friday. Tap it to confirm.", "Waiting for your OK on the card below.",
      "Nothing has been changed yet.", "I haven't added anything.", "Do you want me to add it?", "You moved it twice already.",
      "Your dentist appointment was moved to Friday.", "Call the plumber is open and has no date.", "I can move it to Friday if you like.",
      "Once you tap, it will be added.", "I couldn't find a task called that.", "That task is already done.",
      "Nothing was added yet.", "It hasn't been moved.", "I have not saved it.", "No, I haven't marked it done.", "Nothing has changed until you tap.",
      "I found two matches. Which one do you mean?",
    ]) expect(claimsDone(said), said).toBe(false);
  });

  it("looks at each sentence, so a denial in one does not hide a claim in the next", () => {
    expect(claimsDone("Nothing else is due today. I've moved the plumber to Friday.")).toBe(true);
    expect(claimsDone("I've put it on a card.\nNothing has been changed yet.")).toBe(false);
    expect(claimsDone("I've put it on a card.\nI've also deleted the old one.")).toBe(true);
  });

  it("the line that stands in for it tells the truth about what the dispatcher did", () => {
    expect(notDoneLine(1)).toBe("Waiting for your OK on the card below · Nothing has changed yet");
    expect(notDoneLine(3)).toBe("Waiting for your OK on the card below · Nothing has changed yet");
    expect(notDoneLine(0)).toBe("Nothing was changed · Ask again and I'll put it on a card for you to confirm");
  });
});

describe("a sentence that changes something that exists", () => {
  it("is one that opens with a verb that can only mean that", () => {
    for (const said of [
      "Move the plumber to Friday", "move call the plumber to next week", "Push the dentist task to Monday", "Reschedule the plumber for Friday",
      "Postpone the taxes", "Delay the report until Wednesday", "Bump the plumber to Friday", "Rename the plumber task to Call Roto-Rooter",
      "Reword the dentist task", "Retitle it", "Mark the plumber task as high priority", "Unmark the plumber", "Clear the date on the plumber task",
      "Change the plumber task to Friday", "Please move the plumber to Friday", "Can you push the dentist to Monday", "could you reschedule it",
    ]) expect(looksLikeEdit(said), said).toBe(true);
  });

  it("leaves new things alone: they keep the capture lane they always had", () => {
    for (const said of [
      "Call the plumber Friday", "Make dinner reservations for Saturday", "Add milk to the list", "Set up the new printer", "Update the roof quote",
      "Remind me to move the car", "Pay rent", "I need to move the couch", "Buy a mark-up pen", "What's on today?", "Moving boxes on Saturday",
    ]) expect(looksLikeEdit(said), said).toBe(false);
  });
});
