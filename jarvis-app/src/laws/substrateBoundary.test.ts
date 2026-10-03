import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { posix } from "node:path";
import { ALL_ENTITY_TYPES } from "../backup/entityRegistry";
import { DESTINATION_OF } from "../substrate/destinations/types";
import { adapterFor } from "../substrate/destinations/registry";
import { ENTITY_MONEY_BILL, ENTITY_MONEY_RECEIPT } from "../money/ledger/types";

// THE SUBSTRATE'S BOUNDARIES (JARVIS unified, slice 01, 2026-10-03).
//
// docs/jarvis-unified/IMPLEMENTATION-SPEC.md fixes four things that are
// cheap to break by accident and invisible when broken: an email candidate
// is not an item; bills go to Money and never become tasks; every substrate
// table has row security and every function is locked down; no credential
// sits in a public table. Each is a line below, read from the migration and
// the source rather than remembered.

const { join } = posix;
const SRC = join(process.cwd().replace(/\\/g, "/"), "src");
const MIGRATION = join(process.cwd().replace(/\\/g, "/"), "../jarvis-core/supabase/migrations/0044_jarvis_unified_substrate.sql");
const read = (f: string) => readFileSync(f, "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const SOURCES = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && !f.includes("/bench/"));
const rel = (f: string) => f.slice(SRC.length + 1);

const CONTROL_PLANE = [
  "agent_connection", "scope_grant", "policy_suggestion", "job", "context_package", "proposal", "approval", "action",
  "receipt_event", "source_evidence", "decision_version", "decision_dependency", "email_account", "email_message",
  "email_message_body", "email_candidate", "email_draft",
];

describe("SUBSTRATE law 1: a candidate is not an item", () => {
  it("no control-plane table name is an entity type the app writes", () => {
    const used = new Set<string>();
    for (const f of SOURCES) for (const m of read(f).matchAll(/export const ENTITY_[A-Z_]+\s*=\s*"([a-z_]+)"/g)) used.add(m[1]!);
    expect(CONTROL_PLANE.filter((t) => used.has(t))).toEqual([]);
    expect(ALL_ENTITY_TYPES.filter((t) => CONTROL_PLANE.includes(t))).toEqual([]);
  });

  it("the two new item kinds are in the backup registry, so an export carries them", () => {
    expect(ALL_ENTITY_TYPES).toContain("waiting");
    expect(ALL_ENTITY_TYPES).toContain("exploration_note");
  });

  it("the provisional mail store is named only inside the substrate and the Email module", () => {
    const bad = SOURCES.filter((f) => /email_candidate|email_message\b/.test(read(f)))
      .map(rel)
      .filter((r) => !r.startsWith("substrate/") && !r.startsWith("messages/"));
    expect(bad).toEqual([]);
  });
});

describe("SUBSTRATE law 2: a bill is never a task", () => {
  it("the registry routes bills and receipts to Money and the adapters agree", () => {
    expect(DESTINATION_OF.bill).toBe(ENTITY_MONEY_BILL);
    expect(DESTINATION_OF.receipt).toBe(ENTITY_MONEY_RECEIPT);
    expect(adapterFor("bill").destinationKind).toBe(ENTITY_MONEY_BILL);
    expect(adapterFor("receipt").destinationKind).toBe(ENTITY_MONEY_RECEIPT);
    expect(adapterFor("task").destinationKind).toBe("task");
  });

  it("the database refuses a bill candidate pointed at a task", () => {
    const sql = read(MIGRATION);
    expect(sql).toMatch(/when 'bill' then 'money_bill'/);
    expect(sql).toMatch(/cannot be saved as a % item/);
    expect(sql).toMatch(/create trigger email_candidate_destination/);
  });
});

describe("SUBSTRATE law 3: every table has row security, every function is locked down", () => {
  const sql = read(MIGRATION);
  const tables = [...sql.matchAll(/create table if not exists ([a-z_.]+)/g)].map((m) => m[1]!);
  const functions = [...sql.matchAll(/create or replace function ([a-z_]+)\(/g)].map((m) => m[1]!);

  it("finds the schema at all", () => {
    expect(tables.length).toBeGreaterThan(15);
    expect(functions.length).toBeGreaterThan(5);
  });

  it("row level security is enabled on every table the migration creates", () => {
    const missing = tables.filter((t) => !sql.includes(`alter table ${t} enable row level security`));
    expect(missing).toEqual([]);
  });

  it("every table is revoked from the browser roles and granted back explicitly", () => {
    const missing = tables.filter((t) => !sql.includes(`revoke all on table ${t} from anon, authenticated`));
    expect(missing).toEqual([]);
  });

  it("every function is revoked from PUBLIC", () => {
    const missing = functions.filter((fn) => !new RegExp(`revoke all on function ${fn}\\(`).test(sql));
    expect(missing).toEqual([]);
  });

  it("the only server-created rows the browser may never insert are the ones the spec names", () => {
    for (const t of ["approval", "receipt_event", "action", "context_package", "scope_grant", "proposal", "decision_version", "email_account", "email_message"]) {
      expect(sql, t + " must have no browser insert policy").not.toMatch(new RegExp(`create policy ${t}_insert on ${t}`));
    }
  });
});

describe("SUBSTRATE law 4: no credential in a public table", () => {
  it("token, secret and credential columns live only in jarvis_private", () => {
    const sql = read(MIGRATION);
    const blocks = [...sql.matchAll(/create table if not exists ([a-z_.]+) \(([\s\S]*?)\n\);/g)];
    expect(blocks.length).toBeGreaterThan(15);
    const leaks: string[] = [];
    for (const [, name, body] of blocks) {
      if (name!.startsWith("jarvis_private.")) continue;
      for (const line of body!.split("\n")) {
        const col = /^\s+([a-z_]+)\s+(text|jsonb|bytea)/.exec(line)?.[1];
        if (col && /token|secret|credential|password/.test(col)) leaks.push(name + "." + col);
      }
    }
    expect(leaks).toEqual([]);
    expect(sql).toMatch(/create table if not exists jarvis_private\.email_credential/);
    expect(sql).toMatch(/create table if not exists jarvis_private\.agent_credential/);
  });

  it("the private schema is not usable by a browser role", () => {
    const sql = read(MIGRATION);
    expect(sql).toMatch(/revoke all on schema jarvis_private from anon, authenticated/);
    expect(sql).not.toMatch(/grant usage on schema jarvis_private to (anon|authenticated)/);
  });
});
