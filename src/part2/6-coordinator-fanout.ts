// Example 6 — Task Statement 1.2: hub-and-spoke coordination.
//
// One coordinator, four subagents, and a rule the topology enforces for you:
// no subagent talks to another. Researchers report to the coordinator; the
// coordinator decides what the synthesist gets to see.
//
//                        ┌──────────────┐
//                        │ coordinator  │  <- decomposes, routes, aggregates
//                        └──┬───┬───┬───┘
//              ┌────────────┘   │   └────────────┐
//         cost-researcher  performance-      policy-researcher
//                          researcher
//                                 │
//                            synthesist   <- no tools; sees only what the
//                                            coordinator hands it
//
// Three things the hub buys you, and they're the reason to prefer it over
// letting agents message each other freely:
//
//   Observability — every message crosses the coordinator, so a single
//     stream shows the whole run. That's the indented trace below.
//   Consistent error handling — a subagent that fails, fails *to* the
//     coordinator, which can retry or route around it in one place.
//   Controlled information flow — the synthesist gets exactly the findings
//     the coordinator passed on, so what it knew is auditable after the fact.
//
// The characteristic failure is on the decomposition side: slice the topic
// too narrowly and the union of the subagents' answers still has holes.
// Watch the 'Tensions and gaps' section of the final brief for that — and
// see example 8 for the loop that closes it.

import "dotenv/config";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { corpusServer } from "../shared/corpusTool.js";
import {
  researchTeam,
  coordinatorToolOptions,
  COORDINATOR_MODEL,
} from "../shared/researchTeam.js";
import { trace } from "../shared/trace.js";

// Note what this prompt does and doesn't do. It states the goal, the
// partitioning rule, and the quality bar — then stops. It does not script
// "step 1, call cost-researcher; step 2, call performance-researcher".
// Procedural scripts make a coordinator brittle: it can no longer adapt when
// a slice comes back thin, because you told it what to type rather than what
// to achieve.
const COORDINATOR_PROMPT = [
  "You coordinate a research team. You do not research anything yourself —",
  "you have no search tools, only the ability to delegate.",
  "",
  "How to run a research task:",
  "- Decompose the question into non-overlapping slices and give each slice to",
  "  the researcher that owns that dimension. Overlapping assignments waste",
  "  budget and return duplicate documents.",
  "- Dispatch researchers concurrently: emit all the Agent tool calls for a",
  "  round in a SINGLE response rather than one per turn. Set run_in_background",
  "  to false so their findings are back before you continue.",
  "- Then delegate to the synthesist. It has no tools and no memory of the",
  "  research, so its prompt must contain the researchers' findings IN FULL,",
  "  verbatim, including every [doc-NN] citation. Do not summarise them first —",
  "  summarising is the synthesist's job, and doing it yourself drops detail and",
  "  citations before they ever arrive.",
  "",
  "Quality bar: the brief must cover cost, performance and policy; every",
  "substantive claim must carry a [doc-NN] citation; disagreements between",
  "sources must be surfaced rather than averaged away.",
].join("\n");

async function main() {
  const stream = query({
    prompt:
      "Should a homeowner in a cold northern European climate retrofit their gas boiler to an air-source heat pump in 2026? Produce a decision brief.",
    options: {
      model: COORDINATOR_MODEL,
      systemPrompt: COORDINATOR_PROMPT,
      agents: researchTeam,
      // MCP tools are not gated by `tools` — they reach whichever subagents
      // list them in their own `tools` array. The coordinator never touches
      // the corpus itself.
      mcpServers: { corpus: corpusServer },
      ...coordinatorToolOptions,
      // Without this, only subagent tool_use/tool_result blocks reach our
      // stream (enough for a progress counter). We want the nested
      // conversation so the trace shows who did what.
      forwardSubagentText: true,
    },
  });

  const brief = await trace(stream);

  console.log("\n════════ FINAL BRIEF ════════\n");
  console.log(brief);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
