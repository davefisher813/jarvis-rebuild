// verify-rls.mjs
//
// Proves on a REAL Supabase project the things the in-memory tests cannot:
// row-level security isolation (D6), hard delete with no resurrection (D4/D5),
// and monotonic server time (D7/D10). Run this once after applying migration
// 0001 and creating two test users. The sandbox cannot do this; your machine
// can.
//
// Usage:
//   npm i @supabase/supabase-js
//   SUPABASE_URL=...                 (Project URL)
//   SUPABASE_ANON_KEY=...            (anon public key)
//   A_EMAIL=... A_PASSWORD=...       (test user A, already created)
//   B_EMAIL=... B_PASSWORD=...       (test user B, already created)
//   node verify-rls.mjs
//
// Exit code 0 = all checks passed. Non-zero = a check failed (printed).

import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_ANON_KEY, A_EMAIL, A_PASSWORD, B_EMAIL, B_PASSWORD } = process.env;

for (const [k, v] of Object.entries({
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  A_EMAIL,
  A_PASSWORD,
  B_EMAIL,
  B_PASSWORD,
})) {
  if (!v) {
    console.error(`Missing env var: ${k}`);
    process.exit(2);
  }
}

const fail = [];
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) fail.push(name);
};

async function signedClient(email, password) {
  const c = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

async function main() {
  const a = await signedClient(A_EMAIL, A_PASSWORD);
  const b = await signedClient(B_EMAIL, B_PASSWORD);

  // Create a row as A.
  const ins = await a.from("item").insert({ entity_type: "item", data: { label: "A-secret" } }).select("id").single();
  if (ins.error) throw new Error(`A insert failed: ${ins.error.message}`);
  const id = ins.data.id;

  // D6: B cannot read A's row.
  const bRead = await b.from("item").select("id").eq("id", id).maybeSingle();
  check("D6 isolation: B cannot read A's row", bRead.data === null);

  // D6: B cannot update A's row (RPC affects zero rows).
  const bUpd = await b.rpc("item_apply_patch", { p_id: id, p_patch: { label: "hacked" } });
  check("D6 isolation: B's update of A's row applies nothing", bUpd.data === false);

  // D7/D10: two quick updates by A produce strictly increasing updated_at.
  await a.rpc("item_apply_patch", { p_id: id, p_patch: { n: 1 } });
  const t1 = (await a.from("item").select("updated_at").eq("id", id).single()).data.updated_at;
  await a.rpc("item_apply_patch", { p_id: id, p_patch: { n: 2 } });
  const t2 = (await a.from("item").select("updated_at").eq("id", id).single()).data.updated_at;
  check("D7/D10 monotonic server time: updated_at strictly increases", Date.parse(t2) > Date.parse(t1));

  // D9: A updating a missing id applies nothing, no throw.
  const miss = await a.rpc("item_apply_patch", {
    p_id: "00000000-0000-0000-0000-000000000000",
    p_patch: { x: 1 },
  });
  check("D9 missing-id update is a safe no-op", miss.error === null && miss.data === false);

  // D4/D5: A hard-deletes the row; it is gone and cannot be read back.
  const del = await a.from("item").delete().eq("id", id);
  check("D4 hard delete succeeds", del.error === null);
  const gone = await a.from("item").select("id").eq("id", id).maybeSingle();
  check("D5 deleted row never returns (no tombstone)", gone.data === null);

  console.log("");
  if (fail.length) {
    console.error(`${fail.length} check(s) FAILED: ${fail.join("; ")}`);
    process.exit(1);
  }
  console.log("All device checks PASSED.");
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(3);
});
