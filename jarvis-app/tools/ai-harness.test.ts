/* THE LIVE AI HARNESS (queue item 12). Not part of the suite: without
 * AI_HARNESS=1 every block below skips, so `vitest run` stays free and
 * offline. With the gate open it spends real money on purpose:
 *
 *   AI_HARNESS=1 ANTHROPIC_API_KEY=sk-... npx vitest run tools/ai-harness.test.ts
 *
 * Options (env):
 *   AI_MODEL        model to measure (default claude-sonnet-4-6, same as the proxy)
 *   MONEY_CSV       path to a real bank statement CSV: adds the Money v2
 *                   statement-parse lane the design gate owes a measurement
 *   AI_PRICE_IN / AI_PRICE_OUT  $ per million tokens. NO DEFAULT: the report
 *                   prints token counts always, dollars only when prices are
 *                   given, because a stale hardcoded price is a fabricated
 *                   cost model.
 *
 * What it does: replays the golden set through the REAL prompts, schemas, and
 * forced tool calls against the REAL model, scores exact-match with the same
 * scorer the offline suite uses, records measured tokens per call kind, and
 * writes tools/ai-cost-report.md + .json. Drift in the score or a jump in
 * tokens is the signal to look before shipping a model or prompt change.
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, readFileSync } from "node:fs";
import { CAPTURE_GOLD, TRIAGE_GOLD, CAPTURE_GOLD_CATEGORIES, toThreadRows } from "../src/ai/golden/goldenSet";
import { scoreCapture, scoreTriage, summarize, type CaseScore } from "../src/ai/golden/score";
import { captureSystemPrompt, parseCapture, CAPTURE_SCHEMA } from "../src/ai/capture";
import { buildTriageInput, parseTriage, TRIAGE_SCHEMA } from "../src/messages/triage";
import { toolPayload, extractText } from "../src/ai/structured";
import { assembleContext } from "../src/ai/context";

const LIVE = process.env.AI_HARNESS === "1";
const MODEL = process.env.AI_MODEL || "claude-sonnet-4-6";
const KEY = process.env.ANTHROPIC_API_KEY || "";

interface Measured { kind: string; name: string; inTok: number; outTok: number; ms: number }
const measured: Measured[] = [];
const capScores: CaseScore[] = [];
const triScores: CaseScore[] = [];

async function call(kind: string, name: string, system: string, user: string, schema: Record<string, unknown>): Promise<string> {
  const t0 = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system,
      ...toolPayload(schema),
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`upstream ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    content?: { type: string; text?: string; name?: string; input?: unknown }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  measured.push({
    kind, name,
    inTok: data.usage?.input_tokens ?? 0,
    outTok: data.usage?.output_tokens ?? 0,
    ms: Date.now() - t0,
  });
  return extractText(data.content);
}

// The same fixture person for every run, so token counts are comparable
// run over run. Shaped like a real profile, deliberately compact.
const CTX = assembleContext({
  name: "Dave",
  template: "personal",
  people: ["Emma", "Mike Torres", "Coach Ramirez"],
  categories: CAPTURE_GOLD_CATEGORIES.map((name) => ({ name })),
  tasks: [{ text: "Renew car registration", done: false }],
  events: [{ title: "Standup", start: "09:00" }],
});

describe.skipIf(!LIVE)("live golden set", () => {
  it("has a key", () => {
    expect(KEY, "set ANTHROPIC_API_KEY").toBeTruthy();
  });

  it("capture cases", { timeout: 300000 }, async () => {
    for (const gold of CAPTURE_GOLD) {
      const raw = await call("capture", gold.name, captureSystemPrompt(CTX, gold.today), gold.input, CAPTURE_SCHEMA);
      capScores.push(scoreCapture(gold, parseCapture(raw)));
    }
    const sum = summarize(capScores);
    // eslint-disable-next-line no-console
    console.log(`capture: ${sum.passed}/${sum.total}`, capScores.filter((c) => !c.pass));
    expect(sum.total).toBe(CAPTURE_GOLD.length);
  });

  it("triage cases", { timeout: 300000 }, async () => {
    for (const gold of TRIAGE_GOLD) {
      const rows = toThreadRows(gold.rows);
      const raw = await call("triage", gold.name, "You output only a JSON array, nothing else.", buildTriageInput(rows), TRIAGE_SCHEMA);
      triScores.push(scoreTriage(gold, parseTriage(raw, rows)));
    }
    const sum = summarize(triScores);
    // eslint-disable-next-line no-console
    console.log(`triage: ${sum.passed}/${sum.total}`, triScores.filter((c) => !c.pass));
    expect(sum.total).toBe(TRIAGE_GOLD.length);
  });

  // The Money v2 lane (design gate section 2): measure the two AI touches of
  // a statement parse on a REAL statement. Runs only when MONEY_CSV points at
  // one; the report says loudly when this lane did not run.
  it("money v2 statement parse", { timeout: 300000 }, async () => {
    const csvPath = process.env.MONEY_CSV;
    if (!csvPath) return; // absence is reported, not faked
    const text = readFileSync(csvPath, "utf8");
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const header = lines[0] ?? "";
    const rows = lines.slice(1);

    // Call 1: column mapping, once per bank format (headers + 3 sample rows).
    const mapSchema = {
      type: "object",
      properties: {
        date: { type: "string" }, description: { type: "string" }, amount: { type: "string" },
        sign: { type: "string", enum: ["negative_is_spend", "positive_is_spend", "separate_columns"] },
      },
      required: ["date", "description", "amount", "sign"],
    };
    await call("money_map", "column mapping", "Map bank CSV columns. Answer with the column NAMES from the header.",
      `Header: ${header}\nSample rows:\n${rows.slice(0, 3).join("\n")}`, mapSchema);

    // Call 2: ambiguous-row classification. The real pipeline sends only rows
    // Tiers 1-2 could not settle; 15% of rows is the design gate's upper
    // band, descriptions and signs only, one batched call.
    const sample = rows.filter((_, i) => i % 7 === 0);
    const triSchema = {
      type: "object",
      properties: {
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: { i: { type: "integer" }, tag: { type: "string", enum: ["spend", "income", "transfer", "card_payment"] } },
            required: ["i", "tag"],
          },
        },
      },
      required: ["rows"],
    };
    await call("money_rows", `classify ${sample.length} ambiguous rows`,
      "Classify bank statement rows. A transfer moves the user's own money; a card payment pays their own card.",
      sample.map((r, i) => `${i}: ${r}`).join("\n"), triSchema);
  });

  it("writes the report", () => {
    const priceIn = Number(process.env.AI_PRICE_IN || "") || null;
    const priceOut = Number(process.env.AI_PRICE_OUT || "") || null;
    const byKind = new Map<string, { calls: number; inTok: number; outTok: number }>();
    for (const m of measured) {
      const k = byKind.get(m.kind) ?? { calls: 0, inTok: 0, outTok: 0 };
      k.calls++; k.inTok += m.inTok; k.outTok += m.outTok;
      byKind.set(m.kind, k);
    }
    const dollars = (inTok: number, outTok: number) =>
      priceIn !== null && priceOut !== null ? `$${((inTok * priceIn + outTok * priceOut) / 1e6).toFixed(4)}` : "n/a (set AI_PRICE_IN/OUT)";

    const lines: string[] = [];
    lines.push(`# AI cost + quality report`, "");
    lines.push(`Model: ${MODEL}. Golden scores: capture ${summarize(capScores).passed}/${capScores.length}, triage ${summarize(triScores).passed}/${triScores.length}.`, "");
    lines.push(`| kind | calls | in tok/call | out tok/call | cost/call |`);
    lines.push(`| --- | --- | --- | --- | --- |`);
    for (const [kind, k] of byKind) {
      lines.push(`| ${kind} | ${k.calls} | ${Math.round(k.inTok / k.calls)} | ${Math.round(k.outTok / k.calls)} | ${dollars(k.inTok / k.calls, k.outTok / k.calls)} |`);
    }
    lines.push("");
    if (!byKind.has("money_map")) lines.push(`Money v2 lane DID NOT RUN (no MONEY_CSV given). The design gate's parse cost is still unmeasured.`, "");
    lines.push(`Prices ${priceIn !== null ? `used: $${priceIn}/M in, $${priceOut}/M out` : "not given; token counts only"}. Failed cases and per-call detail in ai-cost-report.json.`);
    writeFileSync("tools/ai-cost-report.md", lines.join("\n"));
    writeFileSync("tools/ai-cost-report.json", JSON.stringify({ model: MODEL, measured, capScores, triScores }, null, 2));
    expect(measured.length).toBeGreaterThan(0);
  });
});

// Keeps vitest from complaining when the whole live block is skipped.
describe("harness is gated", () => {
  it("stays offline without AI_HARNESS=1", () => {
    expect(true).toBe(true);
  });
});
