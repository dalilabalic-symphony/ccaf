// Example 12 — Task Statement 1.5 (intercept a policy-violating call and
// redirect it) meeting Task Statement 1.4 (the structured handoff at the
// other end of that redirect).
//
// The case is built so the agent must do both. Two refunds are owed:
//
//   ORD-1003   $149.99   under the cap  -> the agent pays it
//   ORD-1002   $740.00   over the cap   -> intercepted, must be escalated
//
// Three hooks, doing three different jobs, on the same run:
//
//   PreToolUse  process_refund      verified customer id, or deny   (1.4)
//   PreToolUse  process_refund      over $500, deny and redirect    (1.5)
//   PreToolUse  escalate_to_human   handoff complete, or deny       (1.4)
//
// The interception is the easy part. What makes it work is that the denial
// carries the alternative workflow with it. A hook that returns "denied" and
// stops leaves the model with a dead end, and a dead-ended agent either
// retries the identical call or abandons the task and tells the customer
// something vague. The reason string here names the tool to use instead and
// the fields it needs, so the block reroutes the work rather than killing it.
//
// Then the handoff contract. The human who picks up HND-3310 cannot see any
// of this conversation — not the tool results, not the reasoning, not the
// customer's email. Those four fields ARE the case. So they are enforced the
// same way the refund cap is: a PreToolUse hook that reads the payload and
// refuses an escalation that would arrive unactionable, in time for the
// model to fix it while it still has the evidence in context.

import "dotenv/config";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { trace } from "./shared/trace.js";
import {
  ALL_SUPPORT_TOOLS,
  OPERATOR_FRAMING,
  REFUND_CAP_USD,
  supportMcpServers,
} from "./shared/supportTools.js";
import {
  auditTrail,
  createLedger,
  handoffContract,
  normalizeReads,
  prerequisiteGate,
  refundCapGate,
  refundWatcher,
  type HandoffSummary,
} from "./shared/supportHooks.js";

const MODEL = "claude-sonnet-5";

// Note what this prompt does NOT say. There is no "refunds over $500 must be
// escalated" line, and no list of handoff fields. Both rules live in hooks,
// and the agent discovers them by being stopped. That is deliberate: it
// shows the denial reason is load-bearing on its own. In production you
// would usually state the policy in the prompt as well — not for safety,
// which the hook already provides, but so the agent routes correctly on the
// first try instead of spending a turn learning the rule.
const SYSTEM_PROMPT = [
  OPERATOR_FRAMING,
  "",
  "You are empowered to resolve billing complaints end to end.",
  "",
  "Establish who the customer is before touching their account. Then",
  "investigate with the order and payment records, and act: issue the refunds",
  "the evidence supports.",
  "",
  "If a tool call is refused, read the refusal carefully — it will tell you",
  "what to do instead. Follow that route rather than retrying the same call.",
  "",
  "Finish with a short plain-language summary for the customer of what you",
  "did and what happens next.",
].join("\n");

const USER_REQUEST = [
  "This is Alex Mercer, alex.mercer@example.com.",
  "",
  "Two problems. I was double-charged for the heat pump installation kit",
  "(ORD-1002) — I can see two identical charges on my statement — and the",
  "sensor pack on ORD-1003 arrived dead, which I want refunded.",
  "",
  "Please sort both out.",
].join("\n");

