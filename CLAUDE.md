# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A teaching repo of standalone, numbered TypeScript scripts demonstrating the Claude agent loop, starting
from a single Messages API call and growing in scope from there (multi-agent orchestration, hook-based
enforcement, and whatever gets added next). There is no app, server, or shared entry point — each
`src/partN/N-*.ts` file is independently runnable and self-contained except for the shared mocks/helpers
in `src/shared/`. Scripts are grouped by part into `src/part1/` … `src/part4/`.

**Read the root `README.md` and the relevant `src/partN/README.md` before making non-trivial changes.**
The root README covers repo-wide setup and organization; each part's own README documents, per example,
the exact mechanic being demonstrated, known SDK gotchas, and real trace output — that context doesn't
live in the code comments and shouldn't be re-derived from scratch.

## Commands

```bash
npm install
cp .env.example .env   # then set ANTHROPIC_API_KEY (skip if `ant auth login` is already done)

npm run typecheck      # tsc --noEmit over everything — no test suite exists
npm run <name>         # run one example; see package.json for the name -> src/partN/N-*.ts mapping
```

Every example calls the live Anthropic API and costs real money per run (see the cost estimates in the
Notes section of each part's `src/partN/README.md`). Don't loop a script repeatedly to "test" a change —
run it once, read the trace.

There is no linter and no test framework configured. Correctness is verified by running the script and
reading its console trace, not by assertions (the one exception is example 10 Part 1, which calls a hook
function directly with no model involved — see below).

## Architecture

### Parts, increasing in scope

Examples are grouped into numbered parts, each in its own folder (`src/part1/` … `src/part4/`) with its own
`README.md`, and each covering one theme and often sharing mocks/helpers across its examples. **When you
add a new part, append a row here**, create `src/partN/README.md` for it, and keep the root `README.md`
and `package.json` scripts in sync — those are the other two places a new example must be registered:

| Part | Folder | Examples | Theme | Shared files |
|---|---|---|---|---|
| 1 | `src/part1/` | `1`–`4` | The same "what's the weather" question, implemented four ways — raw Messages API with no tools, a hand-rolled tool-use loop, the SDK's (beta) Tool Runner, and the full Claude Agent SDK (`query()`). Meant to be read in sequence and diffed against the previous file. | `src/shared/weatherTool.ts` |
| 2 | `src/part2/` | `5`–`9` | Coordinator/subagent orchestration via the Agent SDK. `6`–`8` share one research team and one mock corpus — only the coordinator's strategy differs (fan-out vs dynamic routing vs critique-and-refine). `9` is the odd one out: session forking, not subagents. | `src/shared/researchTeam.ts`, `src/shared/corpus.ts` |
| 3 | `src/part3/` | `10`–`13` | Hooks (`PreToolUse` / `PostToolUse`) as enforcement, built around a shared mock support desk. | `src/shared/supportTools.ts`, `src/shared/supportHooks.ts` |
| 4 | `src/part4/` | `14`–`18` | Structured extraction on the plain Messages API (no Agent SDK): tool-use JSON schemas, `tool_choice`, schema design, semantic validation and retry-with-feedback. Built around a mock accounts-payable document set. | `src/shared/documents.ts`, `src/shared/extractionTools.ts` |
| *(next)* | | | | |

Don't rely on wording elsewhere in this file like "three parts" or a total example count — treat the
table above as the single source of truth for how many parts/examples currently exist.

### Key invariants to preserve when editing

- **Subagents inherit nothing.** A subagent's entire world is the `prompt` string passed to the `Agent`
  tool — not the user's message, not the coordinator's system prompt, not a sibling's output. If you add
  a subagent that needs some fact, that fact must be written into its delegation prompt.
- **Hub-and-spoke.** In Part 2, all communication crosses the coordinator; subagents never talk to each
  other directly. Preserve this when adding new coordination examples — it's what keeps a run observable
  and failures recoverable in one place.
- **`tools` vs `allowedTools`.** `options.tools` defines what tools exist at all for an agent (`tools: []`
  on a coordinator also removes its ability to spawn the `Agent` tool — use `tools: ["Agent"]` for a
  delegate-only coordinator). `allowedTools` controls what runs without a permission prompt. Both are
  usually needed together.
- **The `Agent` tool was called `Task` before Claude Code 2.1.63.** Coordinator examples list both names
  in `allowedTools` for compatibility.
- **MCP tool names are prefixed** `mcp__<server>__<tool>` (see `src/shared/supportTools.ts` and the hook
  matchers in `src/shared/supportHooks.ts`). Keep matcher regexes and tool-name constants in sync — a
  silently-broken hook matcher is the failure mode this design is most exposed to.
- **`tool_response` in a hook is the MCP content array** (`[{ type: "text", text: "<json>" }]`), not a
  plain object — unwrap and `JSON.parse` it.
- **Hooks are plain functions.** They can and should be unit-tested by calling them directly with a
  synthetic input, with no model/API call involved — see example `10`'s Part 1.
- **Mock data has intentionally inconsistent shapes across services** (`src/shared/supportTools.ts`):
  timestamps as ISO 8601 / Unix seconds / Unix milliseconds, and status as string / numeric code /
  SCREAMING_CASE, depending on the service. This is the point of example `13` — don't "fix" the
  inconsistency in the mocks, it's the fixture the normalization hook is built to handle.
- **All mocked tools are hardcoded**, not real network calls: `src/shared/weatherTool.ts` (examples 2–4),
  `src/shared/corpus.ts` (examples 5–9), `src/shared/supportTools.ts` (examples 10–13),
  `src/shared/documents.ts` (examples 14–18). Keep new examples consistent with this — no external
  calls, deterministic data.
- **Part 4's documents carry their ground truth** (`INVOICE_MISMATCHED_TRUTH`, `INVOICE_SPARSE_TRUTH`),
  and the examples grade themselves against it. Every hazard in those fixtures is deliberate — INV-8842's
  TOTAL DUE really does disagree with its own subtotal + VAT by 51.99, its PO really is missing, and
  R-2026-0451's `02.03.2026` / `1.240,00 €` really are locale traps. Don't "fix" a document; if you change
  one, change its `_TRUTH` in the same edit.
- **Part 4 examples are Messages API, not Agent SDK** (`@anthropic-ai/sdk`, like examples 1–3). They use
  raw JSON-schema tool definitions rather than Zod, because the schema itself is the subject being taught.
- **`required` ≠ non-nullable** in Part 4's schemas: fields stay in `required` (so the key is always
  present) and are typed `["string", "null"]` where a document may not contain them. Making an absent
  field non-nullable is what produces fabrication — that's the whole of example 16, so don't tidy it away.
- **Part 3 examples pass `settingSources: []`** so agents don't inherit `~/.claude` or `.claude/*` local
  settings, keeping behavior machine-independent. Preserve this on any new hook-based example.
- **Model choice is deliberate per part**: Part 1 uses `claude-haiku-4-5` (cheap, fast iteration). Part 2
  mixes `claude-sonnet-5` for coordinators/synthesis and `claude-haiku-4-5` for narrow retrieval subagents.
  Part 3 uses `claude-sonnet-5` except example `13`, which deliberately uses `claude-haiku-4-5` to prove
  the normalization hook helps a weak model, not just a strong one. Part 4 uses `claude-haiku-4-5`
  throughout, for the same reason — schema design shouldn't require buying a bigger model. The model is a
  `MODEL` constant near the top of each file.

### Skills-to-task mapping

`notes/Task_1.4_Skills.md`, `notes/Task_1.5_Skills.md`, `notes/Task_4.3_Skills.md` and
`notes/Task_4.4_Skills.md` map certification task statements to the code examples that demonstrate them.
Add one per task statement covered by a new part.
