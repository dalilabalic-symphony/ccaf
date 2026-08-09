// Example 8 — Task Statement 1.2: iterative refinement.
//
// Example 6 ran research -> synthesis -> done. That is one pass, and one
// pass inherits whatever the first decomposition missed: if the coordinator
// carved the topic into three slices and the real answer needed a fourth,
// nothing in the pipeline ever notices. The synthesist can only work with
// what it was given, so a confidently-written brief with a hole in it is
// exactly what you get.
//
// The fix is a loop with a judge in it:
//
//     research -> synthesise -> CRITIQUE -> gaps? -> targeted re-research
//          ^                                              |
//          └──────────────────────────────────────────────┘
//
// Two design choices worth copying:
//
//   The critic is a separate subagent, not the coordinator marking its own
//     homework. It reads the draft with fresh context and no attachment to
//     the decomposition that produced it.
//   Round two is *targeted*, not a repeat. The critic names the missing
//     angle and which researcher owns it, so the second round is a few
//     precise queries rather than the whole fan-out again.
//
// A bounded loop matters as much as the loop: without a hard round cap, a
// critic can always find one more thing to want.

import "dotenv/config";
import { query, type AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { corpusServer } from "./shared/corpusTool.js";
import {
  researchTeam,
  coordinatorToolOptions,
  COORDINATOR_MODEL,
} from "./shared/researchTeam.js";
import { trace } from "./shared/trace.js";

// Like the synthesist, the critic has no tools. It cannot go and check the
// corpus itself, which is what keeps it a critic: its only job is to compare
// the draft against the quality bar and report the delta.
const coverageCritic: AgentDefinition = {
  description:
    "Audits a draft research brief for coverage gaps and returns targeted follow-up assignments. Use after a synthesis draft exists, before accepting it.",
  prompt: [
    "You audit a draft research brief. You do not write or improve it.",
    "",
    "You have no tools. Judge only what is in front of you.",
    "",
    "Look for: dimensions the brief asserts nothing about; claims carrying no",
    "[doc-NN] citation; places where the brief says something is unknown but the",
    "phrasing suggests nobody actually looked; and hedges that hide a gap.",
    "",
    "Reply in exactly this shape and nothing else:",
    "",
    "VERDICT: SUFFICIENT",
    "  (use when remaining gaps are genuinely unanswerable from any corpus)",
    "",
    "or",
    "",
    "VERDICT: GAPS",
    "GAP: <what is missing> | RESEARCHER: <cost-researcher|performance-researcher|policy-researcher> | QUERY: <specific search terms to try>",
    "GAP: ...",
    "",
    "List at most three gaps, the most decision-relevant first. A gap is worth",
    "listing only if closing it could change the brief's recommendation.",
  ].join("\n"),
  model: COORDINATOR_MODEL,
  tools: [],
};

const COORDINATOR_PROMPT = [
  "You coordinate a research team. You have no search tools — delegation is",
  "your only way to learn anything.",
  "",
  "Run this loop:",
  "1. Decompose the question into non-overlapping slices and dispatch the",
  "   researchers concurrently — all Agent calls in a SINGLE response, with",
  "   run_in_background false.",
  "2. Delegate to the synthesist. Its prompt must carry the researchers'",
  "   findings IN FULL and verbatim, [doc-NN] citations intact. It has no tools",
  "   and no memory of round one, so anything you leave out is simply gone.",
  "3. Delegate the draft to coverage-critic. Its prompt must contain the full",
  "   draft brief.",
  "4. If the critic returns VERDICT: GAPS, dispatch its QUERY lines to the",
  "   named researchers — again concurrently, in one response. Send only the",
  "   targeted queries; do not re-run the original assignments.",
  "5. Re-delegate to the synthesist with the round-one findings AND the new",
  "   findings, both verbatim, and ask for a revised brief.",
  "",
  "Hard limit: at most TWO critique rounds. After the second, accept the brief",
  "as it stands and state the gaps that remain unclosed. Do not loop further",
  "even if the critic still wants more — an unbounded critic never says stop.",
  "",
  "Announce each phase in one line as you enter it, e.g. 'Round 1: dispatching",
  "3 researchers' or 'Critic found 2 gaps; re-tasking policy-researcher'.",
  "",
  "Your final message is the accepted brief itself, followed by a short",
  "'Refinement log' listing what each round added.",
].join("\n");

async function main() {
  const stream = query({
    prompt:
      "Should a homeowner in a cold northern European climate retrofit their gas boiler to an air-source heat pump in 2026? Produce a decision brief.",
    options: {
      model: COORDINATOR_MODEL,
      systemPrompt: COORDINATOR_PROMPT,
      agents: { ...researchTeam, "coverage-critic": coverageCritic },
      mcpServers: { corpus: corpusServer },
      ...coordinatorToolOptions,
      forwardSubagentText: true,
    },
  });

  // The critic's verdict is worth surfacing on its own — it's the signal the
  // whole loop turns on, and in the raw trace it scrolls past like anything
  // else.
  const brief = await trace(stream, { showSubagentText: true });

  console.log("\n════════ ACCEPTED BRIEF ════════\n");
  console.log(brief);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