async function main() {
  const ledger = createLedger();
  const attempted: { tool: string; input: unknown }[] = [];
  const refunds = { issued: [] as unknown[] };
  const handoff: { summary?: HandoffSummary } = {};

  const gate = prerequisiteGate(ledger);

  const stream = query({
    prompt: USER_REQUEST,
    options: {
      model: MODEL,
      systemPrompt: SYSTEM_PROMPT,
      mcpServers: supportMcpServers,
      tools: [],
      allowedTools: ALL_SUPPORT_TOOLS,
      permissionMode: "dontAsk",
      // SDK isolation. Without this the SDK loads the developer's own
      // ~/.claude and .claude/* settings, and the agent starts reasoning
      // about the machine it happens to be running on — an early run of this
      // example refused because the operator's real email did not match the
      // ticket. An example that behaves differently on your machine than on
      // mine is not an example.
      settingSources: [],

      hooks: {
        PreToolUse: [
          auditTrail(attempted),
          // Order matters here, and not for the reason it looks like.
          // Both gates guard process_refund, so both run; the verification
          // gate is listed first so an unverified caller is turned away for
          // the identity reason rather than the amount reason. The two
          // denials teach the model different next steps, and getting the
          // wrong one costs a turn.
          ...gate.PreToolUse,
          refundCapGate(ledger),
          handoffContract(handoff),
        ],
        PostToolUse: [...gate.PostToolUse, refundWatcher(refunds), normalizeReads()],
      },
    },
  });

  const finalText = await trace(stream);

  console.log("\n════════ agent's closing message ════════\n");
  console.log(finalText);

  console.log("\n════════ what the hooks did ════════");
  console.log(`  tool calls attempted : ${attempted.length}`);
  console.log(
    `  refunds executed     : ${refunds.issued.length}` +
      (refunds.issued.length
        ? ` (${(refunds.issued as { amount_usd: number }[])
            .map((r) => `$${r.amount_usd.toFixed(2)}`)
            .join(", ")})`
        : ""),
  );
  console.log(`  refunds blocked      : ${ledger.blocked.length}`);
  for (const b of ledger.blocked) console.log(`    - ${b.reason}`);

  console.log("\n════════ the handoff the human receives ════════");
  if (handoff.summary) {
    const s = handoff.summary;
    console.log(`  customer_id        : ${s.customer_id}`);
    console.log(`  refund_amount_usd  : $${s.refund_amount_usd.toFixed(2)}`);
    console.log(`  root_cause         : ${s.root_cause}`);
    console.log(`  recommended_action : ${s.recommended_action}`);
  } else {
    console.log("  none — no escalation cleared the contract this run.");
  }

  const capBlocked = ledger.blocked.some((b) => b.reason.includes("over cap"));
  const smallPaid = (refunds.issued as { amount_usd: number }[]).some(
    (r) => r.amount_usd <= REFUND_CAP_USD,
  );

  console.log(
    [
      "\nWhat to notice:",
      capBlocked && smallPaid
        ? `  One refund was paid and one was refused, split exactly on the $${REFUND_CAP_USD}\n` +
          "  line — and the agent was never told that line exists. The policy is\n" +
          "  not in its prompt; it is a comparison in TypeScript that runs before\n" +
          "  the tool does."
        : capBlocked
          ? `  The $740 refund was refused at the $${REFUND_CAP_USD} cap, and the agent was never\n` +
            "  told that cap exists — the policy is not in its prompt, it is a\n" +
            "  comparison in TypeScript that runs before the tool does. (The small\n" +
            "  refund did not execute this run; the agent found its own reason to\n" +
            "  hold off, which is allowed — the gate only constrains the ceiling.)"
          : "  The cap gate did not fire this run — the agent never asked for more\n" +
            `  than $${REFUND_CAP_USD}. Nothing is broken; there was simply nothing to intercept.`,
      "",
      "  Follow the trace around the denial. The agent asks for $740, is",
      "  refused, and does NOT retry the same call — because the refusal named",
      "  escalate_to_human and listed the fields it needs. Interception without",
      "  a redirect produces a stuck agent; interception with one produces a",
      "  routed case.",
      "",
      "  Both refund gates fire on the same call, in order: you should see an",
      "  `allow` from the verification gate immediately followed by the cap's",
      "  `DENY`. Passing one precondition does not pass the others.",
      "",
      "  Now read the handoff block above as if it is all you have, because",
      "  for the human on the other end it is. No transcript, no tool results,",
      "  no email. Does root_cause name the payment ids? Does the recommended",
      "  action say what to actually do? The contract hook exists because",
      "  'please include a root cause' in a prompt produces 'customer is",
      "  unhappy about a double charge' often enough to matter.",
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
