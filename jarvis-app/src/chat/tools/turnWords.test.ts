import { describe, it, expect } from "vitest";
import { asksForChange, claimsDone, looksLikeEdit, notDoneLine, screenClaims, type CardTally } from "./turnWords";

// THREE JUDGEMENTS ABOUT A TURN'S WORDS (chat box order, 2026-10-24). The first keeps a claim of something done out of the thread, because in
// the tool lane nothing is done until the person taps; the second sends "move the plumber to Friday" to the model instead of filing it as a
// new task; the third says when a sentence is asking for a change at all, so its answer is read strictly.

const none: CardTally = { opened: 0, waiting: 0, made: 0 };
const waiting: CardTally = { opened: 1, waiting: 1, made: 0 };

describe("a claim that something was done", () => {
  it("is found in the shapes a model uses, in any turn: its own finished work, or a bare receipt", () => {
    for (const said of [
      "I've added that task.", "I added it to your list", "I have moved it to Friday.", "I just marked it done", "We've saved the decision.",
      "I already rescheduled it", "I've also deleted the old one.", "I went ahead and moved it", "I've set it for Friday.", "I set the plumber task to Friday.",
      "Done.", "Done: Call the plumber", "Added!", "All set", "All done.", "Saved: call the plumber", "Done! I've moved it.",
      "I've moved the plumber task to Friday, no problem.", "Sure. I've deleted it.",
    ]) expect(claimsDone(said, false), said).toBe(true);
  });

  it("is found in a turn about changing something when the speaker is left out, which is how a model reports its own work", () => {
    for (const said of [
      "Added 'Call the plumber' to your list.", "Moved the plumber task to Friday.", "Updated the date.", "It has been moved to Friday",
      "The task has now been completed", "It's done", "That's now on your list", "The plumber task is now on your calendar.",
    ]) {
      expect(claimsDone(said, true), said).toBe(true);
      expect(claimsDone(said, false), `${said} (a plain question)`).toBe(false);
    }
  });

  it("leaves honest words alone: a card waiting, a question, a report about someone else or the past of a record", () => {
    for (const said of [
      "I've put that on a card for you to confirm.", "I set up a card to move it to Friday. Tap it to confirm.", "Waiting for your OK on the card below.",
      "Nothing has been changed yet.", "I haven't added anything.", "Do you want me to add it?", "You moved it twice already.",
      "Your dentist appointment was moved to Friday.", "Call the plumber is open and has no date.", "I can move it to Friday if you like.",
      "Once you tap, it will be added.", "I couldn't find a task called that.", "That task is already done.",
      "Nothing was added yet.", "It hasn't been moved.", "I have not saved it.", "No, I haven't marked it done.", "Nothing has changed until you tap.",
      "I found two matches. Which one do you mean?", "I added nothing.", "Nothing else is due, and I moved on to your schedule.",
      "I moved on to checking your calendar.",
    ]) {
      expect(claimsDone(said, true), said).toBe(false);
      expect(claimsDone(said, false), `${said} (a plain question)`).toBe(false);
    }
  });

  it("does not let a denial in one sentence, or a word like 'no problem' after the claim, hide a claim", () => {
    expect(claimsDone("Nothing else is due today. I've moved the plumber to Friday.", false)).toBe(true);
    expect(claimsDone("I've put it on a card.\nNothing has been changed yet.", true)).toBe(false);
    expect(claimsDone("I've put it on a card.\nI've also deleted the old one.", false)).toBe(true);
    expect(claimsDone("No problem, I've moved it to Friday.", false)).toBe(true);
    expect(claimsDone("Nothing is wrong, I've moved it to Friday.", false)).toBe(true);
  });
});

describe("taking the claims out of what the model said", () => {
  it("drops only the claiming sentences, keeps the rest as written, and says where the person stands", () => {
    const r = screenClaims("Your Friday has two events.\nI've moved the plumber task to Friday. Anything else?", waiting, false);
    expect(r.screened).toBe(true);
    expect(r.text).toBe("Your Friday has two events.\nAnything else?\nWaiting for your OK on the card below · Nothing has changed yet");
  });

  it("is the line alone when the whole answer was a claim", () => {
    expect(screenClaims("Done. I've moved the plumber task to Friday.", waiting, true)).toEqual({ text: "Waiting for your OK on the card below · Nothing has changed yet", screened: true });
    expect(screenClaims("I've moved it.", none, false)).toEqual({ text: "Nothing was changed · Ask again and I'll put it on a card for you to confirm", screened: true });
  });

  it("leaves a true answer exactly as it was", () => {
    const said = "Call the plumber is open and has no date.\n\nWant me to put a date on a card?";
    expect(screenClaims(said, none, true)).toEqual({ text: said, screened: false });
    expect(screenClaims("", none, true)).toEqual({ text: "", screened: false });
  });

  it("a turn that is about changing something reads the speaker-less report too, and a plain question does not", () => {
    expect(screenClaims("Moved the plumber task to Friday.", waiting, true).screened).toBe(true);
    expect(screenClaims("Completed today: Call the plumber, Pay rent.", none, false)).toEqual({ text: "Completed today: Call the plumber, Pay rent.", screened: false });
  });

  it("a pointer to a card that is not there is taken out, and one to a card that is waiting is kept", () => {
    expect(screenClaims("I put it on a card. Tap Move Task to confirm.", none, true)).toEqual({
      text: "Nothing was changed · Ask again and I'll put it on a card for you to confirm", screened: true,
    });
    expect(screenClaims("I put it on a card. Tap Move Task to confirm.", waiting, true)).toEqual({ text: "I put it on a card. Tap Move Task to confirm.", screened: false });
  });

  it("when the person already tapped, the claim goes and no false line takes its place", () => {
    const made: CardTally = { opened: 1, waiting: 0, made: 1 };
    expect(screenClaims("I've moved the plumber task to Friday.", made, true)).toEqual({ text: "", screened: true });
    expect(screenClaims("Here you go. I've moved it.", made, true)).toEqual({ text: "Here you go.", screened: true });
  });
});

