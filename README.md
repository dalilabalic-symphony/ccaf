# Claude Agent Loop Demo

Nine small TypeScript scripts in two parts.

**Examples 1–4** build up from a single Claude API call to a full agent loop,
so you can see exactly how the pieces fit together.

**Examples 5–9** go one level up, to *multi-agent* orchestration with the
Claude Agent SDK: a coordinator agent that decomposes work, delegates it to
subagents, and aggregates what comes back — plus session forking, the other
way to get parallelism out of one agent.

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
npm run basic      # 1-basic-message.ts
npm run manual     # 2-manual-loop.ts
npm run runner     # 3-tool-runner.ts
npm run agent-sdk  # 4-agent-sdk.ts

# Part 2 — many agents
npm run context    # 5-subagent-context.ts
npm run fanout     # 6-coordinator-fanout.ts
npm run routing    # 7-dynamic-routing.ts
npm run refine     # 8-refinement-loop.ts
npm run fork       # 9-fork-session.ts
```

## What each one shows

### `npm run basic` — one request, one response

The smallest possible call to the Messages API: send a message, print the
text back. No loop, no tools. This is the shape every other example builds
on.

### `npm run manual` — the agent loop, written by hand

This is the one to read closely. An "agent loop" is just this cycle,
repeated until the model stops asking for tools:

1. Send the conversation so far, plus the tools Claude is allowed to call.
2. Claude replies with a `stop_reason`:
   - `tool_use` — Claude wants to call one or more tools.
   - `end_turn` — Claude is done; this is the final answer.
3. If it's a tool call: run the tool yourself, append the result to the
   conversation as a `tool_result`, and go back to step 1.

The script logs `stop_reason` and every content block on every turn, so
you can watch the request → tool_use → tool_result → request cycle happen
in real time.

### `npm run runner` — the same thing via the SDK's Tool Runner

Same question, same mock tool, same result — but the loop itself is now
handled by the SDK's (beta) Tool Runner. You define the tool as a typed
function and hand the whole conversation to `toolRunner`; it calls the API,
detects tool calls, runs your function, and feeds the result back
automatically, looping until Claude is done.

Compare this file to `2-manual-loop.ts` line for line: it's the same
mechanism, just with the loop itself abstracted away. In real projects,
default to the Tool Runner — the manual loop is here purely so the
mechanics aren't a black box.

### `npm run agent-sdk` — the same thing again, via the Claude Agent SDK

A different package: `@anthropic-ai/claude-agent-sdk` (not `@anthropic-ai/sdk`
used in the other three scripts) — the SDK that Claude Code itself is built
on. Instead of making Messages API calls directly, `query()` spawns a whole
agent session (its own subprocess, permission system, and built-in tools
like Bash/Read/Write) and runs its *own* agent loop internally. This example
disables all the built-in tools (`tools: []`) and gives it exactly one
custom tool — the same mock `get_weather` — registered as an in-process MCP
server via `createSdkMcpServer()` + `tool()`, so it stays comparable to the
other two.

Use this one when you want an agent that can autonomously use a whole
toolbox (files, shell, MCP servers) with minimal orchestration code of your
own. Use the Messages API + Tool Runner (examples 1-3) when you want direct
control over a small, fixed set of tools and the request/response cycle
itself — e.g. building a feature inside an existing backend rather than a
standalone coding agent.

---

# Part 2 — coordinator and subagents

Examples 5–9 are all the Agent SDK. Examples 6–8 share one research team
(`src/shared/researchTeam.ts`) and one mock document corpus
(`src/shared/corpus.ts`), so the *only* thing that differs between them is
the coordinator's strategy. That's the point: how you design a subagent and
how you coordinate subagents are two separate decisions.

### The mental model

A coordinator is an agent whose tools are other agents. It decomposes a task,
delegates the pieces, and aggregates the results. The subagents run in
**isolated context** — separate conversation, separate context window,
separate model if you want one.

```
                     ┌──────────────┐
                     │ coordinator  │   decomposes · routes · aggregates
                     └──┬───┬───┬───┘
           ┌────────────┘   │   └────────────┐
      subagent A       subagent B       subagent C
   (own context)     (own context)    (own context)
