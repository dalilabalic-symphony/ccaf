// Example 15 — Task Statement 4.3: the three `tool_choice` settings, and
// what each one is actually promising.
//
//   auto                       the model MAY call a tool. Default.
//   any                        the model MUST call a tool, its pick.
//   { type: "tool", name }     the model MUST call THAT tool.
//
// Read as a list, these look like a dial from lax to strict, and the
// obvious conclusion is "use the strictest one you can". The run below is
// built to show why that conclusion is wrong: each setting fails
// differently, and the failures are what tell you which one a given step of
// a pipeline wants.
//
// The setup is the one the exam names: several extraction schemas, and a
// document whose type you do not know yet. Four documents arrive as an
// undifferentiated pile — an invoice, a purchase order, a customer
// complaint, and an internal memo about bank holiday cover.
//
// That fourth one is the fixture that does the work. It is not a document
// any of the three schemas describe, and a real inbox is full of them.

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { INTERNAL_MEMO, UNSORTED_DOCUMENTS } from "../shared/documents.js";
import {
  INVOICE_TOOL_ROUTED,
  METADATA_TOOL,
  PURCHASE_ORDER_TOOL,
  SUPPORT_TICKET_TOOL,
  T_EXTRACT_INVOICE,
  T_EXTRACT_METADATA,
  T_EXTRACT_PURCHASE_ORDER,
  T_EXTRACT_SUPPORT_TICKET,
  firstToolUse,
  textOf,
} from "../shared/extractionTools.js";

const MODEL = "claude-haiku-4-5";

const EXTRACTION_TOOLS = [
  INVOICE_TOOL_ROUTED,
  PURCHASE_ORDER_TOOL,
  SUPPORT_TICKET_TOOL,
];

// The tool DESCRIPTIONS are the routing logic here, not this prompt. Each
// one says what its document type is and, more importantly, what it is not
// ("Not for invoices, which request payment after the fact") — the same
// discipline as writing an `AgentDefinition.description` as routing
// guidance in Part 2. With `tool_choice: "any"` the model has to choose
// between schemas, and the descriptions are all it has to choose from.
const SORT_PROMPT = (text: string) =>
  ["Record the contents of this document.", "", text].join("\n");

type Sorted = { label: string; picked: string; input: unknown };

// ── Stage 1: tool_choice "any" over the whole pile ───────────────────────

async function sortWithAny(client: Anthropic): Promise<Sorted[]> {
  console.log("════════ Stage 1 — tool_choice: \"any\" ════════");
  console.log(
    "  Three schemas offered, the model must call exactly one of them.\n",
  );

  const out: Sorted[] = [];

  for (const doc of UNSORTED_DOCUMENTS) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      tools: EXTRACTION_TOOLS,
      tool_choice: { type: "any" },
      messages: [{ role: "user", content: SORT_PROMPT(doc.text) }],
    });

    const call = firstToolUse(response);
    const picked = call?.name ?? "NONE";
    console.log(`  ${doc.label.padEnd(12)} -> ${picked}`);
    out.push({ label: doc.label, picked, input: call?.input });
  }

  const memo = out[3];
  console.log(
    [
      "",
      `  The memo was filed as ${memo.picked}. Look at what it had to invent to`,
      "  do that:",
      `    ${JSON.stringify(memo.input)}`,
      "",
      "  `any` guarantees you a structured record. It cannot guarantee the",
      "  record is true, and it removes the model's ability to say the honest",
      "  thing — that this is not one of your three document types. A forced",
      "  choice among wrong options is still wrong; it is just wrong in a",
      "  well-typed way that will pass every downstream check you have.",
    ].join("\n"),
  );

  return out;
}

// ── Stage 2: the same memo on auto ───────────────────────────────────────

async function memoOnAuto(client: Anthropic) {
  console.log("\n\n════════ Stage 2 — the same memo, tool_choice: \"auto\" ════════\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: EXTRACTION_TOOLS,
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: SORT_PROMPT(INTERNAL_MEMO) }],
  });

  const call = firstToolUse(response);
  console.log(`  stop_reason : ${response.stop_reason}`);
  console.log(`  tool called : ${call ? call.name : "none"}`);
  if (!call) {
    console.log(`  text        : ${JSON.stringify(textOf(response).slice(0, 300))}`);
  } else {
    console.log(`  input       : ${JSON.stringify(call.input)}`);
  }

  console.log(
    [
      "",
      call
        ? "  It called a tool anyway this time — `auto` permits that, and on a\n" +
          "  request phrased as an instruction the model usually obliges. Do not\n" +
          "  read that as a guarantee: the same call with a more conversational\n" +
          "  document can come back as prose, and prose is what your extraction\n" +
          "  pipeline is least equipped to receive."
        : "  No tool call — the model answered in prose, which is `auto` working\n" +
          "  exactly as documented. It is also a pipeline outage: the step after\n" +
          "  this one expects a record and got a paragraph.",
      "",
      "  So: `auto` can under-produce (no structured output) and `any` can",
      "  over-produce (structured output for a document that has none). Neither",
      "  is a bug. They are different defaults for different steps, and the",
      "  choice between them is a design decision you have to make per call.",
    ].join("\n"),
  );
}

