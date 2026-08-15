# Part 3 — hooks and enforcement

Examples 10–13 share a mock support desk: four in-process MCP servers (CRM,
orders, billing, escalation) in `src/shared/supportTools.ts`, and every gate
in `src/shared/supportHooks.ts`.

A **hook** is a function the SDK runs at a fixed point in the tool-call
lifecycle. Two of the thirty-odd events carry this section:

| Event | Fires | Can |
|---|---|---|
| `PreToolUse` | after the model asks for a tool, before it runs | allow, rewrite the arguments, or **deny** |
| `PostToolUse` | after the tool returns, before the model reads it | **replace the result** |

## Running these examples

```bash
npm run gate       # 10-prerequisite-gate.ts
npm run decompose  # 11-parallel-investigation.ts
npm run handoff    # 12-escalation-handoff.ts
npm run normalize  # 13-normalize-posttooluse.ts
```

## Six mechanics worth knowing before you write one

| Mechanic | What to know |
|---|---|
| `matcher` is a regex | Unanchored, over the *fully-qualified* tool name. `mcp__(crm\|orders\|billing)__` scopes one hook across three servers. |
| MCP tool names are prefixed | `mcp__<server>__<tool>`. Keep them as constants — a gate that silently stops matching after a rename is the worst bug in this design. |
| `tool_response` is not an object | It's the MCP content array `[{ type: "text", text: "<json>" }]`. Unwrap and parse it. |
| A denial is a message to the model | `permissionDecisionReason` comes back as an error `tool_result`. It is the *only* thing the model learns about the refusal, so write it as an instruction ("do X instead"), not a complaint. |
| Replacing output | `hookSpecificOutput.updatedToolOutput`. Prefer it over `updatedMCPToolOutput`, which is MCP-only. |
| Hooks are just functions | So you can call one directly with a synthetic input and assert on the result — no model, no tokens. Example 10 does exactly this. |

**The environment leak, which will bite you.** The SDK injects a `# userEmail`
block naming the authenticated operator into every agent's context, and it is
**not suppressible** — it survives `settingSources: []`, a fully custom
`systemPrompt`, and a `CLAUDE_CODE_USER_EMAIL` override through `env`. Give a
support agent a ticket from `alex.mercer@example.com` and it will notice the
mismatch with your own address, decide it is being asked to act on a stranger's
account, and refuse the entire task. Worked around here with explicit framing
(`OPERATOR_FRAMING`). Worth knowing for any persona agent you build.

## What each one shows

### `npm run gate` — prompt guidance vs a prerequisite gate

The rule: never refund until `get_customer` has returned a **verified**
customer id. Two halves:

**Part 1** calls the hook directly — no model, no tokens:

```
ledger empty        -> DENY
ledger has CUS-4471 -> ALLOW
but CUS-9902        -> DENY
```

**Part 2** runs three live agents: no policy anywhere, policy in the prompt,
policy in a hook only.

An honest result, reported rather than tuned away: **Sonnet 5 calls
`get_customer` unprompted, essentially always.** Urgency, a forged "already
verified" note, and an explicit fast-track directive were each tried; it
declined all three. On this model, this step is not where your risk is.

That is exactly why Part 1 exists. "It didn't break when I tried" is evidence
about one model on one afternoon — it doesn't survive a model upgrade or a
prompt edit by someone who doesn't know why that paragraph is there, and you
cannot put a number on it. Part 1's assertion is a control: code, cheap, and
it fails loudly. Prompt guidance can only be evaluated by *sampling
behaviour*; programmatic enforcement can be evaluated by *reading it*.

The gate is also stricter than "did the agent call `get_customer`" — it is
written from the tool's **result**, so a lookup returning `pending_documents`
leaves the ledger empty and refunds blocked.

### `npm run decompose` — four concerns, four investigators, one resolution

A tangled complaint email: nothing numbered, one concern buried in a
subordinate clause, one deliberately vague. The coordinator decomposes it,
spawns one `case-investigator` per concern **in a single response**, then
hands every finding verbatim to a tool-less synthesist.

