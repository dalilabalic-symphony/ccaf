// The subagent roster shared by examples 6, 7 and 8.
//
// It is deliberately the same team in all three. What changes between those
// examples is only the *coordinator's* policy — fan out to everyone, route
// selectively, or loop until coverage is good enough. Holding the workers
// fixed makes it obvious that coordination strategy is a separate design
// decision from subagent design.

import type { AgentDefinition, Options } from "@anthropic-ai/claude-agent-sdk";
import { CORPUS_TOOL_NAME } from "./corpusTool.js";

export const COORDINATOR_MODEL = "claude-sonnet-5";
export const RESEARCHER_MODEL = "claude-haiku-4-5";

/**
 * Researchers are identical except for the slice they own. That is the
 * partitioning lever: three agents pointed at one undifferentiated topic
 * retrieve the same handful of documents three times, which costs triple
 * and adds nothing. Give each a dimension it owns and the union of their
 * findings is broader than any single context window could have held.
 */
function researcher(dimension: string, scope: string): AgentDefinition {
  return {
    // `description` is routing guidance — it is what the coordinator reads
    // when deciding whether this agent is the right one. Write it as "use
    // this when…", not as a description of the agent's inner life.
    description: `Researches the ${dimension} dimension of a topic and returns cited findings. Use when a question needs ${dimension} evidence.`,
    prompt: [
      `You research the ${dimension} dimension of a topic, and only that dimension.`,
      scope,
      "",
      "The corpus is small — two or three well-chosen searches exhaust it. If a",
      "search returns nothing useful, that is a finding about the corpus, not a",
      "reason to keep rephrasing the query.",
      "",
      "Report findings as a markdown list. Every bullet must end with its source",
      "id in brackets, e.g. [doc-03]. Never state a finding you cannot attribute",
      "to a retrieved document; if the corpus is silent on a point, say so rather",
      "than filling the gap from your own knowledge.",
      "",
      "Stay inside your assigned dimension even if you notice relevant material",
      "outside it. Another researcher owns that ground.",
    ].join("\n"),
    // Per-agent model override. Subagents are usually narrower than the
    // coordinator, so a cheaper model often suffices — and since each has
    // its own context window, mixing models costs the coordinator nothing.
    model: RESEARCHER_MODEL,
    // Per-agent tool restriction: retrieval and nothing else.
    tools: [CORPUS_TOOL_NAME],
  };
}

export const researchTeam: Record<string, AgentDefinition> = {
  "cost-researcher": researcher(
    "cost and economics",
    "That means purchase price, installation cost, payback periods, running costs, maintenance, and subsidies.",
  ),
  "performance-researcher": researcher(
    "technical performance",
    "That means efficiency figures, cold-weather behaviour, emitter and retrofit compatibility, and reliability.",
  ),
  "policy-researcher": researcher(
    "policy and market conditions",
    "That means regulation, grants, grid effects, installer workforce, siting rules, and consumer awareness.",
  ),

  // The synthesist has NO tools. It cannot search, so it cannot quietly
  // substitute its own retrieval for the researchers' work — it can only
  // work from what the coordinator wrote into its prompt. That constraint
  // is the point: it makes the information flow auditable.
  synthesist: {
    description:
      "Merges findings gathered by other researchers into one cited brief. Use only after research findings exist; it cannot search for itself.",
    prompt: [
      "You merge research findings supplied by other agents into a single brief.",
      "",
      "You have no search tools. Work only from the findings in your prompt. If",
      "they do not cover something, write 'not covered by the supplied findings'",
      "rather than answering from background knowledge.",
      "",
      "Carry every [doc-NN] citation from the source findings onto the claims it",
      "supports. Where two findings bear on the same point, say so explicitly.",
      "",
      "Structure: a 3-sentence bottom line, then sections for Cost, Performance",
      "and Policy, then a short 'Tensions and gaps' list.",
    ].join("\n"),
    model: COORDINATOR_MODEL,
    tools: [],
  },
};

/**
 * Options every coordinator in these examples needs.
 *
 * `tools` sets the coordinator's BASE set of built-in tools, and this is the
 * step people miss: `tools: []` (as in example 4) disables *every* built-in
 * — the Agent tool included — leaving the coordinator unable to spawn
 * anything. Setting it to exactly `["Agent"]` gives a coordinator that can
 * delegate and do literally nothing else, which is the property we want:
 * it cannot quietly do the research itself.
 *
 * `allowedTools` is a separate axis — it auto-approves, skipping the
 * permission prompt a human would otherwise answer. `"Task"` is the
 * pre-2.1.63 name for the same tool; listing both keeps these examples
 * working across SDK versions.
 */
export const coordinatorToolOptions: Pick<
  Options,
  "tools" | "allowedTools" | "permissionMode"
> = {
  tools: ["Agent"],
  allowedTools: ["Agent", "Task", CORPUS_TOOL_NAME],
  permissionMode: "dontAsk",
};
