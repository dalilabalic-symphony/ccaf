// Example 13 — Task Statement 1.5: a PostToolUse hook that normalises
// heterogeneous data from different MCP tools before the model reads it.
//
// The three mock services disagree the way real ones do:
//
//   crm.get_customer      signup_date   ISO 8601 string    verification_status  string
//   orders.get_orders     placed_at     Unix SECONDS       status               numeric code
//   billing.get_payments  processed_at  Unix MILLIseconds  state                SCREAMING_CASE
//
// The dangerous pair is seconds vs milliseconds. They are both bare integers,
// both plausible, and nothing in the payload says which is which — so
// misreading one does not raise an error, it produces a confident wrong
// answer. Numeric status codes fail differently: `status: 4` is not wrong,
// it is unresolvable without a codebook the model was never given.
//
// So the run below asks a question whose answer depends entirely on getting
// both right: order these events in time, and say what state each is in.
// Run A gets the raw records. Run B gets the same records through the hook.
//
// Ground truth, computed by hand:
//   ORD-1001 placed   1748347200 s   -> 2025-05-27T12:00:00Z   status 3 = delivered
//   ORD-1002 placed   1751025600 s   -> 2025-06-27T12:00:00Z   status 4 = returned
//   PAY-77455 charged 1751025660000 ms -> 2025-06-27T12:01:00Z  SETTLED
//   PAY-77456 charged 1751025720000 ms -> 2025-06-27T12:02:00Z  SETTLED  (duplicate)
//   ORD-1003 placed   1753704000 s   -> 2025-07-28T12:00:00Z   status 2 = shipped
//
// An observed Run A, for what actually goes wrong:
//
//   ORD-1001   said 2025-05-24   (true 2025-05-27)
//   ORD-1002   said 2025-12-24   (true 2025-06-27)
//   ORD-1003   said 2026-01-22   (true 2025-07-28)
//
// Every date wrong, one of them by six months — and none of them absurd.
// That is the actual hazard, and it is worse than the year-57470 blowup you
// might expect from reading milliseconds as seconds: an obviously insane
// date gets caught, whereas "2025-12-24" is a date a human reviewer signs
// off on. Run A even kept the events in the right ORDER, so the answer
// reads as coherent while being false in every particular.

import "dotenv/config";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { trace } from "./shared/trace.js";
import {
  T_GET_ORDERS,
  T_GET_PAYMENTS,
  supportMcpServers,
} from "./shared/supportTools.js";
import { normalizeReads, normalizeRecord } from "./shared/supportHooks.js";

const MODEL = "claude-haiku-4-5";

// Deliberately a small model. Normalisation is a data-plumbing problem, and
// the fix should not be "pay for a model smart enough to notice the
// millisecond field". If the hook only helps on a weak model, it is a crutch;
// if it removes a class of error regardless of model, it is infrastructure.

const QUESTION = [
  "Customer CUS-4471. Retrieve their orders and their payments.",
  "",
  "Then answer two things, briefly:",
  "  1. List every order and payment event in chronological order, oldest",
  "     first, each with its date as YYYY-MM-DD.",
  "  2. Give the plain-English state of each order — not the raw field value.",
  "",
  "State the dates you derived. Do not caveat or hedge; commit to an order.",
].join("\n");

async function run(label: string, normalise: boolean): Promise<string> {
  console.log(`\n──────── ${label} ────────`);

  const stream = query({
    prompt: QUESTION,
    options: {
      model: MODEL,
      mcpServers: supportMcpServers,
      tools: [],
      allowedTools: [T_GET_ORDERS, T_GET_PAYMENTS],
      permissionMode: "dontAsk",
      // SDK isolation. Without this the SDK loads the developer's own
      // ~/.claude and .claude/* settings, and the agent starts reasoning
      // about the machine it happens to be running on — an early run of this
      // example refused because the operator's real email did not match the
      // ticket. An example that behaves differently on your machine than on
      // mine is not an example.
      settingSources: [],

      // The only difference between the runs.
      hooks: normalise ? { PostToolUse: [normalizeReads()] } : {},
    },
  });

  return trace(stream);
}

function showTransformation() {
  console.log("\n════════ the transformation, no API call needed ════════");

  const samples: [string, Record<string, unknown>][] = [
    [
      T_GET_ORDERS,
      { order_id: "ORD-1002", placed_at: 1751025600, status: 4, total_usd: 740 },
    ],
    [
      T_GET_PAYMENTS,
      {
        payment_id: "PAY-77455",
        processed_at: 1751025660000,
        state: "SETTLED",
        amount_usd: 740,
      },
    ],
  ];

  for (const [toolName, raw] of samples) {
    const out = normalizeRecord(toolName, raw);
    console.log(`\n  ${toolName.replace(/^mcp__/, "")}`);
    console.log(`    raw        : ${JSON.stringify(raw)}`);
    console.log(
      `    normalised : occurred_at_iso=${out.occurred_at_iso}  status_label=${out.status_label}`,
    );
  }

  console.log(
    [
      "",
      "  Both raw timestamps start with 175. One is seconds and one is",
      "  milliseconds, and nothing in the payload says which. `normalizeRecord`",
      "  is a pure function, so that distinction is settled once, in code you",
      "  can test — rather than re-inferred by the model on every read.",
    ].join("\n"),
  );
}

async function main() {
  showTransformation();

  const raw = await run("Run A — raw records, no hook", false);
  const normalised = await run("Run B — PostToolUse normalisation", true);

  console.log("\n════════ Run A answer (raw) ════════\n");
  console.log(raw);
  console.log("\n════════ Run B answer (normalised) ════════\n");
  console.log(normalised);

  console.log(
    [
      "\nWhat to notice:",
      "  Diff Run A's dates against the ground truth in the header comment,",
      "  date by date. In the run this example was written against, all of",
      "  them were wrong — and none of them looked wrong. The events stayed in",
      "  the correct order and every date was a real, unremarkable date, so",
      "  there is nothing in Run A's answer that would make a reviewer check.",
      "  That is the failure worth fearing: not a crash, a plausible wrong.",
      "",
      "  In Run B the model never sees a raw epoch integer or a bare status",
      "  code. The hook replaced the tool output with `updatedToolOutput`",
      "  before it reached the model, so `occurred_at_iso` and `status_label`",
      "  are simply what get_orders and get_payments return as far as it is",
      "  concerned — even though the two services encode neither the same way.",
      "",
      "  This is also where hooks beat a wrapper around each tool: the three",
      "  services are three separate MCP servers, and one hook with one regex",
      "  matcher spans all of them. A fourth service means one entry in",
      "  NORMALISERS, not a new prompt paragraph in every agent that reads it.",
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
