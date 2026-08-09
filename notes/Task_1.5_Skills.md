# Task Statement 1.5 — Skills → code references

> Apply Agent SDK hooks for tool call interception and data normalization.

Examples 12–13, over the shared hooks in [supportHooks.ts](../src/shared/supportHooks.ts).

---

## The mechanics, verified against the installed SDK

Worth pinning down first, because the exam material describes hooks generically and the shapes matter. All of this was confirmed by running it, not read off the docs.

| Fact | Where |
|---|---|
| Registration shape — `hooks: { PreToolUse: [{ matcher, hooks: [fn] }] }` | [12-escalation-handoff.ts:110-124](../src/12-escalation-handoff.ts#L110-L124) |
| `matcher` is an **unanchored regex** over the fully-qualified tool name, so `mcp__(crm\|orders\|billing)__` scopes one hook across three servers | [supportHooks.ts:96-118](../src/shared/supportHooks.ts#L96-L118) |
| MCP tools arrive as `mcp__<server>__<tool>`, so tool names are exported as constants rather than spelled out at each call site — a gate that silently stops matching after a rename is the worst failure this code can have | [supportTools.ts:19-37](../src/shared/supportTools.ts#L19-L37) |
| A tool's `tool_response` is the MCP content array `[{ type: "text", text: "<json>" }]`, **not** an object — it has to be unwrapped and parsed | [supportHooks.ts:73-92](../src/shared/supportHooks.ts#L73-L92) |
| Deny shape — `hookSpecificOutput.permissionDecision: "deny"` + `permissionDecisionReason` | [supportHooks.ts:43-62](../src/shared/supportHooks.ts#L43-L62) |
| A denial comes back to the model as an **error `tool_result`** carrying your reason string — that string is the only thing the model learns about the refusal | [supportHooks.ts:45-51](../src/shared/supportHooks.ts#L45-L51) |
| Replace shape — `hookSpecificOutput.updatedToolOutput` (prefer it over `updatedMCPToolOutput`, which is MCP-only) | [supportHooks.ts:64-71](../src/shared/supportHooks.ts#L64-L71) |
| A hook is an ordinary async function, so it can be called directly with a synthetic input and no model at all | [10-prerequisite-gate.ts:174-218](../src/10-prerequisite-gate.ts#L174-L218) |

---

## Knowledge of

### PostToolUse hooks that intercept tool results for transformation before the model processes them

| What | Where |
|---|---|
| `normalizeReads` — one hook, one regex, three MCP servers | [supportHooks.ts:360-385](../src/shared/supportHooks.ts#L360-L385) |
| Fails **open**: an unparseable result is passed through untouched rather than mangled | [supportHooks.ts:369-375](../src/shared/supportHooks.ts#L369-L375) |

### Hooks that intercept outgoing tool calls to enforce compliance rules

| What | Where |
|---|---|
| `refundCapGate` — the exam's own example, blocking refunds above a threshold | [supportHooks.ts:217-238](../src/shared/supportHooks.ts#L217-L238) |
| The threshold as a named constant, not a magic number in a prompt | [supportTools.ts:38-39](../src/shared/supportTools.ts#L38-L39) |

### The distinction between hooks for deterministic guarantees and prompts for probabilistic compliance

| What | Where |
|---|---|
| Stated up front, including when *not* to reach for a hook | [supportHooks.ts:1-25](../src/shared/supportHooks.ts#L1-L25) |
| Example 12's system prompt deliberately omits both the cap and the handoff fields, so the agent discovers them by being stopped — proving the denial reason is load-bearing on its own | [12-escalation-handoff.ts:51-71](../src/12-escalation-handoff.ts#L51-L71) |
| …with the production caveat attached: you would normally state the policy in the prompt too, not for safety but so the agent routes correctly on the first try instead of spending a turn learning the rule | [12-escalation-handoff.ts:54-57](../src/12-escalation-handoff.ts#L54-L57) |
| The full-strength version of the distinction — a hook can be regression-tested in CI; the equivalent for a prompt is sampling the model and hoping the distribution holds | [10-prerequisite-gate.ts:240-247](../src/10-prerequisite-gate.ts#L240-L247) |

---

## Skills in

### 1 · PostToolUse hooks that normalise heterogeneous formats from different MCP tools

**Primary: [13-normalize-posttooluse.ts](../src/13-normalize-posttooluse.ts).** The exam names Unix timestamps, ISO 8601 and numeric status codes; the mock services were built to disagree on exactly those axes.

| What | Where |
|---|---|
| The disagreement, by design — CRM uses ISO 8601, orders uses Unix **seconds**, billing uses Unix **milliseconds**; statuses are a string, a numeric code, and SCREAMING_CASE | [supportTools.ts:1-16](../src/shared/supportTools.ts#L1-L16) |
| Four separate `createSdkMcpServer` calls, so the heterogeneity is genuinely cross-service rather than cosmetic | [supportTools.ts:311-342](../src/shared/supportTools.ts#L311-L342) |
| The numeric-status codebook the model is otherwise never given | [supportTools.ts:117-127](../src/shared/supportTools.ts#L117-L127) |
| The per-service conversions onto a common shape (`occurred_at_iso`, `status_label`) | [supportHooks.ts:303-347](../src/shared/supportHooks.ts#L303-L347) |
| ISO-8601 records get the canonical field restated anyway — the value of a canonical field is that it is on *every* record, including the ones needing no conversion | [supportHooks.ts:313-320](../src/shared/supportHooks.ts#L313-L320) |
| `normalizeRecord` exported as a pure function, so the conversion is testable without spending a token — half the argument for doing this in a hook rather than a prompt | [supportHooks.ts:349-358](../src/shared/supportHooks.ts#L349-L358) |
| …demonstrated with a no-API-call before/after at the top of the run | [13-normalize-posttooluse.ts:95-132](../src/13-normalize-posttooluse.ts#L95-L132) |
| The A/B: identical question, identical model, hook on vs off | [13-normalize-posttooluse.ts:68-93](../src/13-normalize-posttooluse.ts#L68-L93) |
| Run on **haiku on purpose** — if the hook only helps a weak model it is a crutch; if it removes a class of error regardless of model it is infrastructure | [13-normalize-posttooluse.ts:52-56](../src/13-normalize-posttooluse.ts#L52-L56) |
| Reused by examples 11 and 12, where four investigators reading three services would otherwise be four chances to misread a millisecond field | [11-parallel-investigation.ts:206-209](../src/11-parallel-investigation.ts#L206-L209) |

**The observed result is the reason this skill matters.** Ground truth and an actual raw-run answer, recorded at [13-normalize-posttooluse.ts:20-39](../src/13-normalize-posttooluse.ts#L20-L39):

| Order | True date | Run A said |
|---|---|---|
| ORD-1001 | 2025-05-27 | 2025-05-24 |
| ORD-1002 | 2025-06-27 | **2025-12-24** |
| ORD-1003 | 2025-07-28 | **2026-01-22** |

Every date wrong, one by six months — and none of them absurd. The events stayed in the correct *order*, so the answer reads as coherent while being false in every particular. That is worse than the year-57470 blowup you might expect from reading milliseconds as seconds: an insane date gets caught in review, `2025-12-24` gets signed off. Run B, same model, same question, got all of them right and decoded `status: 4` to `returned`.

### 2 · Interception hooks that block policy-violating actions and redirect to alternative workflows

**Primary: [12-escalation-handoff.ts](../src/12-escalation-handoff.ts).** The case is built so both halves must happen: ORD-1003 at $149.99 is under the cap and gets paid, ORD-1002 at $740 is over it and must be rerouted.

| What | Where |
|---|---|
| The block — `$740 > $500`, denied before the tool body runs | [supportHooks.ts:217-231](../src/shared/supportHooks.ts#L217-L231) |
| **The redirect** — the reason names `escalate_to_human` *and* lists the fields it needs | [supportHooks.ts:223-229](../src/shared/supportHooks.ts#L223-L229) |
| Why the redirect is the part that matters: a hook that returns "denied" and stops leaves a dead end, and a dead-ended agent either retries the identical call or abandons the task | [12-escalation-handoff.ts:16-21](../src/12-escalation-handoff.ts#L16-L21) |
| "This refund was NOT issued and retrying will fail again" — stated explicitly, because the model's next instinct is to retry | [supportHooks.ts:224-226](../src/shared/supportHooks.ts#L224-L226) |
| Three hooks with three different jobs on one run | [12-escalation-handoff.ts:10-14](../src/12-escalation-handoff.ts#L10-L14) |
| Outcome reporting computed from what actually happened rather than asserted | [12-escalation-handoff.ts:156-175](../src/12-escalation-handoff.ts#L156-L175) |

An observed run, showing both gates on the same call and the reroute:

```
[hook] allow process_refund — CUS-4471 verified earlier this run
[hook] DENY process_refund — $740.00 > $500 cap
[hook] allow process_refund — CUS-4471 verified earlier this run
[hook] allow process_refund — $149.99 within $500 cap
      [tool] billing.process_refund(CUS-4471, ORD-1003, $149.99) -> EXECUTED
[hook] allow escalate_to_human — handoff complete
      [tool] support.escalate_to_human(CUS-4471) -> QUEUED
```

One refund paid, one refused, split exactly on the $500 line — and the agent was never told that line exists.

### 3 · Choosing hooks over prompt-based enforcement when business rules require guaranteed compliance

| What | Where |
|---|---|
| The decision rule: hooks for violations that are *unacceptable* (money, identity, deletion, disclosure), prompts for everything else | [supportHooks.ts:19-25](../src/shared/supportHooks.ts#L19-L25) |
| Applied — a cap the model is never told about, enforced anyway | [12-escalation-handoff.ts:51-57](../src/12-escalation-handoff.ts#L51-L57) |
| Applied — the handoff contract, because "please include a root cause" in a prompt produces "customer is unhappy about a double charge" often enough to matter | [supportHooks.ts:240-288](../src/shared/supportHooks.ts#L240-L288) |
| The evidence, deterministic and free | [10-prerequisite-gate.ts:174-248](../src/10-prerequisite-gate.ts#L174-L248) |
| The honest counterweight: on Sonnet 5, the prompt-only arm of example 10 held every time it was tried. Hooks are not there because the model is careless — they are there because "careful" is a description of behaviour, not a control | [10-prerequisite-gate.ts:24-40](../src/10-prerequisite-gate.ts#L24-L40) |

---

## Observability, which is the quiet third use of hooks

Neither task statement asks for it, but it falls out of the same mechanism and is most of why hooks are pleasant in practice.

| What | Where |
|---|---|
| `auditTrail` — a no-op PreToolUse hook recording every attempt, *including the ones later hooks deny*, which a tool-result log cannot see | [supportHooks.ts:387-408](../src/shared/supportHooks.ts#L387-L408) |
| `delegationTrail` — the same thing for subagent spawns, accepting both `Agent` and the pre-2.1.63 `Task` | [supportHooks.ts:410-416](../src/shared/supportHooks.ts#L410-L416) |
| `refundWatcher` — measures *effects* rather than intentions, by watching for `REFUND_ISSUED` in the result. Example 10 needs this because its measurement cannot come from the gate it is trying to evaluate | [supportHooks.ts:418-432](../src/shared/supportHooks.ts#L418-L432) |
