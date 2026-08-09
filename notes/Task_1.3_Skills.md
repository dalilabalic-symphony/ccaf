# Task Statement 1.3 — Skills → code references

> Configure subagent invocation, context passing, and spawning.

---

### 1 · Include complete findings from prior agents directly in the subagent's prompt

**Foundation: [5-subagent-context.ts](../src/5-subagent-context.ts)** — the whole script exists to prove *why* this skill is necessary.

| What | Where |
|---|---|
| The claim, stated up front: the `prompt` string is the subagent's entire world | [5-subagent-context.ts:1-17](../src/5-subagent-context.ts#L1-L17) |
| Run A — coordinator told to withhold the figure → `MISSING_CONTEXT` | [5-subagent-context.ts:90-93](../src/5-subagent-context.ts#L90-L93) |
| Run B — coordinator told to state it explicitly → real answer | [5-subagent-context.ts:95-98](../src/5-subagent-context.ts#L95-L98) |
| The subagent's tripwire that makes the failure legible instead of silent | [5-subagent-context.ts:37-39](../src/5-subagent-context.ts#L37-L39) |

**The skill applied — passing research findings to the synthesis subagent:**

| What | Where |
|---|---|
| "its prompt must contain the researchers' findings **IN FULL**, verbatim, including every `[doc-NN]` citation. Do not summarise them first" | [6-coordinator-fanout.ts:58-63](../src/6-coordinator-fanout.ts#L58-L63) |
| Enforced from the receiving end: the synthesist has no tools and is told to write "not covered by the supplied findings" rather than backfill | [researchTeam.ts:76-79](../src/shared/researchTeam.ts#L76-L79) |
| Same rule in the routing coordinator | [7-dynamic-routing.ts:47-49](../src/7-dynamic-routing.ts#L47-L49) |
| The harder case — round *two* must carry round-one findings **and** the new findings, both verbatim, because the synthesist has no memory of round one | [8-refinement-loop.ts:78-88](../src/8-refinement-loop.ts#L78-L88) |
| The critic's prompt must likewise contain the full draft | [8-refinement-loop.ts:83-84](../src/8-refinement-loop.ts#L83-L84) |

**Made visible at runtime:** the tracer prints every delegation prompt with its character count — [trace.ts:83-88](../src/shared/trace.ts#L83-L88). That's what produces the `prompt (59 chars)` vs `prompt (545 chars)` contrast in example 5.

---

### 2 · Structured data formats separating content from metadata

| What | Where |
|---|---|
| The design rationale — why attribution lives in *fields*, not prose | [corpus.ts:11-14](../src/shared/corpus.ts#L11-L14) |
| The record type: `text` is content; `id` / `title` / `url` / `published` / `sourceType` are metadata | [corpus.ts:18-27](../src/shared/corpus.ts#L18-L27) |
| The tool returns JSON records, not a prose blob | [corpusTool.ts:31-33](../src/shared/corpusTool.ts#L31-L33) |
| The three-boundary survival argument spelled out: researcher → coordinator prompt → synthesist | [corpusTool.ts:4-8](../src/shared/corpusTool.ts#L4-L8) |
| Researchers required to attribute every bullet, never state an unattributable finding | [researchTeam.ts:36-39](../src/shared/researchTeam.ts#L36-L39) |
| Synthesist required to carry each `[doc-NN]` onto the claim it supports | [researchTeam.ts:81-82](../src/shared/researchTeam.ts#L81-L82) |
| Missing citations treated as an auditable defect by the critic | [8-refinement-loop.ts:52-53](../src/8-refinement-loop.ts#L52-L53) |
| The critic's own output is structured too — `GAP: … \| RESEARCHER: … \| QUERY: …` is parseable metadata, not advice in prose | [8-refinement-loop.ts:60-61](../src/8-refinement-loop.ts#L60-L61) |

---

### 3 · Spawn parallel subagents in a single coordinator response

| What | Where |
|---|---|
| "emit all the Agent tool calls for a round in a **SINGLE response** rather than one per turn. Set `run_in_background` to false" | [6-coordinator-fanout.ts:56-58](../src/6-coordinator-fanout.ts#L56-L58) |
| Same instruction in the routing coordinator | [7-dynamic-routing.ts:47-48](../src/7-dynamic-routing.ts#L47-L48) |
| Applied to **both** rounds of the refinement loop — including the targeted follow-ups | [8-refinement-loop.ts:75-77](../src/8-refinement-loop.ts#L75-L77) and [8-refinement-loop.ts:84-86](../src/8-refinement-loop.ts#L84-L86) |
| The prerequisite: `tools: ["Agent"]` plus both tool names in `allowedTools` — without the Agent tool there's no spawning at all | [researchTeam.ts:92-114](../src/shared/researchTeam.ts#L92-L114) |
| Same block, inline for the standalone example | [5-subagent-context.ts:62-72](../src/5-subagent-context.ts#L62-L72) |

To *see* it: [trace.ts:67-88](../src/shared/trace.ts#L67-L88) iterates the content blocks of a single assistant message, so consecutive `delegate ->` lines with no interleaved output are one response emitting several calls.

Note the exam slide says "Task tool calls" — in the installed SDK the tool is named `Agent`. Reconciled at [trace.ts:12-20](../src/shared/trace.ts#L12-L20), which accepts both names.

---

### 4 · Goal-and-quality-criteria prompts, not step-by-step procedure

| What | Where |
|---|---|
| The clearest statement — "It states the goal, the partitioning rule, and the quality bar — then stops… Procedural scripts make a coordinator brittle" | [6-coordinator-fanout.ts:42-47](../src/6-coordinator-fanout.ts#L42-L47) |
| The explicit **quality bar** (must cover three dimensions; every claim cited; disagreements surfaced, not averaged away) | [6-coordinator-fanout.ts:65-67](../src/6-coordinator-fanout.ts#L65-L67) |
| Routing stated as *conditions to evaluate*, with the reason a lookup table fails: "a table only covers the queries you thought of" | [7-dynamic-routing.ts:26-28](../src/7-dynamic-routing.ts#L26-L28) |
| Subagent-side adaptability — "two or three well-chosen searches exhaust it… a search returning nothing is a finding about the corpus, not a reason to keep rephrasing" (a judgement to make, not a step count) | [researchTeam.ts:32-34](../src/shared/researchTeam.ts#L32-L34) |
| Critic given a *bar*, not a checklist: "a gap is worth listing only if closing it could change the recommendation" | [8-refinement-loop.ts:63-66](../src/8-refinement-loop.ts#L63-L66) |

The honest counter-example is worth reading alongside these: [8-refinement-loop.ts:74-88](../src/8-refinement-loop.ts#L74-L88) *is* a numbered procedure. That's a deliberate trade — the loop structure is the mechanism under demonstration, so it's pinned, while the judgement inside each step (how to slice, what counts as a gap, when to stop) stays with the model. Prompts in practice sit on that spectrum rather than at one end.
