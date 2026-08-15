// Example 5 — Task Statement 1.3: subagent invocation and context passing.
//
// The single most important fact about subagents, and the one that bites
// people: **a subagent does not inherit the coordinator's conversation.**
// The Agent tool's `prompt` string is the entire context it will ever see.
// Not the user's message, not the coordinator's system prompt, not what a
// sibling subagent found a moment ago. Just that string.
//
// This script proves it rather than asserting it. The same subagent is
// invoked twice against the same underlying question. The only difference
// is what the coordinator writes into the delegation prompt.
//
//   Run A — coordinator delegates the question only.
//   Run B — coordinator delegates the question *plus* the budget figure.
//
// Run A should come back MISSING_CONTEXT even though the user stated the
// budget one message earlier, because the subagent was never told.

import "dotenv/config";
import { query, type AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { trace } from "../shared/trace.js";

const COORDINATOR_MODEL = "claude-sonnet-5";

// An AgentDefinition is the programmatic equivalent of a `.claude/agents/*.md`
// file. `description` is what the coordinator reads when deciding whether to
// delegate here at all, so write it as routing guidance — "use this when..." —
// not as a summary of the agent's inner life.
const estimator: AgentDefinition = {
  description:
    "Judges whether a stated renovation budget is sufficient for a given home-energy retrofit. Use when the user asks whether they can afford something.",
  prompt: [
    "You are a blunt cost estimator for home heating retrofits.",
    "",
    "A typical air-source heat pump retrofit costs 12,000-18,000 EUR before subsidy.",
    "",
    "If the request you receive does NOT contain a specific budget figure, reply with",
    "exactly this and nothing else:",
    "  MISSING_CONTEXT: no budget was stated in the request I received.",
    "",
    "If it does contain a budget figure, reply with one sentence: the figure, and",
    "whether it clears the typical cost range.",
  ].join("\n"),
  // Per-agent model override. Subagents are usually narrower than the
  // coordinator, so a cheaper model is often the right call — and because
  // each subagent has its own context window, using a different model here
  // costs the coordinator nothing.
  model: "claude-haiku-4-5",
  // Per-agent tool restriction. This agent reasons from its own prompt and
  // needs no tools at all; handing it Bash would be pure risk surface.
  tools: [],
};

async function delegateOnce(label: string, instruction: string) {
  console.log(`\n──────── ${label} ────────`);

  const stream = query({
    prompt: instruction,
    options: {
      model: COORDINATOR_MODEL,
      agents: { estimator },
      // `tools` sets the coordinator's BASE set of built-in tools. This is
      // the step people miss: `tools: []` (as in example 4) disables every
      // built-in — including the Agent tool — and the coordinator then has
      // no way to spawn anything. To delegate and do nothing else, the base
      // set must be exactly the Agent tool.
      tools: ["Agent"],
      // `allowedTools` auto-approves, skipping the permission prompt a human
      // would otherwise answer. "Task" is the pre-2.1.63 name for the same
      // tool; listing both keeps this working across SDK versions.
      allowedTools: ["Agent", "Task"],
      permissionMode: "dontAsk",
      // Without this, only the subagent's tool_use/tool_result blocks are
      // forwarded to our stream. We want its actual answer text, so ask for
      // the full nested conversation.
      forwardSubagentText: true,
    },
  });

  await trace(stream, { showSubagentText: true });
}

async function main() {
  // Both runs state the budget to the COORDINATOR. Whether the subagent
  // ever learns it depends entirely on what the coordinator chooses to
  // write into the delegation prompt.
  const budgetContext =
    "My renovation budget is 8,000 EUR and I want an air-source heat pump.";

  await delegateOnce(
    "Run A — context withheld from the subagent",
    `${budgetContext}\n\nDelegate to the estimator subagent. Its prompt must be exactly the question "Is this budget enough for an air-source heat pump retrofit?" and must not contain any figure or any other detail from my message. Then report what it said.`,
  );

  await delegateOnce(
    "Run B — context passed explicitly",
    `${budgetContext}\n\nDelegate to the estimator subagent, and make sure its prompt states my budget figure explicitly. Then report what it said.`,
  );

  console.log(
    [
      "\nWhat to notice:",
      "  Run A's subagent reports MISSING_CONTEXT. The budget was in the",
      "  coordinator's conversation the whole time — that buys the subagent",
      "  nothing. Context reaches a subagent only by being written into the",
      "  Agent tool's `prompt` field.",
      "",
      "  Compare the two `prompt (N chars)` lines in the trace above: that",
      "  string is the subagent's entire world.",
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
