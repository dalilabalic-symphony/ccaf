// Example 11 — Task Statement 1.4: decompose a multi-concern request, work
// the pieces in parallel over shared context, then synthesise one resolution.
//
// Real support tickets are not one question. The email below carries four
// concerns tangled into five sentences, and the failure mode is answering
// the loudest one and quietly dropping the rest.
//
// The shape:
//
//        one email, four concerns
//                  |
//            coordinator            decomposes, then delegates
//         /     |      |     \
//       inv    inv    inv    inv    ONE agent definition, four instances,
//        \      |      |     /      differing only in the item assigned
//              synthesist           one reply, one decision per item
//
// Two things this example is really about:
//
// SHARED CONTEXT. A subagent inherits nothing — not the email, not the
// customer id, not what a sibling just found. So each delegation prompt has
// to carry the shared header (case id, customer id, verification status, the
// email verbatim) on top of its own item. Four subagents therefore get four
// prompts that are ~80% identical, and that redundancy is the mechanism, not
// waste: it is what makes the investigations independent enough to run at
// once.
//
// ONE DEFINITION, MANY INSTANCES. `case-investigator` is defined once. The
// decomposition decides how many copies run and what each owns, which means
// a five-concern email needs no code change. Compare example 6, where the
// roster is fixed and the coordinator picks from it.
//
// No money moves here — the investigators read, and the output is a proposed
// resolution. Executing it is example 12's job.

