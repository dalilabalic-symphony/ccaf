// Example 9 — Task Statement 1.3: fork-based session management.
//
// Examples 5-8 used subagents, where the defining property is that context
// is *isolated*: a subagent starts empty and only ever knows what you wrote
// into the Agent tool's prompt. Forking is the opposite tool for the
// opposite job. A fork *inherits the entire conversation* up to the branch
// point, then diverges.
//
//   subagent  — empty context, you pass what it needs, results come back
//               to the coordinator. Use to parallelise *different work*.
//   fork      — full inherited history, no results come back anywhere.
//               Use to explore *divergent continuations of the same work*.
//
// So when you have an expensive shared baseline — a codebase analysis, a
// research corpus read, a long diagnostic session — and you want to try
// three different directions from it, forking means you pay for that
// baseline once instead of three times, and each branch starts from
// genuinely identical footing.
//
//                    ┌───────────────┐
//                    │   baseline    │  <- corpus analysis, paid for once
//                    └───┬───────┬───┘
//              fork ─────┘       └───── fork
//                  ▼                   ▼
//            branch A: "make          branch B: "make
//             the case FOR"            the case AGAINST"
//
// The mechanism is two options on `query()`, not a function call:
//   `resume: <sessionId>`   load that session's history
//   `forkSession: true`     ...into a NEW session, leaving the original
//                           untouched. Omit it and you continue the
//                           original in place, so two "branches" would
//                           just be two turns of one conversation and
//                           would contaminate each other.
//
// Step 4 below proves the isolation: it goes back to the baseline session
// and asks what it has been asked. Neither branch shows up.

import "dotenv/config";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { corpusServer, CORPUS_TOOL_NAME } from "./shared/corpusTool.js";
import { COORDINATOR_MODEL } from "./shared/researchTeam.js";

const ANALYST_PROMPT = [
  "You are a research analyst working from a document corpus.",
  "",
  "Cite every substantive claim with its source id in brackets, e.g. [doc-03].",
  "Never assert something the corpus does not support — say the corpus is",
  "silent on it instead.",
].join("\n");

// `tools: []` strips every built-in tool. Unlike a coordinator (which needs
// "Agent" to delegate), this agent only ever searches the corpus — and MCP
// tools are not gated by `tools`, so listing the corpus tool in
// `allowedTools` is enough to reach it.
const baseOptions: Options = {
  model: COORDINATOR_MODEL,
  systemPrompt: ANALYST_PROMPT,
  mcpServers: { corpus: corpusServer },
  tools: [],
  allowedTools: [CORPUS_TOOL_NAME],
  permissionMode: "dontAsk",
};

/** Runs one query to completion; returns its session id and final text. */
async function run(
  prompt: string,
  extra: Partial<Options> = {},
): Promise<{ sessionId: string; text: string; cost: number }> {
  const stream = query({ prompt, options: { ...baseOptions, ...extra } });

  let sessionId = "";
  let text = "";
  let cost = 0;

  for await (const message of stream) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          console.log(`      tool ${block.name} ${JSON.stringify(block.input)}`);
        }
      }
    } else if (message.type === "result") {
      sessionId = message.session_id;
      cost = message.total_cost_usd ?? 0;
      if (message.subtype === "success") text = message.result;
    }
  }

  return { sessionId, text, cost };
}

async function main() {
  // ── 1. The shared baseline ────────────────────────────────────────────
  // This is the expensive part: several corpus searches and a synthesis.
  // Everything downstream reuses it rather than repeating it.
  console.log("\n──────── 1. Baseline analysis (paid for once) ────────");
  const baseline = await run(
    "Research the evidence on retrofitting a gas boiler to an air-source heat pump: costs and payback, technical performance, and policy conditions. Give me a neutral factual summary — no recommendation yet.",
  );
  console.log(`\n  session: ${baseline.sessionId}  ($${baseline.cost.toFixed(4)})`);
  console.log(`  ${baseline.text.slice(0, 500)}…\n`);

  // ── 2 & 3. Two divergent branches from that identical footing ─────────
  // Both resume the SAME baseline session id. Because `forkSession` is set,
  // each gets a fresh session of its own and neither writes back to the
  // baseline — so the order they run in cannot matter.
  console.log("──────── 2. Fork A — argue FOR ────────");
  const forA = await run(
    "Now make the strongest honest case FOR retrofitting in 2026, using only the evidence you already gathered. Be explicit about which findings cut against you.",
    { resume: baseline.sessionId, forkSession: true },
  );
  console.log(`\n  session: ${forA.sessionId}  ($${forA.cost.toFixed(4)})`);
  console.log(`  ${forA.text.slice(0, 700)}…\n`);

  console.log("──────── 3. Fork B — argue AGAINST ────────");
  const against = await run(
    "Now make the strongest honest case AGAINST retrofitting in 2026, using only the evidence you already gathered. Be explicit about which findings cut against you.",
    { resume: baseline.sessionId, forkSession: true },
  );
  console.log(`\n  session: ${against.sessionId}  ($${against.cost.toFixed(4)})`);
  console.log(`  ${against.text.slice(0, 700)}…\n`);

  // Notice neither branch re-ran a corpus search: the retrieved documents
  // came along in the inherited history. A subagent would have had to be
  // handed all of it, verbatim, in its prompt (see example 6's coordinator)
  // or go and search again itself.

  // ── 4. Proof the baseline is untouched ────────────────────────────────
  // No `forkSession` here — this deliberately continues the ORIGINAL session
  // in place, which is exactly how you check what that session contains.
  console.log("──────── 4. Back to the baseline — what does it know? ────────");
  const check = await run(
    "Setting the research aside: list every task I have asked you to perform in this conversation, in order. Just the list.",
    { resume: baseline.sessionId },
  );
  console.log(`\n  session: ${check.sessionId}  ($${check.cost.toFixed(4)})`);
  console.log(`  ${check.text}\n`);

  console.log(
    [
      "════════ WHAT TO CHECK ════════",
      "",
      `  baseline  ${baseline.sessionId}`,
      `  fork A    ${forA.sessionId}   ${forA.sessionId !== baseline.sessionId ? "✓ new session" : "✗ SAME as baseline"}`,
      `  fork B    ${against.sessionId}   ${against.sessionId !== baseline.sessionId && against.sessionId !== forA.sessionId ? "✓ new session, distinct from fork A" : "✗ not distinct"}`,
      `  step 4    ${check.sessionId}   ${check.sessionId === baseline.sessionId ? "✓ continued the baseline in place (no forkSession)" : "✗ unexpectedly branched"}`,
      "",
      "  Step 4's answer should list ONLY the baseline research task. The two",
      "  branches ran against this same session id and left no trace in it —",
      "  that is what `forkSession: true` bought. Drop that one option and",
      "  the branches become consecutive turns of one conversation, each",
      "  arguing against what the previous one just said.",
      "",
      "  Both branches also answered without re-searching the corpus: a fork",
      "  inherits the history, so the retrieved documents were already there.",
      "  That is the whole economic argument for forking over re-running.",
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