// ── Stage 3: force the router, then dispatch ─────────────────────────────

type Metadata = {
  document_type: string;
  document_id: string | null;
  issuer: string | null;
  issued_date: string | null;
  type_detail: string | null;
};

const ENRICHMENT: Record<string, string> = {
  invoice: T_EXTRACT_INVOICE,
  purchase_order: T_EXTRACT_PURCHASE_ORDER,
  support_ticket: T_EXTRACT_SUPPORT_TICKET,
};

async function routeThenEnrich(client: Anthropic) {
  console.log(
    "\n\n════════ Stage 3 — forced metadata pass, then dispatch ════════\n",
  );
  console.log(
    [
      "  Two calls per document instead of one, and the first is forced:",
      `    tool_choice: { type: "tool", name: "${T_EXTRACT_METADATA}" }`,
      "",
      "  That is the exam's 'ensure a particular extraction runs before the",
      "  enrichment steps'. The router cannot be skipped, cannot answer in",
      "  prose, and cannot pick a different tool — so every document that",
      "  enters the pipeline leaves stage one with a type on it, and the",
      "  dispatch below is ordinary TypeScript rather than a second thing the",
      "  model has to get right.\n",
    ].join("\n"),
  );

  for (const doc of UNSORTED_DOCUMENTS) {
    const routed = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      tools: [METADATA_TOOL],
      tool_choice: { type: "tool", name: T_EXTRACT_METADATA },
      messages: [
        {
          role: "user",
          content: ["Classify this document.", "", doc.text].join("\n"),
        },
      ],
    });

    const meta = firstToolUse(routed)?.input as Metadata;
    const target = ENRICHMENT[meta.document_type];

    console.log(
      `  ${doc.label.padEnd(12)} type=${meta.document_type.padEnd(15)} id=${meta.document_id ?? "—"}`,
    );

    if (!target) {
      // The memo lands here, and this is the whole point of the stage: the
      // pipeline's answer to "not one of my types" is to stop, not to
      // produce a confident record of the wrong kind.
      console.log(
        `  ${" ".repeat(12)} no enrichment schema for this type${meta.type_detail ? ` (${meta.type_detail})` : ""} — held for review`,
      );
      continue;
    }

    const enriched = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      tools: EXTRACTION_TOOLS,
      // Forced again, this time to the schema the router chose. The model is
      // not asked to re-decide what kind of document it is holding.
      tool_choice: { type: "tool", name: target },
      messages: [{ role: "user", content: SORT_PROMPT(doc.text) }],
    });

    const call = firstToolUse(enriched);
    console.log(
      `  ${" ".repeat(12)} ${call?.name} -> ${JSON.stringify(call?.input).slice(0, 120)}…`,
    );
  }
}

async function main() {
  const client = new Anthropic();

  await sortWithAny(client);
  await memoOnAuto(client);
  await routeThenEnrich(client);

  console.log(
    [
      "",
      "════════ what to take away ════════",
      "",
      "  auto   permission. Right when a tool call is one option among",
      "         several legitimate ones — a conversational agent that can",
      "         answer directly. Wrong for a pipeline stage whose next step",
      "         requires a record.",
      "",
      "  any    a guarantee about the CALL, not about the ANSWER. Right when",
      "         you have several schemas, the document is definitely one of",
      "         them, and you want the model to route. Combine it with an",
      "         escape hatch — a catch-all schema, or an `unclear` member —",
      "         or you have bought yourself confident misfiling.",
      "",
      "  forced right when the step is not a decision. Stage 3's router runs",
      "         on every document because nothing about the request lets it",
      "         not run; the type-specific pass is forced because the type was",
      "         already decided upstream and re-asking invites disagreement.",
      "",
      "  Stage 3 is more calls and more tokens than stage 1, and it is the one",
      "  to copy. The extra call buys a guaranteed decision point that lives",
      "  in your code rather than in the model's — which is also where the",
      "  memo's 'no schema for this' branch lives, and there is no prompt",
      "  wording that produces that branch reliably.",
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
