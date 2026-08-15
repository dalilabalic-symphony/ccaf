# Claude Agent Demos for CCA-F Topics

Eighteen small TypeScript scripts in four parts.

**Examples 1–4** build up from a single Claude API call to a full agent loop,
so you can see exactly how the pieces fit together.

**Examples 5–9** go one level up, to *multi-agent* orchestration with the
Claude Agent SDK: a coordinator agent that decomposes work, delegates it to
subagents, and aggregates what comes back — plus session forking, the other
way to get parallelism out of one agent.

**Examples 10–13** are about *enforcement*: hooks that intercept tool calls
before they run and tool results before the model reads them. This is where
"the agent should never do X" stops being a sentence in a prompt and becomes
a line of TypeScript.

**Examples 14–18** are about *structured extraction*: getting data out of a
document and into a typed object you can trust. Back to the plain Messages
API, and to one question — a tool schema guarantees the SHAPE of what comes
back, so what guarantees it is true?

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

# Part 3 — hooks and enforcement
npm run gate       # 10-prerequisite-gate.ts
npm run decompose  # 11-parallel-investigation.ts
npm run handoff    # 12-escalation-handoff.ts
npm run normalize  # 13-normalize-posttooluse.ts

# Part 4 — structured extraction
npm run extract    # 14-tool-schema-extraction.ts
npm run choose     # 15-tool-choice.ts
npm run schema     # 16-schema-design.ts
npm run retry      # 17-validate-retry.ts
npm run feedback   # 18-feedback-loop.ts
```

## What each one shows

# Part 1 — Basic Agent Loop examples

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

---

# Part 3 — hooks and enforcement

Examples 10–13 share a mock support desk: four in-process MCP servers (CRM,
orders, billing, escalation) in `src/shared/supportTools.ts`, and every gate
in `src/shared/supportHooks.ts`.

A **hook** is a function the SDK runs at a fixed point in the tool-call
lifecycle. Two of the thirty-odd events carry this section:

| Event | Fires | Can |
|---|---|---|
| `PreToolUse` | after the model asks for a tool, before it runs | allow, rewrite the arguments, or **deny** |
| `PostToolUse` | after the tool returns, before the model sees it | **replace the result** |

### Six mechanics worth knowing before you write one

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

---

# Part 4 — structured extraction

Examples 14–18 leave the Agent SDK behind and go back to the Messages API of
Part 1. They share one mock document set (`src/shared/documents.ts`) and one
set of schemas and validators (`src/shared/extractionTools.ts`), and they are
all variations on a single question:

> A tool schema guarantees the **shape** of what comes back. What guarantees
> it is **true**?

The domain is the same fictional home-heating retailer as Part 3, one
department over: accounts payable. Every document is a plain string with its
ground truth written down next to it, because an extraction example whose
correct answer isn't recorded can't tell you whether the extraction was
right — and "looks plausible" is the exact failure mode this part is about.

### The two error classes

| | Syntax / structure | Semantics |
|---|---|---|
| Looks like | malformed JSON, missing key, string where a number goes | line items that don't sum, a date read in the wrong locale, an invented PO number |
| Fixed by | tool use with a JSON schema (+ `strict: true`) | validation code you write |
| After the fix | *cannot happen* | still happens, silently |

Nearly all of the exam's material on Task 4.3 is about the left column and
nearly all of Task 4.4 is about the right one. The single most useful thing
in this part is the distinction itself: the left column is solved, and
solving it does not move the right column at all.

### `npm run extract` — "give me JSON" vs a tool with a schema

Three arms on one invoice: prose JSON with no tools, a tool on
`tool_choice: auto`, a tool forced with `strict: true`.

Part 1 spends no tokens at all — it runs the salvage parser you need for the
prose arm against four fixtures:

```
  clean object                                    parsed: yes
  wrapped in a markdown fence                     parsed: yes   (repair: stripped a fence)
  with a helpful preamble                         parsed: yes   (repair: cut prose)
  number written the way the document writes it   parsed: NO
