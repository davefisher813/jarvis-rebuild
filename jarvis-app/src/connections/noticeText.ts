// THE WORDS OF A CONNECTION INCIDENT ON A LOCK SCREEN (Spec 3, moved here 2026-10-10).
//
// One source for the local banner (shared/notifications.ts) and the server
// push (api/push.ts through push/apns.ts), so the phone says the same thing
// whichever path fires. A lock screen is a public surface: the words name the
// trouble and the incident ID, never the address. No imports, so the Node
// push route can load it.

export interface ConnectionNotice {
  /** Every open incident this notification stands for, oldest first. */
  incidentIds: string[];
  /** "auth" says Reconnect; "degraded" says the mail is not updating. Mixed groups say the stronger one. */
  kind: "auth" | "degraded";
}

export function connectionNoticeText(n: ConnectionNotice): { title: string; body: string } {
  const title = n.kind === "auth" ? "Gmail Needs Reconnecting" : "Gmail Isn't Updating";
  const count = n.incidentIds.length;
  return {
    title,
    body: count === 1
      ? `Incident ${n.incidentIds[0]} · Tap to Open JARVIS`
      : `${count} Accounts · Incidents ${n.incidentIds.join(", ")}`,
  };
}