import "dotenv/config";
import { query, type AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { trace } from "../shared/trace.js";
import {
  OPERATOR_FRAMING,
  T_GET_CUSTOMER,
  T_GET_ORDERS,
  T_GET_PAYMENTS,
  supportMcpServers,
} from "../shared/supportTools.js";
import {
  auditTrail,
  delegationTrail,
  normalizeReads,
} from "../shared/supportHooks.js";

const COORDINATOR_MODEL = "claude-sonnet-5";
const INVESTIGATOR_MODEL = "claude-haiku-4-5";

// One definition. The coordinator instantiates it once per concern, and the
// prompt is written for "whatever item you were handed" rather than for any
// particular concern — that is what makes it reusable across decompositions.
const caseInvestigator: AgentDefinition = {
  description:
    "Investigates ONE item of a customer complaint against the order and billing records and reports cited findings. Use once per distinct concern; run several in parallel.",
  prompt: [
    OPERATOR_FRAMING,
    "",
    "You investigate exactly one item of a customer support case.",
    "",
    "Your prompt contains a shared case header and one assigned item. Work",
    "only the assigned item. Another investigator owns each of the others,",
    "and duplicating their work costs money without adding coverage.",
    "",
    "Use the record tools to establish what actually happened. Two or three",
    "calls exhaust what is available.",
    "",
    "Report in this exact shape and nothing else:",
    "  ITEM: <restate your assigned item in one line>",
    "  FINDING: <what the records show>",
    "  EVIDENCE: <the ORD-/PAY-/CUS- ids that support it>",
    "  AMOUNT_AT_STAKE_USD: <number, or 0>",
    "  RECOMMENDATION: <the single action you would take>",
    "",
    "Every factual claim must trace to a record you retrieved. If the records",
    "do not settle the item, say so — 'the records do not show X' is a",
    "finding. Do not infer a cause the data does not support, and do not",
    "soften a finding to be agreeable to the customer.",
  ].join("\n"),
  model: INVESTIGATOR_MODEL,
  tools: [T_GET_CUSTOMER, T_GET_ORDERS, T_GET_PAYMENTS],
};

const resolutionSynthesist: AgentDefinition = {
  description:
    "Merges investigator findings into one customer-facing resolution. Use only after every item has been investigated; it cannot look anything up itself.",
  prompt: [
    "You merge findings from several investigators into ONE resolution.",
    "",
    "You have no tools. Work only from the findings in your prompt. If they",
    "do not cover something, say 'not established by the investigation'",
    "rather than filling the gap from your own knowledge.",
    "",
    "Produce:",
    "  1. A four-sentence reply to the customer, plain and non-defensive.",
    "  2. A RESOLUTION TABLE with one row per item: item | finding | action |",
    "     amount. Every item that came in must appear, including the ones",
    "     where the answer is 'no action'. Dropping an item is the specific",
    "     failure this whole process exists to prevent.",
    "  3. A TOTAL AT STAKE line summing the amounts.",
    "",
    "Where two findings bear on the same order, reconcile them explicitly",
    "rather than listing both and leaving the contradiction to the reader.",
  ].join("\n"),
  model: COORDINATOR_MODEL,
  tools: [],
};

// Four concerns, deliberately tangled — no numbered list to read off, one
// buried in a subordinate clause, and a vague one at the end.
const CUSTOMER_EMAIL = [
  "Subject: this is getting ridiculous",
  "",
  "I've been a customer for two years and this month has been a mess. I was",
  "charged twice for the heat pump installation kit — two identical charges,",
  "same day — and although I sent that kit back weeks ago I still haven't",
  "seen a penny of it. On top of that the replacement sensor pack that turned",
  "up most recently was dead out of the box, which I'd like sorted too.",
  "Frankly at this point I'd just like to know whether my account is in good",
  "standing with you at all.",
  "",
  "Alex Mercer — alex.mercer@example.com",
].join("\n");

const COORDINATOR_PROMPT = [
  OPERATOR_FRAMING,
  "",
  "You are the coordinator for a customer support case. You cannot look",
  "anything up yourself — you have exactly one tool, and it spawns subagents.",
  "",
  "Work the case in three steps.",
  "",
  "1. DECOMPOSE. Read the customer email and list every DISTINCT concern in",
  "   it. They are not numbered and one of them is vague; that is the job.",
  "   Two sentences about the same charge are one concern, not two.",
  "",
  "2. INVESTIGATE IN PARALLEL. Establish the shared context first by",
  "   delegating one `case-investigator` to identify the customer from the",
  "   email address. Then emit ALL remaining `case-investigator` calls for",
  "   the other concerns in a SINGLE response — one per concern, several",
  "   Agent tool calls in the same assistant message, run_in_background",
  "   false. One concern per subagent; do not batch two into one.",
  "",
  "   Every one of those prompts MUST begin with the same shared header:",
  "     CASE: <case id>",
  "     CUSTOMER: <customer_id> (<verification status>)",
  "     CUSTOMER EMAIL, VERBATIM:",
  "     <the full email text>",
  "   ...followed by ITEM: <that subagent's one concern>.",
  "",
  "   A subagent inherits nothing from you or from its siblings. If the",
  "   customer id is not written into its prompt, it does not have it, and",
  "   it will waste a turn rediscovering what you already know.",
  "",
  "3. SYNTHESISE. Delegate once to `resolution-synthesist`. Its prompt must",
  "   contain the shared header and every investigator's report IN FULL and",
  "   verbatim, evidence ids intact. Do not summarise them first — you would",
  "   be discarding the evidence the resolution rests on.",
  "",
  "Then return the synthesist's resolution as your final answer.",
  "",
  "Do not issue refunds. There is no refund tool here; the deliverable is a",
  "proposed resolution, and a human decides.",
].join("\n");

async function main() {
  const reads: { tool: string; input: unknown }[] = [];
  const delegations: { tool: string; input: unknown }[] = [];

  const stream = query({
    prompt: `${COORDINATOR_PROMPT}\n\n════ CUSTOMER EMAIL ════\n${CUSTOMER_EMAIL}`,
    options: {
      model: COORDINATOR_MODEL,
      agents: {
        "case-investigator": caseInvestigator,
        "resolution-synthesist": resolutionSynthesist,
      },
      mcpServers: supportMcpServers,
      // The coordinator can delegate and nothing else. `tools: []` would
      // strip the Agent tool too and leave it unable to do anything at all.
      tools: ["Agent"],
      allowedTools: [
        "Agent",
        "Task",
        T_GET_CUSTOMER,
        T_GET_ORDERS,
        T_GET_PAYMENTS,
      ],
      permissionMode: "dontAsk",
      // SDK isolation. Without this the SDK loads the developer's own
      // ~/.claude and .claude/* settings, and the agent starts reasoning
      // about the machine it happens to be running on — an early run of this
      // example refused because the operator's real email did not match the
      // ticket. An example that behaves differently on your machine than on
      // mine is not an example.
      settingSources: [],

      forwardSubagentText: true,
      hooks: {
        PreToolUse: [auditTrail(reads), delegationTrail(delegations)],
        // Example 13's normaliser, reused. Four investigators reading three
        // services means four chances to misread a millisecond timestamp as
        // a second one; normalising once at the boundary removes all of them.
        PostToolUse: [normalizeReads()],
      },
    },
  });

  const resolution = await trace(stream, { showSubagentText: true });

  console.log("\n════════ resolution ════════\n");
  console.log(resolution);

  console.log(
    [
      "\nWhat to notice:",
      `  ${delegations.length} subagents ran and made ${reads.length} record lookups between them.`,
      "  Every one worked from the same shared header, so none had to re-derive",
      "  the customer id and none saw a sibling's answer. The repeated lookups",
      "  are the cost of that independence — the alternative is serialising the",
      "  investigation so findings can be passed along.",
      "",
      "  Scroll up to the delegate -> case-investigator lines. Consecutive ones",
      "  inside a single assistant message are what parallel actually looks",
      "  like here: one response emitting several Agent calls, not one call",
      "  per turn. Compare their prompt sizes too — they are nearly identical,",
      "  because the shared header is copied into each rather than inherited.",
      "",
      "  Then check the resolution table has a row for the vague fourth",
      "  concern ('is my account in good standing'). Decomposition is only",
      "  worth doing if the item that was easiest to drop survives to the end.",
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
