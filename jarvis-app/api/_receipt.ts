import { buildReceipt, buildCancellation, safeZone, type Receipt } from "../src/booking/receipt";
import { encodeEmail } from "../src/connections/google/map";
import { ownerMailbox, sendRaw } from "./_google";

// SENDING THE CONFIRMATION (Track 3, 2026-09-19).
//
// THE SEAM THIS IS. api/book.ts is the only endpoint in the app with no auth
// in front of it, and it has been written from the first line to touch nothing
// but the Track 3 project: that discipline is why a mistake in it cannot reach
// the app's real data. Sending the receipt needs the host's Google grant,
// which lives in the LIVE project, so the discipline has to bend exactly once.
// It bends HERE, in a file whose whole surface is one function, rather than by
// scattering live credentials through the public endpoint.
//
// To be plain about what that discipline is and is not: every function in a
// deployment can read every environment variable, so this was never a wall.
// It is a rule about what the public endpoint does, kept narrow enough to read
// in one sitting. What this file may do with the live project is read ONE row
// (the host's stored mail grant) and send ONE message. It writes nothing
// there, and it cannot: nothing below issues a write to the live project.
//
// IT NEVER FAILS THE BOOKING. The time is already taken by the time this
// runs. A host who has not connected Google, a revoked grant, Gmail being
// down: each of those means no receipt, and none of them mean no booking. The
// return value says which happened so the page can tell the visitor the truth
// instead of promising an email that is not coming.

export interface ReceiptJob {
  ownerId: string;
  bookingId: string;
  typeName: string;
  startMs: number;
  endMs: number;
  guestName: string;
  guestEmail: string;
  /** The visitor's zone, from their own browser. Checked before it is used. */
  guestZone?: string;
  /** The host's zone, which the booking grid was built in. */
  hostZone: string;
  /** Where the visitor goes if they cannot make it, when the server knows its
   *  own address. Absent on a cancellation, which needs no way out. */
  cancelUrl?: string;
}

/** Try to send the confirmation. True only if Gmail accepted it. */
export function sendBookingReceipt(job: ReceiptJob): Promise<boolean> {
  return send(job, buildReceipt);
}

/** Tell the guest their meeting is off. Same path, same rules, and the same
 *  answer shape: the cancellation has already happened in the database by the
 *  time this runs, so a mail that cannot go out must not undo it. The guest
 *  being told is the point, though, so the caller passes the answer on rather
 *  than swallowing it. */
export function sendBookingCancellation(job: ReceiptJob & { reason?: string }): Promise<boolean> {
  return send(job, buildCancellation);
}

type Build = (i: Parameters<typeof buildReceipt>[0] & { reason?: string }) => Receipt;

async function send(job: ReceiptJob & { reason?: string }, build: Build): Promise<boolean> {
  const mailbox = await ownerMailbox({
    supaUrl: process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "",
    service: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    tokenKey: process.env.GOOGLE_TOKEN_KEY || "",
    clients: {
      clientId: process.env.VITE_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      iosClientId: process.env.VITE_GOOGLE_IOS_CLIENT_ID || process.env.GOOGLE_IOS_CLIENT_ID || "",
    },
    userId: job.ownerId,
  });
  if (!mailbox) return false;

  const receipt = build({
    typeName: job.typeName,
    startMs: job.startMs,
    endMs: job.endMs,
    guestName: job.guestName,
    guestEmail: job.guestEmail,
    guestZone: safeZone(job.guestZone, job.hostZone),
    hostZone: job.hostZone,
    hostEmail: mailbox.email,
    bookingId: job.bookingId,
    ...(job.reason ? { reason: job.reason } : {}),
    ...(job.cancelUrl ? { cancelUrl: job.cancelUrl } : {}),
  });

  return sendRaw(mailbox.accessToken, encodeEmail({
    to: receipt.to,
    subject: receipt.subject,
    body: receipt.body,
    attachment: receipt.attachment,
  }));
}