```

Everything crosses the coordinator. Nothing goes sideways. That "hub and
spoke" constraint is what makes the system observable (one stream shows the
whole run), gives you one place to handle a subagent failure, and lets you
reason about what each agent actually knew.

### Four mechanics that trip people up

| Mechanic | What to know |
|---|---|
| The spawning tool is `"Agent"` | It was called `"Task"` before Claude Code 2.1.63, and older docs and exam material still say `Task`. These examples list **both** in `allowedTools` so they work either way. |
| `tools: []` also removes `Agent` | `options.tools` is the coordinator's *base set of built-in tools*. Example 4 uses `tools: []` to strip everything — do that on a coordinator and it can't delegate. Use `tools: ["Agent"]` for a coordinator that can delegate and nothing else. |
| `tools` ≠ `allowedTools` | `tools` decides what **exists**; `allowedTools` decides what runs **without a permission prompt**. You generally need both. |
| Subagents inherit nothing | Not the user's message, not the coordinator's system prompt, not a sibling's findings. The Agent tool's `prompt` string is the subagent's entire world. Example 5 proves it. |

Subagents are declared programmatically via `options.agents`, a map of name →
`AgentDefinition` (`description`, `prompt`, and optionally `model`, `tools`,
`maxTurns`, …). This is the in-code equivalent of a `.claude/agents/*.md`
file. Write the `description` as *routing guidance* — "use this when…" — since
that's what the coordinator reads when deciding whether to delegate at all.

### `npm run context` — subagents inherit nothing

The one that's worth running first. The same subagent is asked the same
question twice; the only difference is whether the coordinator copied the
user's budget figure into the delegation prompt.

```
Run A:  prompt (59 chars): Is this budget enough for an air-source heat pump retrofit?
        [estimator#1] MISSING_CONTEXT: no budget was stated in the request I received.

Run B:  prompt (545 chars): The user has a renovation budget of 8,000 EUR …
        [estimator#1] The stated budget of 8,000 EUR does not clear the typical
                      cost range of 12,000-18,000 EUR …
```

The budget was in the coordinator's conversation the whole time. That bought
the subagent nothing. Context reaches a subagent by being written into the
`prompt` field, or not at all.

Also shows per-agent `model` (a cheap model for a narrow job) and per-agent
`tools: []` (an agent that reasons and cannot act).

### `npm run fanout` — hub-and-spoke, in one pass

Three researchers with **non-overlapping** slices of one topic (cost,
performance, policy), dispatched concurrently, then a tool-less synthesist
that merges their findings.

Two things to watch in the trace:

- **Scope partitioning.** Point three agents at one undifferentiated topic
  and they retrieve the same documents three times — triple the cost, no
  extra coverage. Each researcher here owns a dimension and is told to stay
  in it.
- **Attribution across boundaries.** The corpus tool returns *structured*
  records (`id`, `title`, `url`, `text`), not prose. Because metadata is a
  field rather than a sentence, a `[doc-03]` citation survives being copied
  from researcher → coordinator → synthesist without being re-summarised
  into vagueness.

The synthesist deliberately has no tools, so it *cannot* quietly do its own
research — it can only use what the coordinator handed it. That makes the
information flow auditable after the fact.

Look at the brief's "Tensions and gaps" section when it finishes. One pass
inherits whatever the first decomposition missed, which is what example 8 is
about.

### `npm run routing` — don't run the full pipeline for a one-line question

Same team, same tools. The coordinator now decides *how much machinery a
query needs* before delegating, from stated criteria rather than a fixed
pipeline. Three queries of increasing breadth go through it:

```
narrow query -> 1 subagent(s)
medium query -> 3 subagent(s)
broad  query -> 4 subagent(s)
```

A coordinator that always fans out is an expensive way to call one agent.
The summary at the end flags it if the three numbers come back equal.

### `npm run refine` — closing the loop on coverage

Adds a `coverage-critic` subagent and turns the pipeline into a bounded loop:

```
research → synthesise → CRITIQUE → gaps? → targeted re-research
     ^                                            |
     └────────────────────────────────────────────┘
```

Three design choices worth stealing:

- **The critic is a separate agent**, not the coordinator marking its own
  homework. It reads the draft with fresh context and no attachment to the
  decomposition that produced it.
- **Round two is targeted, not a repeat.** The critic names the gap *and*
  which researcher owns it, so the follow-up is a few precise queries rather
  than a second full fan-out.
- **The loop is capped at two rounds.** An unbounded critic can always find
  one more thing to want.

A run of this is also where hub-and-spoke error handling shows up on its own.
In one run the `performance-researcher` refused a follow-up query as outside
its assigned scope — and because everything routes through the hub, the
coordinator saw the refusal and re-dispatched that query to
`policy-researcher` instead. In a mesh topology there'd be no single place
for that recovery to live.

### `npm run fork` — the other kind of parallelism

Everything above used subagents, whose defining property is that context is
*isolated*. Forking is the opposite tool for the opposite job: a fork
**inherits the entire conversation** up to the branch point, then diverges.

|  | Subagent | Fork |
|---|---|---|
| Starting context | Empty — only the Agent tool's `prompt` | The full parent history |
| Results | Return to the coordinator | Go nowhere; each branch is its own session |
| Costs you | A fresh context per agent | The shared baseline, paid once |
| Use it to | Parallelise **different work** | Explore **divergent continuations of the same work** |

The mechanism is two options on `query()`, not a function call — note that
the SDK also *exports* a lower-level `forkSession()` transcript utility,
which is not what you want here:

```ts
{ resume: baselineSessionId, forkSession: true }
```

`resume` alone continues the original session **in place**. Adding
`forkSession: true` loads that history into a *new* session and leaves the
original untouched. That one option is the whole difference between two
independent branches and two consecutive turns of one conversation, where
the second branch would be arguing against what the first just said.

The script builds an expensive baseline (a corpus analysis), forks it twice —
"argue FOR" and "argue AGAINST" — then returns to the baseline and asks what
it has been asked. A real run:

```
baseline  c6a080d6-…    8 corpus searches
fork A    55fec3ab-…    ✓ new session          0 searches
fork B    f79c17d7-…    ✓ distinct from fork A  0 searches
step 4    c6a080d6-…    ✓ continued baseline in place

step 4's answer:
  1. Research the evidence on retrofitting a gas boiler to an air-source heat pump…
  2. List every task asked in this conversation, in order (this current task).
```

Two things that answer proves. The baseline never learned that either branch
existed — so branch order can't matter. And neither branch re-ran a single
search: the retrieved documents came along in the inherited history. Doing
this with subagents would mean either handing each one all eight documents
verbatim in its prompt, or paying for the retrieval three times.

## Notes

- Examples 1–4 use `claude-haiku-4-5` — fast and cheap, good for repeatedly
  re-running while learning. Swap the `MODEL` constant at the top of each
  file to try a different model.
- Examples 5–9 run `claude-sonnet-5` for coordinators and synthesis (where
  judgement matters) and `claude-haiku-4-5` for researchers (where it's
  retrieve-and-report). Mixing models per agent costs the coordinator
  nothing, since each subagent has its own context window.
- **These cost real money.** Roughly, per run: example 5 ≈ $0.06, example 6
  ≈ $0.37, example 7 ≈ $0.27, example 8 ≈ $0.89, example 9 ≈ $0.16.
  Example 8 is the expensive one because it runs two research rounds plus
  two syntheses.
- Every "tool" in this repo is a hardcoded mock — `src/shared/weatherTool.ts`
  for examples 2–4, `src/shared/corpus.ts` for 5–9. No network calls, no
  extra credentials, and the same query returns the same documents every
  time, so reruns differ only where the *model* made a different choice.
- **Output varies between runs.** These scripts steer the coordinator with a
  system prompt; they don't hard-code the orchestration. That's deliberate —
  it's the thing being demonstrated — but it means your trace won't match the
  transcripts above line for line.
- `npm run typecheck` runs `tsc --noEmit` over everything.
