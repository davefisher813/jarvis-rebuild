# Taking your data out

Written 2026-09-05 (UP-LAUNCH-23). The contract of the file Settings > Backup
produces: what is in it, what shape it is in, and what is deliberately not.

Two audiences, one document. A person who wants their life out of this app
should be able to read the file. A reviewer asking "can a user leave" should
be able to check the answer without running anything.

## Getting it

Settings > Backup > Export. One JSON file, named
`jarvis-backup-YYYY-MM-DD.json`. On the phone it goes through the system share
sheet, so it can land in Files, in Mail, or anywhere else. Nothing about the
export needs a network, an account elsewhere, or our permission.

The same screen imports one back, into this account or a different one.

## The shape

```json
{
  "app": "jarvis",
  "version": 2,
  "exportedAt": "2026-09-05T12:00:00.000Z",
  "items": [
    { "entityType": "task", "id": "0f2c...", "data": { "text": "Call the school", "due": "2026-09-08" } },
    { "entityType": "category", "id": "9b71...", "data": { "name": "Family", "color": "blue" } }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `app` | Always `"jarvis"`. An import refuses a file without it, so a stray JSON file cannot be restored into an account. |
| `version` | Bundle version. `1` omitted record ids; `2` carries them. Import accepts either. |
| `exportedAt` | When the file was made, ISO 8601. |
| `items` | Every record the account owns, in no guaranteed order. |
| `items[].entityType` | Which kind of record. The list is `jarvis-app/src/backup/entityRegistry.ts`. |
| `items[].id` | The record's id in the account it came from. Version 2 and later. |
| `items[].data` | The record itself, exactly as the app stores it. |

`data` is deliberately not normalized on the way out. What the app stores is
what you get, which is the only version of "your data" that is not an
interpretation of it.

### Why ids matter

Records refer to each other by id: a task names its category, a project names
its goal, a checklist task names its note. Version 1 dropped ids to avoid
collisions when restoring into a different account, which avoided them by
throwing every link away: a restored life came back uncategorized. Version 2
carries the id, and import assigns a fresh one and rewrites every reference
field to match (`src/backup/references.ts`). Importing a version 1 file still
works exactly as it did, links and all: there is nothing in it to rewrite.

### Entity types

Thirty-odd, derived from one registry rather than a hand-kept list: tasks,
notes, categories, projects, goals, people, events, workouts, programs,
metrics, chats, learned rules, month seals, the health loggers, files, and
the profile. An import into an older build that does not recognise a type
reports that type by name rather than silently dropping it.

## What is NOT in the file, and why

Named plainly, because an export that quietly omits things is worse than one
that says what it omits.

**The bytes of uploaded files.** A photo of a whiteboard or a PDF of a
schedule lives in object storage, and the bundle carries the RECORD about the
file (its name, its type, which item it belongs to) rather than the file
itself. A JSON file with a hundred megabytes of base64 in it is not a file
anybody can use. Deleting your account deletes those objects
(`src/account/deleteAccount.ts` walks the bucket before it deletes anything
else); a per-file download from inside the app is the way to get one out
today, and a zip export beside this one is the honest fix. It is not written
yet.

**The event log.** One row per app open per local day, plus a fixed set of
typed acts (a task completed, a plan picked). It carries no text anybody
wrote: it has columns for a category, a number, a flag and a closed-vocabulary
kind, and nothing else can reach it. It is telemetry about the app rather than
content, so it is not in the bundle. Deleting your account deletes it.

**AI usage counts.** Rows saying that a call happened, kept as abuse and cost
accounting. Not content either, and deleted with the account.

**Google mail and calendar.** JARVIS reads them and never copies them. There
is nothing of Google's in your JARVIS account to export, and the connection is
revoked with Google when you disconnect or delete.

## Stability

The version number is the promise. A change that removes or renames a field in
this contract bumps it, and import keeps reading the older versions. That is
what makes a backup taken today still restorable in a year, which is the only
thing a backup is for.
