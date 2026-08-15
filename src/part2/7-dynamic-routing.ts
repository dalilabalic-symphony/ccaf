// Example 7 — Task Statement 1.2: routing by query complexity.
//
// Example 6's coordinator ran the whole pipeline every time: three
// researchers, then a synthesist. That is the right shape for a broad
// research question and badly wrong for "what was the mean COP in the
// monitored study?" — a single lookup that pays for four subagent context
// windows, four model loads, and a synthesis step that has one input.
//
// A coordinator's job includes *deciding how much machinery a query needs*.
// Same roster as example 6, same tools; the only change is a system prompt
// that makes routing an explicit judgement with stated criteria.
//
// The script sends three queries of increasing breadth through the same
// coordinator and prints how many subagents each one actually spawned.

import "dotenv/config";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { corpusServer } from "../shared/corpusTool.js";
import {
  researchTeam,
  coordinatorToolOptions,
  COORDINATOR_MODEL,
} from "../shared/researchTeam.js";
import { trace, isAgentTool } from "../shared/trace.js";

// The routing criteria are stated as conditions to evaluate, not as a
// lookup table of query->pipeline. A table only covers the queries you
// thought of; criteria generalise to the ones you didn't.
const COORDINATOR_PROMPT = [
  "You coordinate a research team. You have no search tools of your own —",
  "delegation is your only way to learn anything.",
  "",
  "Before delegating, decide how much of the team the question actually needs.",
  "Spawning a subagent costs a full model context; spending three of them on a",
  "single-fact lookup is waste, not thoroughness.",
  "",
  "- One dimension, one fact: delegate to the single researcher that owns it",
  "  and answer directly from what comes back. Do NOT invoke the synthesist —",
  "  there is nothing to synthesise.",
  "- Two dimensions, or a comparison: delegate to just those researchers. Use",
  "  the synthesist only if their findings genuinely have to be reconciled.",
  "- Broad or open-ended: use the full team, then the synthesist.",
  "",
  "State your routing decision and the reason for it in one line before you",
  "make the calls.",
  "",
  "When you do delegate: dispatch a round's researchers in a SINGLE response",
  "with run_in_background false, give each a non-overlapping slice, and pass",
  "findings to the synthesist verbatim with their [doc-NN] citations intact.",
].join("\n");

async function route(label: string, prompt: string) {
  console.log(`\n──────── ${label} ────────`);
  console.log(`  query: ${prompt}\n`);

  let spawned = 0;
  const stream = query({
    prompt,
    options: {
      model: COORDINATOR_MODEL,
      systemPrompt: COORDINATOR_PROMPT,
      agents: researchTeam,
      mcpServers: { corpus: corpusServer },
      ...coordinatorToolOptions,
      forwardSubagentText: true,
    },
  });

  // Tee the stream so we can count delegations while `trace` prints it.
  async function* counted() {
    for await (const message of stream) {
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "tool_use" && isAgentTool(block.name)) spawned++;
        }
      }
      yield message;
    }
  }

  const answer = await trace(counted());
  console.log(`\n  >>> subagents spawned: ${spawned}`);
  console.log(`  >>> answer: ${answer.slice(0, 600)}`);
  return spawned;
}

async function main() {
  const narrow = await route(
    "Narrow — one fact, one dimension",
    "What was the mean seasonal coefficient of performance in the monitored installations, and how far down in temperature did units hold above 2.0?",
  );

  const medium = await route(
    "Medium — two dimensions to reconcile",
    "How do subsidy changes interact with payback periods for a heat pump retrofit?",
  );

  const broad = await route(
    "Broad — open-ended, needs the full team",
    "Should a homeowner in a cold northern European climate retrofit to an air-source heat pump in 2026? Produce a decision brief.",
  );

  console.log(
    [
      "\n════════ ROUTING SUMMARY ════════",
      `  narrow query -> ${narrow} subagent(s)`,
      `  medium query -> ${medium} subagent(s)`,
      `  broad  query -> ${broad} subagent(s)`,
      "",
      "  If those numbers are equal, the coordinator is not routing — it is",
      "  running a fixed pipeline and the criteria above aren't biting. That is",
      "  the failure mode this example exists to make visible: a coordinator",
      "  that always fans out is just an expensive way to call one agent.",
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
