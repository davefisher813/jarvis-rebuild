// Test files that draw a lowercase word behind a leading number on purpose, each
// with its reason. Empty is the goal; a new line here needs Dave's word.
export const NUMBER_CASE_ROSTER: Record<string, string> = {};

// Test files that draw a card holding nothing but an action, each with its reason.
export const LONE_ACTION_ROSTER: Record<string, string> = {};

// Capsules that sit in a list row or at the foot of a list card on purpose, per test file, each finding with its
// reason (`label @ row-class`, see capsulesInRows). Starts as short as the settled homes allow.
export const CAPSULE_ROSTER: Record<string, Record<string, string>> = {
  // MEASURED 2026-10-05 over the whole suite (CATALOG_REPORT), after the eight-area rebuild. The settled homes
  // (CAPSULE_HOMES in catalogCheck.ts) cover every notice, promo, sheet, toast, empty-state and own-words card, so what is
  // left is the People screens, and it is DEBT, not a decision: each is a row with a capsule in it, which the locked
  // ruling forbids. They are listed so that nothing NEW joins them; the fix is to give each its real home, and then the
  // entry goes.
  "people/PeopleFlow.test.tsx": {
    "Clear Them @ row": "DEBT: a one-shot repair card (the count and the cause, one answer, then an Undo). It is a card with its own words and should be a notice card offer or a head capsule, not a .row in a list card.",
    "It's a number @ offer-row": "DEBT: a yes-or-no question about one number, answered by two buttons on a review row. The offer is the question; it should move to the row's sheet and the swipe tray.",
    "Not One @ offer-row": "DEBT: the other half of the same pair as It's a Number, on the same review row.",
  },
  "people/screens/PeopleListPage.catalog.test.tsx": {
    "Clear Them @ row": "DEBT: the same repair card as in PeopleFlow, drawn by PeopleListPage.",
  },
};
