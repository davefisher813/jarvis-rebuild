import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
//
// PHASE 0 (2026-10-10, PHASE0-DESIGN.md section 4): laws 3 and 4 read one
// migration, 0044, so the three Phase 0 migrations (item_change and
// item_link in 0060, the VYZN inbox in 0061, private by default in 0062)
// would have landed a table with no revoke line and nothing would have said
// so (refutations 1.3 and 2.4). Both laws now run per migration over the
// files that exist, so a migration is covered the moment it lands; the size
// check and the jarvis_private assertions stay on 0044, the one migration
// that creates the private schema.

const { join } = posix;
const SRC = join(process.cwd().replace(/\\/g, "/"), "src");
const MIG_DIR = join(process.cwd().replace(/\\/g, "/"), "../jarvis-core/supabase/migrations");
const MIGRATION = join(MIG_DIR, "0044_jarvis_unified_substrate.sql");
// The substrate's migrations, in order, filtered to the files that exist
// today: 0060 to 0062 are Phase 0 steps 2 and 6, and each is read the moment it lands.
const MIGRATIONS = ["0044_jarvis_unified_substrate.sql", "0060_memory.sql", "0061_vyzn_inbox.sql", "0062_private_by_default.sql"]
  .filter((f) => existsSync(join(MIG_DIR, f)));
const read = (f: string) => readFileSync(f, "utf8");
// A migration's comments explain the revoke lines they sit beside; only the
// statements count, so a commented out revoke is a missing revoke.
const statements = (sql: string) => sql.replace(/--[^\n]*/g, "");

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
  // Phase 0 (0060): the memory and the link projection are derived from item, never written as one.
  "item_change", "item_link",
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
      // src/email/ is the Email module since slice 05 (2026-10-03); messages/ is the older mail code it grew from.
      .filter((r) => !r.startsWith("substrate/") && !r.startsWith("messages/") && !r.startsWith("email/"));
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
  it("reads the migrations that exist, 0044 first", () => {
    expect(MIGRATIONS[0]).toBe("0044_jarvis_unified_substrate.sql");
  });

  for (const file of MIGRATIONS) {
    describe(file, () => {
      const sql = statements(read(join(MIG_DIR, file)));
      const tables = [...sql.matchAll(/create table if not exists ([a-z_.]+)/g)].map((m) => m[1]!);
      const functions = [...sql.matchAll(/create or replace function ([a-z_]+)\(/g)].map((m) => m[1]!);

      if (file.startsWith("0044")) {
        it("finds the schema at all", () => {
          expect(tables.length).toBeGreaterThan(15);
          expect(functions.length).toBeGreaterThan(5);
        });
      }

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
    });
  }

  it("the only server-created rows the browser may never insert are the ones the spec names", () => {
    const sql = MIGRATIONS.map((f) => statements(read(join(MIG_DIR, f)))).join("\n");
    for (const t of [
      "approval", "receipt_event", "action", "context_package", "scope_grant", "proposal", "decision_version", "email_account", "email_message",
      // Phase 0 (0060): the trigger writes both; the browser reads and never inserts.
      "item_change", "item_link",
    ]) {
      expect(sql, t + " must have no browser insert policy").not.toMatch(new RegExp(`create policy ${t}_insert on ${t}`));
    }
  });
});