One agent definition, N instances — the decomposition decides how many run, so
a five-concern email needs no code change. Each delegation prompt carries the
same shared header (case id, customer id, the email verbatim), because a
subagent inherits nothing. Four ~80%-identical prompts is not waste; it is
what lets the four run at once.

Watch the resolution table for the vague fourth row. Decomposition is only
worth doing if the item that was easiest to drop survives to the end.

### `npm run handoff` — intercept, redirect, hand off

Two refunds are owed. $149.99 is under the cap and gets paid; $740 is over it
and gets stopped. Three hooks, one run:

```
[hook] allow process_refund — CUS-4471 verified earlier this run
[hook] DENY process_refund — $740.00 > $500 cap
[hook] allow process_refund — CUS-4471 verified earlier this run
[hook] allow process_refund — $149.99 within $500 cap
      [tool] billing.process_refund(CUS-4471, ORD-1003, $149.99) -> EXECUTED
[hook] allow escalate_to_human — handoff complete
```

Both gates run on the same call: passing one precondition doesn't pass the
others. The cap is **not in the agent's prompt at all** — it discovers the
rule by being stopped.

Interception is the easy half. The half that matters is that the denial names
the alternative workflow and its required fields, so the agent reroutes
instead of retrying or giving up. A hook that just says "denied" produces a
stuck agent.

At the other end, a third hook enforces the handoff contract, because the
human picking up the ticket **cannot see the conversation** — those four
fields are the whole case:

```
root_cause         : …two separate SETTLED payments exist for the same order:
                     PAY-77455 ($740, 2025-06-27T12:01:00Z) and PAY-77456
                     ($740, 2025-06-27T12:02:00Z), one minute apart…
recommended_action : Refund one of the two duplicate payments (e.g. PAY-77456)…
```

Note the ISO timestamps — billing stores Unix milliseconds. That's the next
example's hook feeding this one.

### `npm run normalize` — one hook, three incompatible services

The mock services disagree the way real ones do:

| Service | Timestamp | Status |
|---|---|---|
| `crm.get_customer` | ISO 8601 | string |
| `orders.get_orders` | Unix **seconds** | numeric code |
| `billing.get_payments` | Unix **milliseconds** | `SCREAMING_CASE` |

Seconds and milliseconds are both bare integers and nothing in the payload
says which. Same question, same (deliberately small) model, hook off vs on:

| Order | True date | Raw run said |
|---|---|---|
| ORD-1001 | 2025-05-27 | 2025-05-24 |
| ORD-1002 | 2025-06-27 | **2025-12-24** |
| ORD-1003 | 2025-07-28 | **2026-01-22** |

Every date wrong, one by six months — and none of them absurd. The events even
stayed in the right *order*, so the answer reads as coherent while being false
in every particular. That is worse than an obviously insane year: `2025-12-24`
is a date a reviewer signs off on. With the hook, all correct, and `status: 4`
resolved to `returned`.

The conversion is a pure function (`normalizeRecord`), so it is testable
without spending a token — and one regex matcher spans all three servers, so a
fourth service is one new entry, not a new paragraph in every prompt that
reads it.

## Notes

- Examples 10–12 run `claude-sonnet-5`; example 13 deliberately uses
  `claude-haiku-4-5`, because a normalisation hook that only helps a weak
  model is a crutch rather than infrastructure.
- **These cost real money.** Roughly, per run: example 10 ≈ $0.14 (three
  arms), example 11 ≈ $0.28, example 12 ≈ $0.05, example 13 ≈ $0.01. The
  no-API half of example 10's Part 1 costs nothing at all.
- Every "tool" in this repo is a hardcoded mock — `src/shared/supportTools.ts`
  for examples 10–13. No network calls, no extra credentials, and the same
  query returns the same records every time, so reruns differ only where the
  *model* made a different choice.
- Examples 10–13 pass `settingSources: []` so the agent doesn't inherit your
  `~/.claude` and `.claude/*` settings. Without it these scripts behave
  differently on your machine than on mine, which makes them useless as
  examples.
- Skills-to-code mappings for the certification task statements live in
  `notes/Task_1.4_Skills.md` and `notes/Task_1.5_Skills.md`.
