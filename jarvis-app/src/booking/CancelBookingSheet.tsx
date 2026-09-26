import { useState } from "react";
import { FormSheet, Group, TextRow, Note, ErrorLine } from "../shared/FormSheet";
import { mapBooking, type BookingFace } from "./bookedEvents";

const dayWords = (ms: number): string =>
  new Date(ms).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
const timeWords = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// CALLING A MEETING OFF (Track 3, 2026-09-19).
//
// The one screen in booking where the app acts on a stranger's behalf without
// them being there, so it says out loud what pressing Save does. Two rules:
//
//   THE NOTE IS OPTIONAL AND IT IS HIS OWN WORDS. A cancellation with a line
//   of explanation is a different thing to receive than a bare one, and the app
//   has no business writing that line for him. Left empty, the email says the
//   meeting is off and that the time is free again, which is the whole truth.
//
//   IT NEVER PRETENDS. The guest being told is a separate fact from the meeting
//   being cancelled, and the toast afterwards reports which of them happened,
//   because "Cancelled" over an email that never sent leaves him thinking a
//   stranger knows not to turn up.
export default function CancelBookingSheet({ booking, busy, error, onCancel, onConfirm }: {
  booking: BookingFace;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const m = mapBooking(booking);
  const who = booking.guestName.trim() || "them";

  return (
    <FormSheet
      title="Cancel Booking"
      onCancel={onCancel}
      onSave={() => onConfirm(reason)}
      saveDisabled={busy}
      saveLabel={busy ? "Sending" : "Cancel It"}
      dirty={reason.trim().length > 0}
    >
      {/* In words, on this device's clock, the way the guest's own email
          says it: the store's 2026-09-30 and 14:00 are for the store. */}
      <Note>{m ? `${m.title}, ${dayWords(booking.startMs)} at ${timeWords(booking.startMs)}` : "This booking"}</Note>
      <Group label="A Line for Them">
        <TextRow
          value={reason}
          onChange={setReason}
          ariaLabel="A line for them"
          placeholder="Optional · Something came up, or nothing at all"
          rows={3}
        />
      </Group>
      <Note>{`${who} gets an email saying the meeting is off, with a calendar file that takes it off their calendar`}</Note>
      <Note>The hour goes back on offer</Note>
      <ErrorLine text={error} />
    </FormSheet>
  );
}