describe("SUBSTRATE law 4: no credential in a public table", () => {
  const blocksOf = (sql: string) => [...sql.matchAll(/create table if not exists ([a-z_.]+) \(([\s\S]*?)\n\);/g)];

  for (const file of MIGRATIONS) {
    it(`${file}: token, secret and credential columns live only in jarvis_private`, () => {
      const sql = statements(read(join(MIG_DIR, file)));
      const blocks = blocksOf(sql);
      // A table written in a shape this scanner cannot read would pass for
      // free, so the count of blocks is held to the count of create lines.
      expect(blocks.length).toBe([...sql.matchAll(/create table if not exists /g)].length);
      const leaks: string[] = [];
      for (const [, name, body] of blocks) {
        if (name!.startsWith("jarvis_private.")) continue;
        for (const line of body!.split("\n")) {
          const col = /^\s+([a-z_]+)\s+(text|jsonb|bytea)/.exec(line)?.[1];
          if (col && /token|secret|credential|password/.test(col)) leaks.push(name + "." + col);
        }
      }
      expect(leaks).toEqual([]);
    });
  }

  it("0044 creates the private schema's two credential tables", () => {
    const sql = read(MIGRATION);
    expect(blocksOf(sql).length).toBeGreaterThan(15);
    expect(sql).toMatch(/create table if not exists jarvis_private\.email_credential/);
    expect(sql).toMatch(/create table if not exists jarvis_private\.agent_credential/);
  });

  it("the private schema is not usable by a browser role", () => {
    const sql = read(MIGRATION);
    expect(sql).toMatch(/revoke all on schema jarvis_private from anon, authenticated/);
    expect(sql).not.toMatch(/grant usage on schema jarvis_private to (anon|authenticated)/);
  });
});

// THE EMAIL MODULE RUNS WITH AI OFF (slice 09; IMPLEMENTATION-SPEC.md 13 "AI
// off", 15 E27 and S01, 17 "no AI network calls with AI off"). Everything
// under src/email, src/substrate, src/hub and the Today band is rules and
// taps: none of it may import the AI client or name an AI route, and nothing
// in it runs on a timer except the two debounces the spec asks for (search
// after 400ms of quiet, the composer's save after 500ms and 1s). A scheduled
// scan would start as a setInterval; this law is where it would fail.
describe("SUBSTRATE law 5: the Email module runs with AI off", () => {
  const MANUAL = SOURCES.filter((f) => /^(email|substrate|hub)\//.test(rel(f)) || rel(f) === "today/EmailToday.tsx");

  it("covers the module", () => {
    expect(MANUAL.length).toBeGreaterThan(40);
  });

  it("imports no AI client and names no AI route", () => {
    const bad: string[] = [];
    for (const f of MANUAL) {
      const src = read(f);
      // The Hub holds the AI switch itself (the level, the admin block): those three modules are settings, not a model call.
      for (const m of src.matchAll(/from\s+["'](?:\.\.\/)+ai\/([A-Za-z]+)["']/g)) {
        if (!["levelStore", "aiGate", "useAdminAiGate"].includes(m[1]!)) bad.push(`${rel(f)}: imports src/ai/${m[1]}`);
      }
      if (/\/api\/(ai|agent|chat|voice|vision|hub)\b/.test(src)) bad.push(`${rel(f)}: names an AI route`);
      if (/\b(AIService|useAI|useAIContext|aiFetch|anthropic)\b/i.test(src)) bad.push(`${rel(f)}: names the AI client`);
    }
    expect(bad).toEqual([]);
  });

  it("runs nothing on a timer but the two debounces", () => {
    const ALLOWED_TIMEOUTS = new Set(["email/SearchScreen.tsx", "email/ComposeScreen.tsx"]);
    // Email v1 (Dave approved the build 2026-10-08; spec section 9, his locked decision 4): the held send's screen counts down
    // the server's 30 seconds and asks the server what became of the command. It exists only while that screen is open, is
    // started by the person's own Send tap, and stops the moment the command settles, comes back, or the screen closes.
    // It is a view of a server-side hold, not background work: the hold itself runs with the page closed.
    const ALLOWED_INTERVALS = new Set(["email/useHeldSend.ts"]);
    const bad: string[] = [];
    for (const f of MANUAL) {
      const src = read(f);
      if (/\bsetInterval\s*\(/.test(src) && !ALLOWED_INTERVALS.has(rel(f))) bad.push(`${rel(f)}: setInterval`);
      if (/\bsetTimeout\s*\(/.test(src) && !ALLOWED_TIMEOUTS.has(rel(f))) bad.push(`${rel(f)}: setTimeout`);
    }
    expect(bad).toEqual([]);
  });
});
