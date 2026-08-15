# Task Statement 4.4 — Skills → code references

> Implement validation, retry, and feedback loops for extraction quality.

Examples 17–18, over the validators in [extractionTools.ts](../src/shared/extractionTools.ts) and the mock documents in [documents.ts](../src/shared/documents.ts).

This task statement starts where 4.3 stops. Tool use plus a JSON schema removes an entire error class — malformed JSON, missing key, wrong type — and removes exactly none of the errors below.

---

## The two error classes, which is the whole frame

| | Syntax / structure | Semantics |
|---|---|---|
| Looks like | malformed JSON, missing key, string where a number goes | line items that don't sum, a value in the wrong field, a date read in the wrong locale, an invented reference |
| Fixed by | tool use + JSON schema (+ `strict: true`) | validation code you write |
| After the fix | *cannot happen* | still happens, silently |
| Stated at | [17-validate-retry.ts:1-35](../src/17-validate-retry.ts#L1-L35) | |

---

## Knowledge of

### The difference between semantic validation errors and schema syntax errors

| What | Where |
|---|---|
| The frame, up front | [17-validate-retry.ts:1-35](../src/17-validate-retry.ts#L1-L35) |
| `BAD_EXTRACTION` — an object that passes every schema check and is wrong five ways | [17-validate-retry.ts:49-93](../src/17-validate-retry.ts#L49-L93) |
| `validateInvoice` — the checks a schema cannot express: line arithmetic, totals, flag consistency, date format, currency format, field validity | [extractionTools.ts:597-671](../src/shared/extractionTools.ts#L597-L671) |
| Run with no model at all, so the checks are testable in CI (same argument as example 10's hook probe) | [17-validate-retry.ts:95-117](../src/17-validate-retry.ts#L95-L117) |

Observed Part 1 output — five semantic errors in a schema-valid object:

```
- line item "Copper flare fitting kit": quantity 12 x unit_price 28.5 = 342,
  but amount is 285. One of the three is misread.
- calculated_total is 1008.38, but the line items in this extraction sum to
  739.99 and tax_amount is 159.4, giving 899.39.
- stated_total (1008.38) and the arithmetic (899.39) differ by 108.99, so
  conflict_detected must be true and conflict_note must say what disagrees.
- invoice_date "03/14/2026" is not YYYY-MM-DD.
- currency "£" is not a 3-letter ISO 4217 code (e.g. GBP, EUR).
```

### Retry-with-error-feedback: appending specific validation errors to guide correction

| What | Where |
|---|---|
| `retryPrompt` — the three ingredients (original document, failed extraction, specific errors) and what breaks if you drop each one | [17-validate-retry.ts:136-171](../src/17-validate-retry.ts#L136-L171) |
| Error strings written as instructions rather than log lines, because they are sent back verbatim | [extractionTools.ts:597-671](../src/shared/extractionTools.ts#L597-L671) |
| The bounded loop — `MAX_ATTEMPTS = 3`, re-validating the whole record each round | [17-validate-retry.ts:172-191](../src/17-validate-retry.ts#L172-L191) |
| The alternative shape (append the assistant `tool_use` turn, reply with a `tool_result` carrying `is_error: true`) noted where the choice is made | [17-validate-retry.ts:136-152](../src/17-validate-retry.ts#L136-L152) |

### The limits of retry: ineffective when the information is absent from the source

| What | Where |
|---|---|
| Part 3 — the same loop against INV-8842's PO line, which reads "see attached supply agreement" | [17-validate-retry.ts:255-341](../src/17-validate-retry.ts#L255-L341) |
| The retryable / not-retryable split, stated as a rule you can apply before looping | [17-validate-retry.ts:310-330](../src/17-validate-retry.ts#L310-L330) |
| The fixture — the field is absent from the document on purpose, and `INVOICE_MISMATCHED_TRUTH.purchase_order` is `null` so the example can say so | [documents.ts:15-69](../src/shared/documents.ts#L15-L69) |

### Feedback loop design: tracking which code constructs trigger findings

| What | Where |
|---|---|
| Why `detected_pattern` and not the title or the file — prose gets reworded, line numbers move | [18-feedback-loop.ts:1-30](../src/18-feedback-loop.ts#L1-L30) |
| The field, described so the model reuses keys across runs instead of inventing one per finding | [extractionTools.ts:446-500](../src/shared/extractionTools.ts#L446-L500) |
| `DISMISSAL_HISTORY` — the mock outcome store, keyed by pattern | [documents.ts:216-238](../src/shared/documents.ts#L216-L238) |

---

## Skills in

### 1 · Follow-up requests carrying the document, the failed extraction, and the errors

**Primary: [17-validate-retry.ts](../src/17-validate-retry.ts), part 2.**

| What | Where |
|---|---|
| The request itself | [17-validate-retry.ts:152-171](../src/17-validate-retry.ts#L152-L171) |
| "Do not change fields that were already correct" — and the reason it is there: a retry is a fresh extraction and can break what was right | [17-validate-retry.ts:164-170](../src/17-validate-retry.ts#L164-L170) |
| "If the document is internally inconsistent, record both numbers — do not adjust a value to make the arithmetic work" | [17-validate-retry.ts:164-170](../src/17-validate-retry.ts#L164-L170) |

An observed run:

```
attempt 1   stated_total 1008.38   calculated_total 1008.39   conflict_detected true
            -> 1 error: calculated_total is 1008.39, but the line items sum to
               796.99 and tax_amount is 159.4, giving 956.39
attempt 2   -> clean
```

### 2 · Identifying when retries will and will not work

**Primary: [17-validate-retry.ts](../src/17-validate-retry.ts), part 3.** The observed run, on a field the document does not contain:

```
attempt 1   purchase_order: "see attached supply agreement"
attempt 2   -> null                            (1 error remains)
attempt 3   -> "see attached supply agreement" (1 error remains)
after 3 attempts: still failing
```

Two findings in one trace:

- **Retry fixes form, not absence.** A format error has everything it needs on the page and was misread; a missing value is not added by asking again, and each attempt raises the pressure to invent it. The right response to an absent field is a routing decision — hold the invoice, ask the supplier — not a third call.
- **Presence is not validity.** The model filled the field with the document's own wording, which is the exam's "values in the wrong field". A `!purchase_order` check passes that happily; it took a **format** check to catch it. Both checks live in `validateInvoice` for exactly this reason — [extractionTools.ts:654-671](../src/shared/extractionTools.ts#L654-L671).

### 3 · Self-correction flows: `calculated_total` alongside `stated_total`, `conflict_detected`

**Primary: [extractionTools.ts](../src/shared/extractionTools.ts), the validated invoice schema.**

| What | Where |
|---|---|
| The schema — both totals as separate fields, plus a boolean and a note | [extractionTools.ts:359-425](../src/shared/extractionTools.ts#L359-L425) |
| Why two fields rather than one: a single `total` forces the model to pick a winner and silently discard the disagreement | [extractionTools.ts:359-373](../src/shared/extractionTools.ts#L359-L373) |
| The validator recomputes rather than trusting `conflict_detected` — the flag is the model's opinion, the arithmetic is a measurement | [extractionTools.ts:627-645](../src/shared/extractionTools.ts#L627-L645) |

**Worth noticing what did not fail.** Attempt 1 in part 2 got `conflict_detected: true` unprompted and its only error was an arithmetic slip in `calculated_total`. That is the schema doing the work a retry would otherwise have to do — schema design and validation are the same project, and the cheapest retry is the one the schema made unnecessary.

### 4 · `detected_pattern` fields for false-positive analysis

**Primary: [18-feedback-loop.ts](../src/18-feedback-loop.ts).**

| What | Where |
|---|---|
| The findings schema, with the pattern key and the instruction to reuse keys across runs and files | [extractionTools.ts:446-500](../src/shared/extractionTools.ts#L446-L500) |
| The aggregation — dismissal rate per pattern, thresholded, no model involved | [18-feedback-loop.ts:41-100](../src/18-feedback-loop.ts#L41-L100) |
| The live review that produces findings with pattern keys attached | [18-feedback-loop.ts:102-141](../src/18-feedback-loop.ts#L102-L141) |
| The triage that closes the loop | [18-feedback-loop.ts:143-211](../src/18-feedback-loop.ts#L143-L211) |
| The fixture — code with two act-on-it findings and two dismissible ones, because you cannot study false positives without any | [documents.ts:175-214](../src/shared/documents.ts#L175-L214) |

Observed:

```
pattern                        raised  dismissed   rate  verdict
math_random_for_identifier         31         29    94%  noise
empty_catch_block                  24         22    92%  noise
await_in_loop                      18          7    39%  useful
parse_int_without_radix            12          2    17%  useful

SUPPRESS  math_random_for_identifier     dismissed 29/31 previously
SHOW      parse_int_without_radix        useful, 17% dismissed
SHOW      await_in_loop                  useful, 39% dismissed
SHOW      loose_equality                 useful, 11% dismissed
```

Four things that make this a loop rather than a report:

1. **The decision is made in code from counted outcomes**, against a threshold you can argue about — not by editing the review prompt until the annoying findings stop. Prompt edits are untraceable and suppress by *wording*, so the finding returns the moment the model phrases it differently.
2. **An unseen pattern is shown, not suppressed.** No evidence means a human looks. Same shape as `other` in example 16's enum — [18-feedback-loop.ts:161-167](../src/18-feedback-loop.ts#L161-L167).
3. **Suppression is the crudest available move.** The same table supports downgrading severity, routing to a reviewer who does care, or rewriting the rule — `math_random_for_identifier` is dismissed because the construct is fine for non-security identifiers, so the rule should ask what the value is *used for*.
4. **None of this measures the model.** It measures one rule's fit to one codebase, which is why it belongs in a data store rather than in a prompt.
