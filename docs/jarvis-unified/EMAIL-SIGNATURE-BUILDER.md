# Email signature builder (issue 113)

Dave, 2026-10-13: "Upload a pic. It auto scales. Enter your info and it creates a perfect signature." And: "It should be super simple."

This amends the Email v1 spec's L3 ("one saved plain-text signature per account") in one way only: an account's signature may now carry **one small picture**. The words are unchanged: the signature's lines still go into the draft as one managed block, the draft, Review Send, the hash and the plain-text part of every sent message hold exactly those lines, and the typed or pasted editor stays.

## What the person sees

One sheet, Settings > Email Signatures > the mailbox (also Email > Accounts > Edit Signature, and Add Signature in a draft), in Dave's order:

1. **Picture.** Add Picture opens the phone's picker. The app fits the picture itself (see below): nothing to crop, no size error.
2. **Your Details.** Name, Title, Organization, Phone, Email, Website. A blank one does not appear. A fresh builder has the account's own address in as the Email.
3. **Preview.** The signature on white, exactly as the email carries it. One Save.

Write It Yourself, at the foot, is the plain editor (seeded from what was just built). A typed signature opens the plain editor, with Use the Signature Builder at its foot. Saving typed words removes the picture.

In a draft, a quiet row, Signature Picture, says the picture goes with this message (its door is the builder). In Review Send the same row appears only when the server put the picture in the reviewed snapshot. Neither promises more than the sender will do: both use `signatureBodyHtml` and `travellingPicture` (`src/email/signature.ts`), the sender's own rule.

## Where it lives

| Piece | File |
| --- | --- |
| The one composer (lines, HTML, content id, the rule for when a picture travels) | `jarvis-app/src/email/signature.ts` |
| Picture fitting (browser canvas behind a seam) | `jarvis-app/src/email/signaturePicture.ts` |
| The sheet, the preview frame | `SignatureSheet.tsx`, `SignaturePaper.tsx` |
| Database | `jarvis-core/supabase/migrations/0072_email_signature_builder.sql` (rollback in `rollback/`, proof in `tests/signature_builder.sh`) |
| The message | `jarvis-app/api/_mime.ts` (`buildRawMessage`), `api/_send.ts` (`fetchSignaturePicture`) |

`signature.ts` is pure and imported by the API too, so the preview, the draft's lines and the sent message cannot drift: the lines are `composeSignatureText(fields)`, which the database composes identically (`jarvis_signature_text`); the HTML is `signatureHtml` / `signatureBodyHtml`, which the builder's preview frame and the MIME builder both call. `signature.test.ts` holds the TypeScript and SQL compositions to the same fixtures.

## Data

`email_account` gains `signature_kind` (`text` or `built`), `signature_fields` (the six details as saved, blank ones absent) and `signature_image` (null, or `{storage_id, sha256, size_bytes, mime_type, width, height}`). `signature_text` stays the composed lines, so the composer, AC17 to AC19 and the revision machinery are untouched. `email_signature_build_set` is the one door for a built signature (owner check, optimistic revision, the same shape as `email_signature_set`); `email_signature_set` (the plain editor) now also puts the account back to `text` and clears the picture. `email_accounts()` returns the three new keys.

The picture is a small PNG or JPEG in the person's own folder of the private `user-files` bucket (`{uid}/signature-{accountId}/...`, the two-level convention account deletion already sweeps). The database holds a reference, never the bytes, and never a public URL.

## Fitting the picture

`fitPicture` reads the file the way the phone drew it (a sideways photo stands up: `createImageBitmap` with `imageOrientation: "from-image"`, an `<img>` where that is missing), fits the whole of it inside a 192 pixel box keeping its own shape (a wide logo stays wide; nothing is cropped or stretched), never makes it larger than it was, steps big photos down in halves, keeps a transparent logo a transparent PNG, saves a photograph as a JPEG flattened on white, and steps the size and quality down until the file is at most 60 000 bytes. The only thing it refuses is a file the browser cannot read as a picture. It is drawn at half its stored size (96 points), so a retina screen gets a sharp one. `signaturePicture.test.ts` tests the decisions behind a fake canvas; the real thing was run in Chromium on a 4032 by 3024 photo, a transparent logo, a sideways EXIF photo, a banner, a tiny image, an SVG and a text file named .png.

## The message

Without a picture the message is exactly what it was. With one (an untouched built block at the end of the body, at the account's current revision, and a picture reference in the snapshot):

```
multipart/alternative
  text/plain                        the words, hashed, the signature lines in them
  multipart/related; type="text/html"
    text/html (base64)              the words, then the signature table beside the picture
    image/png or image/jpeg         inline, Content-ID <sig-....@jarvis.local>, no file name
```

nested as the first part of `multipart/mixed` when there are attachments. The picture has no file name, so a mail app draws it in the signature and lists nothing as an attachment. Nothing loads from outside the message. Python's `email` package reads these messages as designed (checked on generated .eml files); `api/_mime.test.ts` carries a small MIME reader for the same shapes.

## Rules the send holds

- **The picture rides only beside the exact lines it was built with.** `send_review` adds `signature` to the reviewed snapshot (so the hash binds the reference) only when the account is built, has a picture, the draft was made against the account's current signature revision, and the body ends with exactly `"\n\n-- \n" + signature_text`. Edit the block, move the revision, or type new words after it: plain text, no picture. `buildRawMessage` checks the same thing again from the snapshot (`signatureBodyHtml` is null otherwise).
- **Nothing is sent without the picture the person reviewed.** The worker fetches it with the service role from the owner's own folder (`insideOwnerFolder`), checks its size and sha-256 against the reference, and checks the first bytes are a PNG or JPEG of the claimed type. Missing or changed: refused before any Gmail call ("Not Sent · The Signature Picture Is Missing", "... Changed Since the Review").
- **Every value is escaped**; a link is made only for a real address, phone number or web address (http or https); no script, no remote picture, no stylesheet. The nested boundaries are three different strings, none the start of another, and a body that holds one of them is refused rather than cut in two.

## Deploy and rollback

Deploy order: the migration first (additive: three columns with defaults, two new functions, three replaced), then the client. The migration was applied to production on 2026-10-13; the five functions' fingerprints on production match the locally proven text byte for byte. `rollback/0072_email_signature_builder_down.sql` restores 0063's `email_signature_set`, 0065's `email_accounts()` and 0069's `send_review`, and removes the new functions and columns (run it in the SQL editor: the Supabase connector holds statements containing the destructive keywords for approval). A new client against an old server still works for typed signatures: it reads the new keys as optional and only sends the builder's call when the builder saves.

## Not done, and why

- A real send to Gmail, Apple Mail and Outlook. The structure is checked by two independent readers and the send route is tested end to end over a fake Gmail; a real message to a real inbox needs Dave's say-so.
- Dark-mode mail clients may invert the white signature table's colours; the picture's own pixels are not touched.
- Gmail's own web composer signature is not read or changed. This signature is JARVIS's, added by JARVIS.
