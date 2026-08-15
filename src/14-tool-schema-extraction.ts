// Example 14 — Task Statement 4.3: "give me JSON" versus a tool with a JSON
// schema, on the same document, with the same model.
//
// The claim the exam makes is that tool use with a JSON schema is the most
// reliable way to get structured output, because it eliminates JSON syntax
// errors. That is true, and it is easy to under-read as "the model is more
// careful when there's a schema". It isn't. The difference is structural:
//
//   asking for JSON in prose  ->  the model produces TEXT. Text that is
//                                 usually valid JSON, sometimes fenced,
//                                 occasionally prefaced, and always your
//                                 problem to parse.
//
//   defining a tool           ->  the model produces a tool_use block whose
//                                 `input` is ALREADY a parsed object of the
//                                 declared shape. There is no string to
//                                 parse, so there is no parse to fail.
//
// So the honest way to demonstrate this is not "watch the prose arm break"
// — on a current model it usually won't, on this document, today. It is to
// look at the code each arm forces you to write, and at what each one
// GUARANTEES. Part 1 does that with no API call at all.
//
// The document is INV-8842, whose stated total is wrong (see documents.ts).
// Watch what every arm does with `total_amount`: they all extract 1008.38,
// which is schema-valid, correctly typed, and false. That is example 17.

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { INVOICE_MISMATCHED, INVOICE_MISMATCHED_TRUTH } from "./shared/documents.js";
import {
  INVOICE_TOOL_MINIMAL,
  T_EXTRACT_INVOICE,
  firstToolUse,
  parseLooseJson,
  textOf,
} from "./shared/extractionTools.js";

const MODEL = "claude-haiku-4-5";

// The prose arm has to describe the shape in words, because there is no
// schema to describe it. Note how much of this prompt is spent on framing
// rather than on the task — "only JSON", "no markdown", "no preamble" — and
// that every one of those sentences is a request, not a constraint.
const PROSE_PROMPT = [
  "Extract this invoice as JSON with exactly these keys: invoice_number",
  "(string), invoice_date (string, YYYY-MM-DD), supplier_name (string),",
  "currency (string, ISO 4217 code), total_amount (number).",
  "",
  "Return ONLY the JSON object. No markdown fences, no explanation, no",
  "preamble.",
  "",
  INVOICE_MISMATCHED,
].join("\n");

// The tool arm's prompt says nothing about shape at all — the schema is the
// shape, and it travels with the request instead of being restated in prose
// that can drift out of sync with the parser on the other end.
const TOOL_PROMPT = ["Extract this invoice.", "", INVOICE_MISMATCHED].join("\n");

// ── Part 1: the parser you need for prose, exercised with no API call ────

/**
 * Four things a model can plausibly return when asked for "only JSON".
 * None of these is exotic; all four are shapes people hit in production.
 */
const PROSE_FIXTURES: { label: string; text: string }[] = [
  {
    label: "clean object",
    text: '{"invoice_number": "INV-8842", "total_amount": 1008.38}',
  },
  {
    label: "wrapped in a markdown fence",
    text: '```json\n{"invoice_number": "INV-8842", "total_amount": 1008.38}\n```',
  },
  {
    label: "with a helpful preamble",
    text: 'Here is the extracted invoice:\n\n{"invoice_number": "INV-8842", "total_amount": 1008.38}\n\nLet me know if you need the line items too.',
  },
  {
    label: "number written the way the document writes it",
    text: '{"invoice_number": "INV-8842", "total_amount": 1,008.38}',
  },
];

function demonstrateParsing() {
  console.log("════════ Part 1 — the salvage code, no model involved ════════\n");

  for (const fixture of PROSE_FIXTURES) {
    const parsed = parseLooseJson(fixture.text);
    console.log(`  ${fixture.label}`);
    console.log(`    parsed  : ${parsed.ok ? "yes" : "NO"}`);
    if (parsed.repairs.length) {
      console.log(`    repairs : ${parsed.repairs.join(", ")}`);
    }
    if (!parsed.ok) console.log(`    error   : ${parsed.error}`);
    console.log("");
  }

  console.log(
    [
      "  The first three parse, and every repair that made them parse was a",
      "  GUESS about what the model meant. The fourth is the one to sit with:",
      "  `1,008.38` is not valid JSON, and it is not a stupid thing for a model",
      "  to emit — it is the number exactly as the document prints it. A",
      "  thousands separator is one character, and it takes the whole record",
      "  down.",
      "",
      "  None of this code exists in the tool arm. Not because the tool arm is",
      "  written more defensively, but because there is no string in it to",
      "  defend against: `tool_use.input` arrives as an object.",
    ].join("\n"),
  );
}

// ── Part 2: the same extraction, three ways ──────────────────────────────

