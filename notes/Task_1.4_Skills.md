# Task Statement 1.4 — Skills → code references

> Implement multi-step workflows with enforcement and handoff patterns.

Examples 10–12. The shared machinery is [supportTools.ts](../src/shared/supportTools.ts) (mock CRM / orders / billing / escalation, as four separate in-process MCP servers) and [supportHooks.ts](../src/shared/supportHooks.ts) (every gate).

---

## Knowledge of

### The difference between programmatic enforcement and prompt-based guidance

| What | Where |
|---|---|
| The claim stated up front — hooks are "code on the path between the model and the effect", prompts are guidance with an unmeasured failure rate | [supportHooks.ts:1-25](../src/shared/supportHooks.ts#L1-L25) |
| …and the counterweight, so this doesn't read as "hooks always": use a hook when a violation is *unacceptable* rather than merely unwanted; hooks can't weigh context, and a gate that overfires is its own outage | [supportHooks.ts:19-25](../src/shared/supportHooks.ts#L19-L25) |
| The same rule written both ways, side by side: `POLICY_PROMPT` (prose) vs `requireVerifiedCustomer` (a `Set` lookup) | [10-prerequisite-gate.ts:77-91](../src/10-prerequisite-gate.ts#L77-L91) vs [supportHooks.ts:175-198](../src/shared/supportHooks.ts#L175-L198) |
| `process_refund` itself validates **nothing** — every guarantee comes from a hook that runs before it, so a gate that fails to fire moves real money | [supportTools.ts:258-284](../src/shared/supportTools.ts#L258-L284) |
| Closing argument: state the policy in the prompt *and* enforce it in a hook. The prompt makes the agent route correctly on the first try; the hook means routing isn't what the guarantee rests on | [10-prerequisite-gate.ts:340-346](../src/10-prerequisite-gate.ts#L340-L346) |

### When deterministic compliance is required, prompt instructions alone have a non-zero failure rate

This is the one bullet the code can't simply assert, and example 10 is built around being honest about it.

| What | Where |
|---|---|
| **Part 1** — the gate invoked directly with a fabricated tool call: DENY on an empty ledger, ALLOW once the id is present, DENY for a different id. No model, no tokens, same answer every run | [10-prerequisite-gate.ts:174-248](../src/10-prerequisite-gate.ts#L174-L248) |
| The sharpest form of the argument, in one line: prompt guidance can only be evaluated by *sampling behaviour*; programmatic enforcement can be evaluated by *reading it* | [10-prerequisite-gate.ts:37-40](../src/10-prerequisite-gate.ts#L37-L40) |
| **Part 2** — three live arms: no policy / policy in prompt / policy in hook | [10-prerequisite-gate.ts:250-262](../src/10-prerequisite-gate.ts#L250-L262) |
| The honest empirical finding, recorded rather than tuned away: **Sonnet 5 calls `get_customer` unprompted, essentially always.** Urgency, a forged "already verified" note, and an explicit fast-track directive were each tried and each declined | [10-prerequisite-gate.ts:24-36](../src/10-prerequisite-gate.ts#L24-L36) |
| Why that finding *strengthens* the bullet rather than undermining it — "it didn't break when I tried" is evidence about one model on one afternoon; it does not survive a model upgrade or a prompt edit, and you cannot put a number on it | [10-prerequisite-gate.ts:31-36](../src/10-prerequisite-gate.ts#L31-L36) |
| The induced violation, labelled as induced (same device example 5 uses when it orders the coordinator to withhold the budget figure) | [10-prerequisite-gate.ts:93-105](../src/10-prerequisite-gate.ts#L93-L105) |
| Outcome test is `refundsIssued > 0 && verified.length === 0` — "money moved without the prerequisite", not "money moved". Alex Mercer's refund is legitimate; only the ordering is at issue | [10-prerequisite-gate.ts:279-282](../src/10-prerequisite-gate.ts#L279-L282) |

### Structured handoff protocols for mid-process escalation

| What | Where |
|---|---|
| The four required fields as a type: `customer_id`, `root_cause`, `refund_amount_usd`, `recommended_action` | [supportHooks.ts:250-255](../src/shared/supportHooks.ts#L250-L255) |
| The tool description states the constraint the fields exist for — "the human CANNOT see this conversation" | [supportTools.ts:286-303](../src/shared/supportTools.ts#L286-L303) |
| Why this is a *protocol* and not paperwork: those fields **are** the entire case | [supportHooks.ts:240-247](../src/shared/supportHooks.ts#L240-L247) |

---

## Skills in

### 1 · Programmatic prerequisites that block downstream tool calls until prerequisite steps complete

**Primary: [supportHooks.ts:119-205](../src/shared/supportHooks.ts#L119-L205)** — the exam's own example, near-literally: block `process_refund` until `get_customer` has returned a verified customer ID.

| What | Where |
|---|---|
| The ledger the gate remembers across two tool calls — created per run, so one conversation can't inherit another's verifications | [supportHooks.ts:133-147](../src/shared/supportHooks.ts#L133-L147) |
| **PostToolUse** writes the prerequisite, from the tool's *result* | [supportHooks.ts:150-173](../src/shared/supportHooks.ts#L150-L173) |
| **PreToolUse** reads it and denies | [supportHooks.ts:175-198](../src/shared/supportHooks.ts#L175-L198) |
| Both halves registered together | [supportHooks.ts:200-205](../src/shared/supportHooks.ts#L200-L205) |
| The subtlety worth stealing: the prerequisite is a **verified RESULT, not a completed call**. An agent can call `get_customer` and get back `pending_documents` — the ledger stays empty and refunds stay blocked | [supportHooks.ts:127-130](../src/shared/supportHooks.ts#L127-L130), data at [supportTools.ts:64-72](../src/shared/supportTools.ts#L64-L72) |
| Denial reason written as a recoverable instruction, not a complaint — "call `get_customer` first… if it comes back other than verified, do not retry" | [supportHooks.ts:181-188](../src/shared/supportHooks.ts#L181-L188) |
| Why: the reason string is the *only* thing the model learns about the refusal (it arrives as an error `tool_result`), so a dead-end denial produces a stuck agent | [supportHooks.ts:43-51](../src/shared/supportHooks.ts#L43-L51) |
| Two gates on one tool, running in order — `allow` from the verification gate immediately followed by `DENY` from the cap. Passing one precondition does not pass the others | [12-escalation-handoff.ts:111-122](../src/12-escalation-handoff.ts#L111-L122) |
| Ordering rationale: identity is checked before amount so an unverified caller is turned away for the *identity* reason, which teaches a different next step | [12-escalation-handoff.ts:112-117](../src/12-escalation-handoff.ts#L112-L117) |

### 2 · Decomposing multi-concern requests, investigating in parallel with shared context, then synthesising

**All of [11-parallel-investigation.ts](../src/11-parallel-investigation.ts).**

| What | Where |
|---|---|
| The shape, drawn | [11-parallel-investigation.ts:8-16](../src/11-parallel-investigation.ts#L8-L16) |
| A four-concern email with nothing numbered, one concern buried in a subordinate clause and one deliberately vague | [11-parallel-investigation.ts:116-128](../src/11-parallel-investigation.ts#L116-L128) |
| **Decompose** — step 1, including "two sentences about the same charge are one concern, not two" | [11-parallel-investigation.ts:134-139](../src/11-parallel-investigation.ts#L134-L139) |
| **In parallel** — all remaining Agent calls in a SINGLE response, one concern per subagent, `run_in_background` false | [11-parallel-investigation.ts:141-147](../src/11-parallel-investigation.ts#L141-L147) |
| **Shared context** — the mandated header (case id, customer id, verification status, email verbatim) that every delegation prompt must carry | [11-parallel-investigation.ts:149-160](../src/11-parallel-investigation.ts#L149-L160) |
| Why the header is copied rather than inherited: a subagent inherits nothing, so ~80% duplication between four prompts *is* the mechanism that lets them run at once | [11-parallel-investigation.ts:20-26](../src/11-parallel-investigation.ts#L20-L26) |
| **One definition, many instances** — `case-investigator` written for "whatever item you were handed", so a five-concern email needs no code change | [11-parallel-investigation.ts:28-31](../src/11-parallel-investigation.ts#L28-L31), [11-parallel-investigation.ts:58-87](../src/11-parallel-investigation.ts#L58-L87) |
| Scope discipline inside the subagent — "another investigator owns each of the others" | [11-parallel-investigation.ts:64-66](../src/11-parallel-investigation.ts#L64-L66) |
| **Synthesise** — findings passed IN FULL and verbatim, evidence ids intact | [11-parallel-investigation.ts:162-166](../src/11-parallel-investigation.ts#L162-L166) |
| The synthesist has no tools, so it can only use what it was handed | [11-parallel-investigation.ts:89-114](../src/11-parallel-investigation.ts#L89-L114) |
| The completeness bar: every item that came in must appear in the table, *including* the ones where the answer is "no action" | [11-parallel-investigation.ts:99-104](../src/11-parallel-investigation.ts#L99-L104) |
| Measured at runtime — subagent count vs record-lookup count, and the note that repeated lookups are the price of independence | [11-parallel-investigation.ts:218-228](../src/11-parallel-investigation.ts#L218-L228) |

An observed run decomposed into four concerns, spawned four investigators with ~1210-char near-identical prompts, handed the synthesist 5400 chars verbatim, and produced a table whose fourth row was the vague "is my account in good standing" — the item that was easiest to drop.

### 3 · Compiling structured handoff summaries when escalating to humans who lack the transcript

| What | Where |
|---|---|
| `handoffContract` — a PreToolUse hook that refuses an incomplete escalation *in time for the model to fix it, while the evidence is still in context* | [supportHooks.ts:257-288](../src/shared/supportHooks.ts#L257-L288) |
| `root_cause` must cite at least one `ORD-`/`PAY-`/`CUS-` id — a crude proxy for "you actually looked", chosen because a crude check that runs beats a sophisticated one in the prompt that might not | [supportHooks.ts:264-269](../src/shared/supportHooks.ts#L264-L269) |
| `recommended_action` must name a specific action, not restate the complaint | [supportHooks.ts:271-273](../src/shared/supportHooks.ts#L271-L273) |
| The denial lists exactly which fields were missing or inadequate | [supportHooks.ts:275-283](../src/shared/supportHooks.ts#L275-L283) |
| The handoff printed on its own at the end — read it as if it is all you have, because for the human it is | [12-escalation-handoff.ts:144-153](../src/12-escalation-handoff.ts#L144-L153) |

A handoff that cleared the contract on an observed run:

```
customer_id        : CUS-4471
refund_amount_usd  : $740.00
root_cause         : Customer Alex Mercer (CUS-4471) was double-charged for ORD-1002
                     (Heat pump installation kit, $740). Two separate SETTLED payments
                     exist for the same order: PAY-77455 ($740, 2025-06-27T12:01:00Z)
                     and PAY-77456 ($740, 2025-06-27T12:02:00Z), one minute apart…
recommended_action : Refund one of the two duplicate payments (e.g. PAY-77456, the
                     second/later charge) for $740 to CUS-4471, since this exceeds
                     the $500 agent refund cap.
```

Note the timestamps are ISO 8601 even though billing stores Unix milliseconds — that is Task 1.5's normaliser feeding this handoff. The two task statements meet here.

---

## One thing worth flagging

Example 10's Part 2 is steered by system prompts, so a given run can land differently than the transcripts above; Part 1 exists precisely because it cannot. If you only run one half, run Part 1 — it is free and it is the half that proves the mechanism.

The environment leak is also worth knowing before writing your own persona agent: the SDK injects a `# userEmail` block naming the authenticated operator into every agent's context, and it is **not** suppressible — it survives `settingSources: []`, a fully custom `systemPrompt`, and a `CLAUDE_CODE_USER_EMAIL` override via `env`. Left unhandled, the agent notices the ticket email doesn't match and refuses the whole task on identity grounds. Worked around by explicit framing at [supportTools.ts:41-71](../src/shared/supportTools.ts#L41-L71).
