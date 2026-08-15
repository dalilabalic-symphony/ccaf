# Claude Agent Demos for CCA-F Topics

## Study guide references

`CCAF_Study_Plan.html` and `notes/Study_notes.md` are built from two separate
external PDFs, neither of which is checked into this repo:

- **Chapter references** (e.g. "Part I" theory chapters, "Part II" domain
  notes) point to
  [guide_en.pdf](https://github.com/paullarionov/claude-certified-architect/blob/main/pdf/guide_en.pdf) —
  the official exam guide extended with theory foundations.
- **Task and exercise references** point to the
  [official exam guide](https://everpath-course-content.s3-accelerate.amazonaws.com/instructor%2F6nizmqk8tpzpfjvt6qmmav7rh%2Fpublic%2F1783542750%2FClaude+Certified+Architect+%E2%80%93+Foundations+Exam+Guide.pdf) —
  "Claude Certified Architect – Foundations Exam Guide".

Eighteen small TypeScript scripts in four parts.

## Repo organization

Each part lives in its own folder under `src/`, with a dedicated `README.md`
covering that part's mental model, mechanics, and a walkthrough of every
example in it. `src/shared/` holds the mocks and helpers used across parts
(never real network calls — see each part's README for which files it uses).

| Part | Folder | Examples | Theme |
|---|---|---|---|
| 1 | [`src/part1/`](src/part1/README.md) | `1`–`4` | The same "what's the weather" question, implemented four ways — raw Messages API with no tools, a hand-rolled tool-use loop, the SDK's (beta) Tool Runner, and the full Claude Agent SDK (`query()`). Meant to be read in sequence and diffed against the previous file. |
| 2 | [`src/part2/`](src/part2/README.md) | `5`–`9` | Coordinator/subagent orchestration via the Agent SDK. `6`–`8` share one research team and one mock corpus — only the coordinator's strategy differs (fan-out vs dynamic routing vs critique-and-refine). `9` is the odd one out: session forking, not subagents. |
| 3 | [`src/part3/`](src/part3/README.md) | `10`–`13` | Hooks (`PreToolUse` / `PostToolUse`) as enforcement, built around a shared mock support desk. |
| 4 | [`src/part4/`](src/part4/README.md) | `14`–`18` | Structured extraction on the plain Messages API (no Agent SDK): tool-use JSON schemas, `tool_choice`, schema design, semantic validation and retry-with-feedback. Built around a mock accounts-payable document set. |

There is no app, server, or shared entry point — each `src/partN/N-*.ts` file
is independently runnable and self-contained except for `src/shared/`.

## Setup

```bash
npm install
cp .env.example .env
# then edit .env and set ANTHROPIC_API_KEY
```

If you've already run `ant auth login`, you can skip the `.env` file — the
SDK picks up that credential automatically.

## Running the examples

```bash
# Part 1 — one agent
npm run basic      # src/part1/1-basic-message.ts
npm run manual     # src/part1/2-manual-loop.ts
npm run runner     # src/part1/3-tool-runner.ts
npm run agent-sdk  # src/part1/4-agent-sdk.ts

# Part 2 — many agents
npm run context    # src/part2/5-subagent-context.ts
npm run fanout     # src/part2/6-coordinator-fanout.ts
npm run routing    # src/part2/7-dynamic-routing.ts
npm run refine     # src/part2/8-refinement-loop.ts
npm run fork       # src/part2/9-fork-session.ts

# Part 3 — hooks and enforcement
npm run gate       # src/part3/10-prerequisite-gate.ts
npm run decompose  # src/part3/11-parallel-investigation.ts
npm run handoff    # src/part3/12-escalation-handoff.ts
npm run normalize  # src/part3/13-normalize-posttooluse.ts

# Part 4 — structured extraction
npm run extract    # src/part4/14-tool-schema-extraction.ts
npm run choose     # src/part4/15-tool-choice.ts
npm run schema     # src/part4/16-schema-design.ts
npm run retry      # src/part4/17-validate-retry.ts
npm run feedback   # src/part4/18-feedback-loop.ts
```

For what each individual example demonstrates — the mechanic being taught,
known SDK gotchas, and real trace output — see that part's README, linked in
the table above.

## Notes

- Model choice is deliberate per part (Part 1 and Part 4 use
  `claude-haiku-4-5` throughout; Part 2 and Part 3 mostly use
  `claude-sonnet-5`, with specific exceptions). See each part's README for
  the reasoning and the `MODEL` constant to change it.
- **These cost real money** — every example calls the live Anthropic API.
  Don't loop a script repeatedly to "test" a change — run it once, read the
  trace. Per-run cost estimates are in each part's README.
- Every "tool" in this repo is a hardcoded mock (`src/shared/`). No network
  calls, no extra credentials, and the same query returns the same records
  every time, so reruns differ only where the *model* made a different
  choice.
- Examples 10–13 pass `settingSources: []` so the agent doesn't inherit your
  `~/.claude` and `.claude/*` settings. Without it these scripts behave
  differently on your machine than on mine, which makes them useless as
  examples.
- Skills-to-code mappings for the certification task statements live in
  `notes/` — `Task_1.4_Skills.md` and `Task_1.5_Skills.md` cover Part 3,
  `Task_4.3_Skills.md` and `Task_4.4_Skills.md` cover Part 4.
- **Output varies between runs.** These scripts steer the coordinator with a
  system prompt; they don't hard-code the orchestration. That's deliberate —
  it's the thing being demonstrated — but it means your trace won't match the
  transcripts in each part's README line for line.
- `npm run typecheck` runs `tsc --noEmit` over everything.