async function armProse(client: Anthropic) {
  console.log("\n──────── Arm A — 'return JSON', no tools ────────");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: PROSE_PROMPT }],
  });

  const raw = textOf(response);
  console.log(`  stop_reason : ${response.stop_reason}`);
  console.log(`  raw text    : ${JSON.stringify(raw)}`);

  const parsed = parseLooseJson(raw);
  console.log(`  parsed      : ${parsed.ok ? "yes" : "NO — " + parsed.error}`);
  console.log(
    `  repairs     : ${parsed.repairs.length ? parsed.repairs.join(", ") : "none needed"}`,
  );
  return parsed;
}

async function armAuto(client: Anthropic) {
  console.log("\n──────── Arm B — tool defined, tool_choice: auto ────────");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [INVOICE_TOOL_MINIMAL],
    // The default. The model MAY call the tool; nothing says it must.
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: TOOL_PROMPT }],
  });

  const call = firstToolUse(response);
  console.log(`  stop_reason : ${response.stop_reason}`);
  console.log(`  tool called : ${call ? call.name : "NO — answered in text"}`);
  if (call) console.log(`  input       : ${JSON.stringify(call.input)}`);
  else console.log(`  text        : ${JSON.stringify(textOf(response))}`);
  return call;
}

async function armForced(client: Anthropic) {
  console.log("\n──────── Arm C — tool_choice: forced, strict schema ────────");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [INVOICE_TOOL_MINIMAL],
    // Not "please": the model cannot end this turn any other way.
    tool_choice: { type: "tool", name: T_EXTRACT_INVOICE },
    messages: [{ role: "user", content: TOOL_PROMPT }],
  });

  const call = firstToolUse(response);
  console.log(`  stop_reason : ${response.stop_reason}`);
  console.log(`  tool called : ${call ? call.name : "none (should be impossible)"}`);
  console.log(`  input       : ${JSON.stringify(call?.input)}`);
  console.log(`  typeof      : ${typeof call?.input} — no JSON.parse anywhere`);
  return call;
}

async function main() {
  demonstrateParsing();

  console.log("\n\n════════ Part 2 — the same invoice, three ways ════════");

  const client = new Anthropic();

  const prose = await armProse(client);
  const auto = await armAuto(client);
  const forced = await armForced(client);

  console.log("\n════════ comparison ════════\n");

  const rows: [string, string, string][] = [
    [
      "Arm A  prose JSON",
      prose.ok ? "parsed after " + (prose.repairs.length || 0) + " repair(s)" : "FAILED TO PARSE",
      "no guarantee of shape, keys, or types",
    ],
    [
      "Arm B  tool, auto",
      auto ? "tool_use" : "TEXT — no tool call",
      "shape guaranteed IF the tool is called",
    ],
    [
      "Arm C  tool, forced",
      forced ? "tool_use" : "impossible",
      "shape guaranteed, tool call guaranteed",
    ],
  ];
  for (const [arm, outcome, guarantee] of rows) {
    console.log(`  ${arm.padEnd(20)} ${outcome.padEnd(28)} ${guarantee}`);
  }

  // The point the arms agree on, which is the more useful finding.
  const total = (forced?.input as { total_amount?: number } | undefined)
    ?.total_amount;

  console.log(
    [
      "",
      "What to notice:",
      "",
      "  Arm A very likely worked. It usually does — a current model asked for",
      "  clean JSON generally returns clean JSON, and if your reason for using",
      "  tool use is 'the model writes broken JSON', you will fail to reproduce",
      "  the problem and conclude the schema was unnecessary.",
      "",
      "  That is the wrong test. Compare the CODE instead. Arm A ends in a",
      "  string and a parser that can fail, so it needs `parseLooseJson`, a",
      "  try/catch, a retry path, and a decision about what to do with a record",
      "  that never parses. Arm C ends in `block.input`, an object, already the",
      "  declared shape — and with `strict: true` on the tool, validated by the",
      "  API before it reaches your process at all. The failure mode is not",
      "  handled; it is absent.",
      "",
      "  Arm B is the one worth remembering, because `auto` is the default and",
      "  it is a PERMISSION, not a guarantee. It got a tool call here because",
      "  the request was unambiguous. Example 15 gives it an ambiguous one.",
      "",
      `  And the thing all three agree on: total_amount came back as ${total}.`,
      `  The document's line items and VAT sum to ${INVOICE_MISMATCHED_TRUTH.calculated_total};`,
      `  the document's own TOTAL DUE line says ${INVOICE_MISMATCHED_TRUTH.stated_total}, and that`,
      "  is what every arm extracted. It is the right answer to the question",
      "  the schema asked. It is a correctly-typed, schema-valid, fully",
      "  guaranteed number that is wrong by 51.99.",
      "",
      "  Strict JSON schemas eliminate syntax errors. They do not touch",
      "  semantics — that is example 17.",
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
