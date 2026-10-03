// MARK PAID: CONFIRM, OR ONE TAP WITH UNDO (open question for Dave).
//
// Dave has not yet ruled between two ways of saying "I paid this":
//   true   a small confirm first ("I paid this", the date defaulting to today
//          and editable), then the write. Slower, and the date is always seen.
//   false  one tap writes it, dated today, and a toast offers Undo (which is
//          unmarkBillPaid). Faster, and the way back is one tap too.
// Either way the evidence is the person's own word (markBillPaidByUser), never
// a guess, and autopay never makes a bill paid. Flip this one constant to
// switch every Mark Paid door (the row's check, its swipe, the detail sheet,
// the Today card) between the two. Nothing else decides it.
export const CONFIRM_MARK_PAID = true;
