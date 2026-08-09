# Task Statement 1.2 — Skills → code references

> Orchestrate multi-agent systems with coordinator-subagent patterns.

---

### 1 · Dynamically select subagents rather than always routing through the full pipeline

**Primary: [7-dynamic-routing.ts](../src/7-dynamic-routing.ts)**

| What | Where |
|---|---|
| The routing criteria themselves — one dimension → one researcher, no synthesist; two → those researchers; broad → full team | [7-dynamic-routing.ts:29-50](../src/7-dynamic-routing.ts#L29-L50) |
| Why they're written as *criteria*, not a query→pipeline lookup table | [7-dynamic-routing.ts:26-28](../src/7-dynamic-routing.ts#L26-L28) |
| Counting actual delegations by teeing the stream | [7-dynamic-routing.ts:69-84](../src/7-dynamic-routing.ts#L69-L84) |
| Three queries of increasing breadth + the summary that flags equal counts as the failure mode | [7-dynamic-routing.ts:87-115](../src/7-dynamic-routing.ts#L87-L115) |

**Contrast against:** [6-coordinator-fanout.ts](../src/6-coordinator-fanout.ts), which deliberately fans out every time. Same roster, same tools — only the system prompt differs.

**Also relevant:** the `description` field is what the coordinator actually reads when deciding to delegate, so it's written as routing guidance — [researchTeam.ts:24-27](../src/shared/researchTeam.ts#L24-L27), and the synthesist's "use only after findings exist" at [researchTeam.ts:72-73](../src/shared/researchTeam.ts#L72-L73).

---

### 2 · Partition research scope to minimise duplication

| What | Where |
|---|---|
| The `researcher()` factory — the whole partitioning lever, with the "three agents on one topic retrieve the same docs three times" rationale | [researchTeam.ts:15-51](../src/shared/researchTeam.ts#L15-L51) |
| "Stay inside your assigned dimension even if you notice relevant material outside it" | [researchTeam.ts:41-42](../src/shared/researchTeam.ts#L41-L42) |
| The three **distinct subtopics**: cost/economics, technical performance, policy/market | [researchTeam.ts:53-65](../src/shared/researchTeam.ts#L53-L65) |
| Coordinator instruction: non-overlapping slices, one per owning researcher | [6-coordinator-fanout.ts:53-55](../src/6-coordinator-fanout.ts#L53-L55) |
| The **source-type** axis (the slide's other partitioning example) — every doc tagged `news` / `academic` / `industry`, filterable | [corpus.ts:134-139](../src/shared/corpus.ts#L134-L139), exposed as a tool parameter at [corpusTool.ts:21-27](../src/shared/corpusTool.ts#L21-L27) |

---

### 3 · Iterative refinement loop until coverage is sufficient

**All of [8-refinement-loop.ts](../src/8-refinement-loop.ts).**

| What | Where |
|---|---|
| The loop shape, drawn | [8-refinement-loop.ts:12-14](../src/8-refinement-loop.ts#L12-L14) |
| `coverage-critic` — a *separate* agent, tool-less, so it can't research its way around a gap | [8-refinement-loop.ts:41-69](../src/8-refinement-loop.ts#L41-L69) |
| Its structured verdict format — `VERDICT: GAPS` + `GAP: … \| RESEARCHER: … \| QUERY: …`, which is what makes re-delegation *targeted* | [8-refinement-loop.ts:55-66](../src/8-refinement-loop.ts#L55-L66) |
| The coordinator's 5-step loop: research → synthesise → **critique** → re-delegate → **re-invoke synthesis** | [8-refinement-loop.ts:74-88](../src/8-refinement-loop.ts#L74-L88) |
| "Send only the targeted queries; do not re-run the original assignments" | [8-refinement-loop.ts:84-86](../src/8-refinement-loop.ts#L84-L86) |
| The round cap — an unbounded critic never says stop | [8-refinement-loop.ts:90-92](../src/8-refinement-loop.ts#L90-L92) |

The gap this closes is *created* in example 6 — see the note at [6-coordinator-fanout.ts:27-30](../src/6-coordinator-fanout.ts#L27-L30).

---

### 4 · Route all communication through the coordinator (observability, error handling, information flow)

| What | Where |
|---|---|
| The three-part rationale, spelled out | [6-coordinator-fanout.ts:17-25](../src/6-coordinator-fanout.ts#L17-L25) |
| **Observability** — the whole tracer exists for this; `parent_tool_use_id` is what attributes a message to a subagent | [trace.ts:1-8](../src/shared/trace.ts#L1-L8), [trace.ts:57-66](../src/shared/trace.ts#L57-L66) |
| Printing the delegation prompt, since that string *is* the subagent's entire world | [trace.ts:83-88](../src/shared/trace.ts#L83-L88) |
| `forwardSubagentText: true` — without it, only tool_use/tool_result surface | [6-coordinator-fanout.ts:83-86](../src/6-coordinator-fanout.ts#L83-L86) |
| **Controlled flow** — coordinator gets `tools: ["Agent"]` and nothing else, so it *cannot* research; `tools: []` would strip Agent too | [researchTeam.ts:92-114](../src/shared/researchTeam.ts#L92-L114) |
| The synthesist has no tools, so it can only use what the coordinator handed it — flow is auditable after the fact | [researchTeam.ts:67-70](../src/shared/researchTeam.ts#L67-L70) |
| Pass findings **verbatim**, citations intact — don't pre-summarise at the hub | [6-coordinator-fanout.ts:58-63](../src/6-coordinator-fanout.ts#L58-L63) |

**Error handling** is the one part that isn't a code path — it's emergent, and the README documents an observed instance: `performance-researcher` refused a follow-up as out of scope, the coordinator saw the refusal *because everything crosses the hub*, and re-dispatched to `policy-researcher`. Written up at [README.md:227-232](../README.md#L227-L232).

---

One thing worth flagging: bullets 1 and 3 are steered by system prompts, not hard-coded control flow. That's deliberate — the coordinator deciding is the thing being demonstrated — but it means a given run can route differently than the transcripts in the README. Run 7 twice and compare the spawn counts if you want to feel that.