describe("the line that stands in for a claim", () => {
  it("tells the truth about what the dispatcher did, whichever way it went", () => {
    expect(notDoneLine({ opened: 1, waiting: 1, made: 0 })).toBe("Waiting for your OK on the card below · Nothing has changed yet");
    expect(notDoneLine({ opened: 3, waiting: 2, made: 0 })).toBe("Waiting for your OK on the card below · Nothing has changed yet");
    // One was made while another waits: "nothing has changed" would not be true.
    expect(notDoneLine({ opened: 2, waiting: 1, made: 1 })).toBe("Waiting for your OK on the card below");
    expect(notDoneLine(none)).toBe("Nothing was changed · Ask again and I'll put it on a card for you to confirm");
    // Cards were made, set aside or timed out while the model was talking: their own lines said so.
    expect(notDoneLine({ opened: 1, waiting: 0, made: 1 })).toBeNull();
    expect(notDoneLine({ opened: 1, waiting: 0, made: 0 })).toBeNull();
  });
});

describe("a sentence that changes something that exists", () => {
  it("is one that opens with a verb that can only mean that, however politely it is wrapped", () => {
    for (const said of [
      "Move the plumber to Friday", "move call the plumber to next week", "Push the dentist task to Monday", "Reschedule the plumber for Friday",
      "Postpone the taxes", "Delay the report until Wednesday", "Bump the plumber to Friday", "Rename the plumber task to Call Roto-Rooter",
      "Reword the dentist task", "Retitle it", "Unmark the plumber", "Please move the plumber to Friday", "Can you push the dentist to Monday",
      "could you reschedule it", "Can you please move the plumber task to Friday?", "Would you move the plumber to Friday", "I need you to move it to Monday",
      "Please can you move it", "Mark the plumber task as done", "Mark the plumber task high priority", "mark it as important",
      "Clear the date on the plumber task", "Clear the due date", "Clear the priority on the dentist", "Change the date on the plumber task to Friday",
      "Change the due date to Monday", "Change the plumber task's priority", "Change the name of the dentist task",
    ]) expect(looksLikeEdit(said), said).toBe(true);
  });

  it("leaves new things alone: they keep the capture lane they always had", () => {
    for (const said of [
      "Call the plumber Friday", "Make dinner reservations for Saturday", "Add milk to the list", "Set up the new printer", "Update the roof quote",
      "Remind me to move the car", "Pay rent", "I need to move the couch", "Buy a mark-up pen", "What's on today?", "Moving boxes on Saturday",
      "Clear the gutters before Friday", "Change the oil filter on the truck", "Mark Sarah's birthday on the calendar", "Clear the table", "Change of address form",
    ]) expect(looksLikeEdit(said), said).toBe(false);
  });

  it("a long or many-lined paste that happens to open that way is a paste, not a request", () => {
    expect(looksLikeEdit("Change the date on the plumber task to Friday\nand also the electrician")).toBe(false);
    expect(looksLikeEdit("Move " + "the plumber ".repeat(30))).toBe(false);
  });
});

describe("a sentence that asks for a change at all", () => {
  it("is an edit, a creation or a go-ahead, so the answer to it is read strictly", () => {
    for (const said of [
      "Move the plumber to Friday", "Can you add a task to call the plumber?", "Add a task", "Please create a reminder", "Remind me to call Marco",
      "Save that decision", "Log it", "Could you schedule the dentist", "Yes", "Yes, do it", "go ahead", "Okay", "Confirm",
    ]) expect(asksForChange(said), said).toBe(true);
  });

  it("is not a plain question or a statement", () => {
    for (const said of ["What's on today?", "When is the dentist?", "Who is Marco?", "Show me Friday", "The plumber called", "Call the plumber Friday"]) {
      expect(asksForChange(said), said).toBe(false);
    }
  });
});
