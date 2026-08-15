# Part 2 — coordinator and subagents

Examples 5–9 are all the Agent SDK. Examples 6–8 share one research team
(`src/shared/researchTeam.ts`) and one mock document corpus
(`src/shared/corpus.ts`), so the *only* thing that differs between them is
the coordinator's strategy. That's the point: how you design a subagent and
how you coordinate subagents are two separate decisions.

## Running these examples

```bash
npm run context    # 5-subagent-context.ts
npm run fanout     # 6-coordinator-fanout.ts
npm run routing    # 7-dynamic-routing.ts
npm run refine     # 8-refinement-loop.ts
npm run fork       # 9-fork-session.ts
```

## The mental model

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

## Four mechanics that trip people up

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

## What each one shows

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

- Examples 5–9 run `claude-sonnet-5` for coordinators and synthesis (where
  judgement matters) and `claude-haiku-4-5` for researchers (where it's
  retrieve-and-report). Mixing models per agent costs the coordinator
  nothing, since each subagent has its own context window.
- **These cost real money.** Roughly, per run: example 5 ≈ $0.06, example 6
  ≈ $0.37, example 7 ≈ $0.27, example 8 ≈ $0.89, example 9 ≈ $0.16. Example 8
  is the expensive one because it runs two research rounds plus two
  syntheses.
- Every "tool" in this repo is a hardcoded mock — `src/shared/corpus.ts` for
  examples 5–9. No network calls, no extra credentials, and the same query
  returns the same records every time, so reruns differ only where the
  *model* made a different choice.
