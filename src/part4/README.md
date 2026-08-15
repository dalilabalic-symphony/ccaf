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

## Running these examples

```bash
npm run extract    # 14-tool-schema-extraction.ts
npm run choose     # 15-tool-choice.ts
npm run schema     # 16-schema-design.ts
npm run retry      # 17-validate-retry.ts
npm run feedback   # 18-feedback-loop.ts
```

## The two error classes

| | Syntax / structure | Semantics |
|---|---|---|
| Looks like | malformed JSON, missing key, string where a number goes | line items that don't sum, a date read in the wrong locale, an invented PO number |
| Fixed by | tool use with a JSON schema (+ `strict: true`) | validation code you write |
| After the fix | *cannot happen* | still happens, silently |

Nearly all of the exam's material on Task 4.3 is about the left column and
nearly all of Task 4.4 is about the right one. The single most useful thing
in this part is the distinction itself: the left column is solved, and
solving it does not move the right column at all.

## What each one shows

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

- Examples 14–18 all run `claude-haiku-4-5` — schema design is not something
  you should have to buy your way out of with a bigger model, and a small
  model makes the difference between two schema designs visible instead of
  theoretical.
- **These are the cheap examples.** Haiku, short documents, a handful of
  calls each: well under $0.02 per run, ≈ $0.05 for the whole of Part 4. The
  no-API halves cost nothing at all: example 14's Part 1, example 17's
  Part 1, example 18's Part 1.
- Every document in `src/shared/documents.ts` carries its ground truth
  (`INVOICE_MISMATCHED_TRUTH`, `INVOICE_SPARSE_TRUTH`, …), and the examples
  grade themselves against it. Every hazard in those fixtures is deliberate —
  don't "fix" a document without updating its `_TRUTH` in the same edit.
- Skills-to-code mappings for the certification task statements live in
  `notes/Task_4.3_Skills.md` and `notes/Task_4.4_Skills.md`.
