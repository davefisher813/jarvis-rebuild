// Shared shape for Part 2's calendar-arithmetic features (The Third
// Practice, Week Shape, Two Days Off, The Age Rule). None of these are
// logged entities: they read the SAME calendar candidates the rest of this
// module already accepts from outside (see HealthFlow's `candidates` prop),
// never a body-data log, so nothing here needs a Store entity or a Share
// Line category of its own.
export interface SportSession {
  date: string; // local ISO day
  org: string; // which team/program this session belongs to, e.g. "School Team"
  title?: string;
  durationMin?: number;
}
