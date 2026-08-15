// Example 18 — Task Statement 4.4: designing the extraction so a feedback
// loop is possible at all.
//
// Everything else in Part 4 improves one extraction. This one is about the
// hundredth: a code-review agent has been running for six months, developers
// have been dismissing some of its findings, and the question is what your
// system does with that.
//
// The answer depends entirely on a schema decision made before any of it
// ran. A finding has three natural identifiers and two of them are useless
// for counting:
//
//   title    prose. Worded differently every run, so "Math.random is not
//            cryptographically secure" and "Insecure random identifier" are
//            two rows in your dismissal table describing one problem.
//   file:line  moves with the next commit.
//   detected_pattern  a stable snake_case key for the CODE CONSTRUCT that
//            triggered the finding. Survives rewording and refactoring.
//
// With the third field, "which of our rules keeps producing findings nobody
// acts on" is a GROUP BY. Without it, it is a research project.
//
// The loop, end to end:
//
//   extract findings (with detected_pattern)
//        -> developers accept or dismiss
//        -> aggregate dismissals BY PATTERN
//        -> suppress or downgrade the patterns that keep losing
//        -> next run is quieter, and quieter for a stated reason

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { CODE_UNDER_REVIEW, DISMISSAL_HISTORY } from "../shared/documents.js";
import {
  FINDINGS_TOOL,
  T_REPORT_FINDINGS,
  type Finding,
  firstToolUse,
} from "../shared/extractionTools.js";

const MODEL = "claude-haiku-4-5";

/** Above this dismissal rate, with enough samples, a pattern is noise. */
const NOISE_THRESHOLD = 0.75;
const MIN_SAMPLES = 8;

type PatternStat = {
  detected_pattern: string;
  raised: number;
  dismissed: number;
  rate: number;
  verdict: "noise" | "useful" | "insufficient data";
};

// ── Part 1: the aggregation, no model involved ───────────────────────────

function analysePatterns(): PatternStat[] {
  return DISMISSAL_HISTORY.map((p) => {
    const rate = p.dismissed / p.raised;
    const verdict: PatternStat["verdict"] =
      p.raised < MIN_SAMPLES
        ? "insufficient data"
        : rate >= NOISE_THRESHOLD
          ? "noise"
          : "useful";
    return { ...p, rate, verdict };
  }).sort((a, b) => b.rate - a.rate);
}

function partOne(): PatternStat[] {
  console.log("════════ Part 1 — six months of outcomes, no model ════════\n");

  const stats = analysePatterns();
  console.log(
    `  ${"pattern".padEnd(30)} ${"raised".padStart(6)} ${"dismissed".padStart(10)} ${"rate".padStart(6)}  verdict`,
  );
  for (const s of stats) {
    console.log(
      `  ${s.detected_pattern.padEnd(30)} ${String(s.raised).padStart(6)} ${String(s.dismissed).padStart(10)} ${(s.rate * 100).toFixed(0).padStart(5)}%  ${s.verdict}`,
    );
  }

  console.log(
    [
      "",
      "  Two patterns are being dismissed nine times in ten. That is not a",
      "  model problem and it is not a developer problem — the findings are",
      "  technically correct and locally wrong, which is what a false positive",
      "  usually is. `Math.random` really is not a CSPRNG; it is also not being",
      "  used as one here.",
      "",
      "  This table is ordinary code over ordinary data. The only reason it can",
      "  exist is that every finding carried a stable `detected_pattern` key.",
      "  Group by title and these six rows become forty; group by file and they",
      "  reset at the next refactor.",
    ].join("\n"),
  );

  return stats;
}

// ── Part 2: extract findings, with the key attached ──────────────────────

async function partTwo(client: Anthropic): Promise<Finding[]> {
  console.log("\n\n════════ Part 2 — review the code ════════\n");
  console.log("  " + CODE_UNDER_REVIEW.split("\n").join("\n  "));

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    tools: [FINDINGS_TOOL],
    // Forced: the review step's job is to produce records. A prose answer
    // here would be a pipeline outage, exactly as in example 15.
    tool_choice: { type: "tool", name: T_REPORT_FINDINGS },
    messages: [
      {
        role: "user",
        content: [
          "Review this TypeScript file and report every issue you find.",
          "",
          "Read the comments — they describe intent, and a finding that",
          "contradicts a stated intent should say so in its rationale.",
          "",
          CODE_UNDER_REVIEW,
        ].join("\n"),
      },
    ],
  });

  const findings =
    ((firstToolUse(response)?.input as { findings?: Finding[] })?.findings ?? []);

  console.log(`\n  ${findings.length} finding(s):\n`);
  for (const f of findings) {
    console.log(`    [${f.severity}] ${f.title}`);
    console.log(`      symbol  : ${f.symbol}`);
    console.log(`      pattern : ${f.detected_pattern}`);
  }

  return findings;
}

// ── Part 3: close the loop ───────────────────────────────────────────────

function partThree(findings: Finding[], stats: PatternStat[]) {
  console.log("\n\n════════ Part 3 — triage this run against history ════════\n");

  const byPattern = new Map(stats.map((s) => [s.detected_pattern, s]));

  let suppressed = 0;
  let shown = 0;
  let unknown = 0;

  for (const f of findings) {
    const stat = byPattern.get(f.detected_pattern);

    if (!stat) {
      unknown++;
      shown++;
      console.log(`  SHOW      ${f.detected_pattern.padEnd(30)} no history yet`);
      continue;
    }

    if (stat.verdict === "noise") {
      suppressed++;
      console.log(
        `  SUPPRESS  ${f.detected_pattern.padEnd(30)} dismissed ${stat.dismissed}/${stat.raised} previously`,
      );
      continue;
    }

    shown++;
    console.log(
      `  SHOW      ${f.detected_pattern.padEnd(30)} ${stat.verdict}, ${(stat.rate * 100).toFixed(0)}% dismissed`,
    );
  }

  console.log(
    [
      "",
      `  ${shown} shown, ${suppressed} suppressed, ${unknown} pattern(s) never seen before.`,
      "",
      "What to notice:",
      "",
      "  1. The suppression decision is made in code, from counted outcomes,",
      "     against a threshold you can argue about — not by editing the",
      "     review prompt until the annoying findings stop appearing. Prompt",
      "     edits are untraceable and they suppress by WORDING, so the same",
      "     finding returns the moment the model phrases it differently.",
      "",
      "  2. An unseen pattern is shown, not suppressed. A new key means the",
      "     model found something the taxonomy has no evidence about, and the",
      "     default for no evidence is to let a human look. This is the same",
      "     shape as `other` in example 16's enum: the open-ended member is",
      "     what stops new things being quietly relabelled as old ones.",
      "",
      "  3. Suppression is not the only move, and it is the crudest. The same",
      "     table supports downgrading severity, routing a pattern to one",
      "     reviewer who does care, or — best — rewriting the rule: the",
      "     `math_random_for_identifier` findings are dismissed because the",
      "     construct is fine for non-security identifiers, so the rule should",
      "     ask what the value is USED for rather than firing on the call.",
      "     The dismissal data is what tells you that; the pattern key is what",
      "     makes the dismissal data addable up.",
      "",
      "  4. Nothing here is a measurement of the model. It is a measurement of",
      "     one rule's fit to one codebase, and that is why it belongs in a",
      "     data store rather than in a prompt.",
    ].join("\n"),
  );
}

async function main() {
  const stats = partOne();

  const client = new Anthropic();
  const findings = await partTwo(client);

  partThree(findings, stats);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