```

The last one is `"total_amount": 1,008.38` — the number exactly as the
document prints it. One character, whole record lost.

Then the live arms, and the honest result: **arm A worked.** It returned
valid JSON on the first try — inside a markdown fence, despite a prompt that
said "No markdown fences", so it needed one repair to parse:

```
raw text : "```json\n{\n  \"invoice_number\": \"INV-8842\", …\n}\n```"
parsed   : yes
repairs  : stripped a markdown code fence
```

That is the point, not a failed demo. If your reason for using tool use is
"the model writes broken JSON", you will fail to reproduce the problem and
conclude the schema was unnecessary. Compare the **code** instead: arm A ends
in a string and a parser that can fail (plus a retry path, plus a decision
about records that never parse); arm C ends in `block.input`, an object,
already the declared shape, validated server-side by `strict: true`. The
failure mode isn't handled — it's absent.

And the thing all three arms agree on: `total_amount: 1008.38`, the number
the document's TOTAL DUE line states. Its own subtotal and VAT come to
956.39. Every arm returned a correctly-typed, schema-valid, fully guaranteed
number that is wrong by £51.99.

### `npm run choose` — `auto`, `any`, and forced

Four documents arrive as an undifferentiated pile: an invoice, a purchase
order, a customer complaint, and an internal memo about bank holiday cover.
Three extraction schemas are on offer. The memo is the fixture that does the
work — a real inbox is full of documents that are none of your types.

**Stage 1, `tool_choice: "any"`** — the model must call one of the three:

```
document 1   -> extract_invoice
document 2   -> extract_purchase_order
document 3   -> extract_support_ticket
document 4   -> extract_support_ticket        <- the memo
```

Filed as a support ticket, with `concerns: ["Leeds distribution centre
closure on Monday 4 May", "Goods-in reopens Tuesday at 07:00", …]`. `any`
guarantees a structured record; it cannot guarantee a true one, and it
removes the model's ability to say the honest thing.

**Stage 2, the same memo on `auto`** — no tool call, a paragraph explaining
that it isn't a document type the tools cover. Correct, useful, and a
pipeline outage: the next step expected a record.

**Stage 3, forced router then dispatch** — one call forced to
`extract_metadata` (which has `other` and `unclear` members), then dispatch
in TypeScript to a second forced call:

```
document 1   type=invoice         id=INV-8842      -> extract_invoice …
document 2   type=purchase_order  id=PO-5567       -> extract_purchase_order …
document 3   type=support_ticket  id=ORD-1002      -> extract_support_ticket …
document 4   type=other           id=—             no enrichment schema — held for review
```

The memo's branch is the deliverable. `auto` can under-produce (no record)
and `any` can over-produce (a record for a document that has none); neither
is a bug, and neither is a default you can apply to a whole pipeline. Two
calls cost more than one and buy a decision point that lives in your code.

### `npm run schema` — required, nullable, and where format rules live

One sparse invoice from a small German supplier — no purchase order, no tax
id, no line items, amount written `1.240,00 €`, date written `02.03.2026`.
Three arms: everything-required with a closed enum; the same fields nullable
with `other`/`unclear`; and that schema plus normalisation rules in the
prompt. Graded against the document:

| field | Arm A required | Arm B nullable | verdict |
|---|---|---|---|
| `purchase_order` | `<UNKNOWN>` | `null` | not on the page |
| `tax_id` | `<UNKNOWN>` | `null` | not on the page |
| `category` | `hardware` | `other` + detail | consumables — outside the enum |
| `invoice_date` | `2026-03-02` | `2026-03-02` | correct in both |
| `total_amount` | `1240` | `1240` | correct in both |

Arm A wasn't careless. A required non-nullable string leaves no legal way to
say "not present", so the model reached for a sentinel — `<UNKNOWN>` — which
means "absent" in a vocabulary it invented on the spot and did not document,
and which `if (invoice.purchase_order)` reads as present. `null` is the
encoding both ends already agree on.

Note that arm B keeps every field in `required`. **Required and nullable are
different axes**: the key is always there (no `undefined` checks downstream),
the value is allowed to be null. Completeness kept, fabrication pressure
removed.

Arms B and C came out identical in the recorded run — this model read
`02.03.2026` and `1.240,00` correctly with no rules at all. Reported rather
than tuned away, and it doesn't retire the rules: both strings still have two
valid readings, no schema can distinguish them (`2026-02-03` and `2026-03-02`
are both fine `format: date` values), and the arm you can't see is the
US-formatted invoice in the same batch where the same instinct is wrong. The
schema constrains the shape; the prompt resolves the source.

### `npm run retry` — validation, feedback, and the retry that can't work

Part 1 runs the validator against a handcrafted extraction that passes every
schema check and is wrong five ways — no model, no tokens, same answer every
time. The error strings are written as instructions, because part 2 sends
them back to the model verbatim and "validation failed" isn't actionable.

Part 2 is the loop. A real run:

```
attempt 1   stated_total 1008.38   calculated_total 1008.39   conflict_detected true
            -> 1 error: calculated_total is 1008.39, but the line items sum to
               796.99 and tax_amount is 159.4, giving 956.39
attempt 2   -> clean
```

The retry request carries all three ingredients the exam names — the original
document, the failed extraction, and the specific errors — and drops any one
of them at your peril: without the document, "fixing" arithmetic means
editing whichever number makes the sum work.

Worth noticing what *didn't* fail: the schema asks for `stated_total` and
`calculated_total` as **separate** fields plus a `conflict_detected` boolean,
so the model never has to choose which number to discard. The disagreement
survives into the output instead of being silently resolved. Schema design
doing the work a retry would otherwise have to do is the good outcome.

Part 3 points the same loop at a field the document does not contain — its PO
line reads "see attached supply agreement", and the agreement wasn't
attached:

```
attempt 1   purchase_order: "see attached supply agreement"
attempt 2   -> purchase_order: null           (1 error remains)
attempt 3   -> "see attached supply agreement" (1 error remains)
after 3 attempts: still failing
```

Two lessons in one trace. **Retry fixes form, not absence** — everything
needed for a format error is on the page and was misread; missing information
is not added by asking again, and each attempt raises the pressure to invent
it. And **presence is not validity**: a `!purchase_order` check waves that
string straight through, so it took a format check to notice that a sentence
had been moved into a data field. A field absent from the source is a routing
decision — hold the invoice, ask the supplier — not a third attempt.

### `npm run feedback` — `detected_pattern` and closing the loop

Everything above improves one extraction. This one is about the hundredth: a
code-review agent has been running for six months and developers have been
dismissing some of its findings.

Whether you can do anything with that depends on a schema decision made
before any of it ran. A finding's title is prose and gets reworded every run;
its file and line move with the next commit. `detected_pattern` — a stable
snake_case key for the code construct that triggered the finding — survives
both, so "which of our rules keeps producing findings nobody acts on" becomes
a `GROUP BY`:

```
pattern                        raised  dismissed   rate  verdict
math_random_for_identifier         31         29    94%  noise
empty_catch_block                  24         22    92%  noise
await_in_loop                      18          7    39%  useful
parse_int_without_radix            12          2    17%  useful
```

Then a live review of a small file, and the triage against that history:

```
SUPPRESS  math_random_for_identifier     dismissed 29/31 previously
SHOW      parse_int_without_radix        useful, 17% dismissed
SHOW      await_in_loop                  useful, 39% dismissed
SHOW      loose_equality                 useful, 11% dismissed
```

A pattern with no history is shown, not suppressed — same shape as `other` in
example 16's enum: the open member is what stops new things being quietly
relabelled as old ones. And suppression is the crudest of the available
moves. The `math_random_for_identifier` findings are dismissed because the
construct is fine for non-security identifiers, so the real fix is to rewrite
the rule to ask what the value is *used for*. The dismissal data is what
tells you that; the pattern key is what makes the dismissal data add up.

## Notes

- Examples 1–4 use `claude-haiku-4-5` — fast and cheap, good for repeatedly
  re-running while learning. Swap the `MODEL` constant at the top of each
  file to try a different model.
- Examples 5–9 run `claude-sonnet-5` for coordinators and synthesis (where
  judgement matters) and `claude-haiku-4-5` for researchers (where it's
  retrieve-and-report). Mixing models per agent costs the coordinator
  nothing, since each subagent has its own context window.
- Examples 10–12 run `claude-sonnet-5`; example 13 deliberately uses
  `claude-haiku-4-5`, because a normalisation hook that only helps a weak
  model is a crutch rather than infrastructure.
- Examples 14–18 all run `claude-haiku-4-5`, for the same reason and one
  more: schema design is not something you should have to buy your way out
  of with a bigger model, and a small model makes the difference between two
  schema designs visible instead of theoretical.
- **These cost real money.** Roughly, per run: example 5 ≈ $0.06, example 6
  ≈ $0.37, example 7 ≈ $0.27, example 8 ≈ $0.89, example 9 ≈ $0.16,
  example 10 ≈ $0.14 (three arms), example 11 ≈ $0.28, example 12 ≈ $0.05,
  example 13 ≈ $0.01. Example 8 is the expensive one because it runs two
  research rounds plus two syntheses.
  Examples 14–18 are the cheap ones — Haiku, short documents, a handful of
  calls each: well under $0.02 apiece, ≈ $0.05 for the whole of Part 4.
  The no-API halves cost nothing at all: example 10's Part 1, example 14's
  Part 1, example 17's Part 1, example 18's Part 1.
- Every "tool" in this repo is a hardcoded mock — `src/shared/weatherTool.ts`
  for examples 2–4, `src/shared/corpus.ts` for 5–9, `src/shared/supportTools.ts`
  for 10–13. No network calls, no extra credentials, and the same query returns
  the same records every time, so reruns differ only where the *model* made a
  different choice. Part 4's documents (`src/shared/documents.ts`) take the
  same idea one step further: each is built around a specific extraction
  hazard and ships with its ground truth, so the examples grade themselves.
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
  transcripts above line for line.
- `npm run typecheck` runs `tsc --noEmit` over everything.
