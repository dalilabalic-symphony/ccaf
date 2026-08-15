# Task Statement 4.3 — Skills → code references

> Enforce structured output using tool use and JSON schemas.

Examples 14–16, over the schemas in [extractionTools.ts](../src/shared/extractionTools.ts) and the mock documents in [documents.ts](../src/shared/documents.ts).

---

## The mechanics, verified against the installed SDK

All of this was confirmed by running it against `@anthropic-ai/sdk` 0.115.0, not read off the docs.

| Fact | Where |
|---|---|
| A tool definition is `{ name, description, input_schema }`, raw JSON Schema — no Zod required, and Part 4 uses the raw form deliberately because the schema is the subject | [extractionTools.ts:111-138](../src/shared/extractionTools.ts#L111-L138) |
| `tool_use.input` arrives **already parsed** — an object, not a string. There is no `JSON.parse` anywhere in Part 4's tool arms | [14-tool-schema-extraction.ts:159-177](../src/14-tool-schema-extraction.ts#L159-L177) |
| `strict: true` is a top-level field on the tool (not on `tool_choice`), and requires `additionalProperties: false` plus a `required` list naming every property | [extractionTools.ts:111-138](../src/shared/extractionTools.ts#L111-L138) |
| `tool_choice` takes `{type:"auto"}`, `{type:"any"}`, `{type:"tool", name}` (and `{type:"none"}`) | [15-tool-choice.ts:72](../src/15-tool-choice.ts#L72), [15-tool-choice.ts:110](../src/15-tool-choice.ts#L110), [15-tool-choice.ts:183](../src/15-tool-choice.ts#L183) |
| `stop_reason` is `"tool_use"` when a tool was called and `"end_turn"` when the model answered in prose — the cheapest way to detect an `auto` arm that produced no record | [14-tool-schema-extraction.ts:139-157](../src/14-tool-schema-extraction.ts#L139-L157) |
| Nullable fields are `type: ["string", "null"]`, and stay listed in `required` | [extractionTools.ts:191-250](../src/shared/extractionTools.ts#L191-L250) |
| A forced `tool_choice` still lets the model choose the *values* — forcing the call does not force the answer to be true | [15-tool-choice.ts:59-100](../src/15-tool-choice.ts#L59-L100) |

---

## Knowledge of

### Tool use with JSON schemas as the most reliable approach for guaranteed schema-compliant structured output

| What | Where |
|---|---|
| The three arms — prose JSON, tool on `auto`, tool forced with `strict` | [14-tool-schema-extraction.ts:118-177](../src/14-tool-schema-extraction.ts#L118-L177) |
| The argument stated structurally rather than empirically: prose produces TEXT you must parse, a tool produces an OBJECT there is nothing to parse | [14-tool-schema-extraction.ts:1-30](../src/14-tool-schema-extraction.ts#L1-L30) |
| `parseLooseJson` — the salvage code the prose arm needs and the tool arm does not have | [extractionTools.ts:540-580](../src/shared/extractionTools.ts#L540-L580) |
| …exercised on four fixtures with no API call, so the cost of the prose path is visible for free | [14-tool-schema-extraction.ts:61-114](../src/14-tool-schema-extraction.ts#L61-L114) |

**The honest observed result**, recorded rather than tuned away: the prose arm *worked*. Haiku returned valid JSON on the first attempt — wrapped in a markdown fence, despite a prompt that said "No markdown fences", so it took one repair to parse:

```
raw text : "```json\n{\n  \"invoice_number\": \"INV-8842\", …\n}\n```"
parsed   : yes
repairs  : stripped a markdown code fence
```

Which is why the file argues from code rather than from failure. If your reason for tool use is "the model writes broken JSON", you will fail to reproduce that and conclude the schema was unnecessary. The fixture that *does* fail is the one nobody plans for: `"total_amount": 1,008.38` — the number exactly as the document prints it.

### The distinction between `auto`, `any`, and forced tool selection

| What | Where |
|---|---|
| `auto` is a permission, not a guarantee — stated at the point of use | [14-tool-schema-extraction.ts:139-150](../src/14-tool-schema-extraction.ts#L139-L150) |
| `auto` under-producing: the memo comes back as prose, `stop_reason: "end_turn"`, no record for the next pipeline stage | [15-tool-choice.ts:103-142](../src/15-tool-choice.ts#L103-L142) |
| `any` over-producing: the same memo forced into `extract_support_ticket` with invented `concerns` | [15-tool-choice.ts:59-100](../src/15-tool-choice.ts#L59-L100) |
| Forced tool: the call cannot be skipped, cannot be answered in prose, cannot be redirected to a different schema | [15-tool-choice.ts:178-187](../src/15-tool-choice.ts#L178-L187) |
| The summary of when each is right | [15-tool-choice.ts:232-260](../src/15-tool-choice.ts#L232-L260) |

An observed run of stage 1 — three documents routed correctly, one misfiled with confidence:

```
document 1   -> extract_invoice
document 2   -> extract_purchase_order
document 3   -> extract_support_ticket
document 4   -> extract_support_ticket     <- the bank-holiday memo
   {"customer_email":null,"order_reference":null,
    "concerns":["Leeds distribution centre closure on Monday 4 May", …],
    "urgency":"normal"}
```

### That strict JSON schemas eliminate syntax errors but not semantic errors

| What | Where |
|---|---|
| The two error classes, side by side | [17-validate-retry.ts:1-35](../src/17-validate-retry.ts#L1-L35) |
| The demonstration: every arm of example 14 extracts `total_amount: 1008.38`, the number the document states — correctly typed, schema-valid, and 51.99 wrong | [14-tool-schema-extraction.ts:240-252](../src/14-tool-schema-extraction.ts#L240-L252) |
| The fixture that makes it true — INV-8842's subtotal + VAT come to 956.39, its TOTAL DUE line says 1008.38 | [documents.ts:15-69](../src/shared/documents.ts#L15-L69) |
| Values in the wrong field, the other semantic error the exam names: `purchase_order: "see attached supply agreement"` | [17-validate-retry.ts:257-300](../src/17-validate-retry.ts#L257-L300) |

### Schema design considerations: required vs optional, enums with `other` + detail

| What | Where |
|---|---|
| `required` and `nullable` are different axes — nullable fields stay in `required` so the key is always present and no downstream `undefined` check is needed | [extractionTools.ts:180-250](../src/shared/extractionTools.ts#L180-L250) |
| The `other` + detail + `unclear` enum, with the reason the last two are not the same value | [extractionTools.ts:81-100](../src/shared/extractionTools.ts#L81-L100) |
| The same pattern in a router (`document_type`) and in findings (`detected_pattern`) | [extractionTools.ts:254-290](../src/shared/extractionTools.ts#L254-L290), [extractionTools.ts:446-500](../src/shared/extractionTools.ts#L446-L500) |

---

## Skills in

### 1 · Defining extraction tools with JSON schemas and extracting from the `tool_use` response

**Primary: [14-tool-schema-extraction.ts](../src/14-tool-schema-extraction.ts).**

| What | Where |
|---|---|
| `firstToolUse` — the whole of "extract the structured data from the response" | [extractionTools.ts:513-521](../src/shared/extractionTools.ts#L513-L521) |
| Tool names as exported constants, matched at every call site (same discipline as the MCP names in Part 3) | [extractionTools.ts:24-33](../src/shared/extractionTools.ts#L24-L33) |
| Descriptions written as routing guidance — each says what its document type is *and what it is not* | [extractionTools.ts:292-334](../src/shared/extractionTools.ts#L292-L334) |

### 2 · `tool_choice: "any"` when several schemas exist and the document type is unknown

**Primary: [15-tool-choice.ts](../src/15-tool-choice.ts), stage 1.** The pile is deliberately undifferentiated, and the fourth document deliberately fits none of the schemas — you cannot evaluate a forced choice without an option that should not have been chosen.

| What | Where |
|---|---|
| Three schemas offered, `{type:"any"}`, one call per document | [15-tool-choice.ts:59-83](../src/15-tool-choice.ts#L59-L83) |
| The caveat that has to travel with the technique: pair `any` with an escape hatch or you have bought confident misfiling | [15-tool-choice.ts:85-99](../src/15-tool-choice.ts#L85-L99) |

### 3 · Forcing a specific tool so a particular extraction runs before enrichment

**Primary: [15-tool-choice.ts](../src/15-tool-choice.ts), stage 3.** Forced metadata pass → dispatch in TypeScript → second forced call to the schema the router chose.

| What | Where |
|---|---|
| The forced router call | [15-tool-choice.ts:178-187](../src/15-tool-choice.ts#L178-L187) |
| Dispatch as a plain lookup table, not a second thing the model has to get right | [15-tool-choice.ts:154-158](../src/15-tool-choice.ts#L154-L158), [15-tool-choice.ts:190-210](../src/15-tool-choice.ts#L190-L210) |
| The branch that only exists because the router has an `other` member: no enrichment schema, hold for review | [15-tool-choice.ts:196-206](../src/15-tool-choice.ts#L196-L206) |

Observed:

```
document 4   type=other   id=—
             no enrichment schema for this type (Internal staff announcement
             regarding bank holiday cover and facility closures) — held for review
```

### 4 · Designing fields as optional (nullable) so the model doesn't fabricate

**Primary: [16-schema-design.ts](../src/16-schema-design.ts).** One sparse invoice, three arms: all-required with a closed enum; nullable with `other`/`unclear`; the same plus normalisation rules.

| What | Where |
|---|---|
| Arm A's schema — the one everybody writes first | [extractionTools.ts:141-189](../src/shared/extractionTools.ts#L141-L189) |
| Arm B's schema — nullable where a document may not have the field, and why the descriptions say "MUST be null if…" | [extractionTools.ts:180-250](../src/shared/extractionTools.ts#L180-L250) |
| Grading against the document's ground truth, including the sentinel check | [16-schema-design.ts:88-155](../src/16-schema-design.ts#L88-L155) |

Observed, on the same document with the same model:

| field | Arm A (required) | Arm B (nullable) |
|---|---|---|
| `purchase_order` | `<UNKNOWN>` | `null` |
| `tax_id` | `<UNKNOWN>` | `null` |
| `category` | `hardware` | `other` + "diverse Verbrauchsmaterialien Baustelle Bochum" |

Arm A did not invent a plausible PO number; it invented a **sentinel**. That is the more instructive outcome — `<UNKNOWN>` means "absent" in a vocabulary the model made up on the spot and did not document, it will be spelled differently next run, and `if (invoice.purchase_order)` reads it as present. `null` is the encoding both ends already agree on.

### 5 · Adding `unclear` for ambiguity and `other` + detail for extensible categorisation

| What | Where |
|---|---|
| The enum, with the distinction spelled out: `other` = the taxonomy is incomplete, `unclear` = the document is | [extractionTools.ts:81-100](../src/shared/extractionTools.ts#L81-L100) |
| Arm A's forced fit — `hardware` for a line reading "diverse Verbrauchsmaterialien" — as the counterfactual | [16-schema-design.ts:130-155](../src/16-schema-design.ts#L130-L155) |
| `category_detail`, required when `category` is `other`, so the value isn't lost | [extractionTools.ts:225-235](../src/shared/extractionTools.ts#L225-L235) |

### 6 · Format normalisation rules in the prompt alongside a strict schema

| What | Where |
|---|---|
| `NORMALIZATION_RULES` — written as rules about the SOURCE ("a European supplier writes…"), not about the output | [extractionTools.ts:35-64](../src/shared/extractionTools.ts#L35-L64) |
| The A/B: identical schema, rules on vs off | [16-schema-design.ts:57-86](../src/16-schema-design.ts#L57-L86) |
| The traps the rules exist for — `02.03.2026` and `1.240,00 €` | [documents.ts:71-114](../src/shared/documents.ts#L71-L114) |

**Reported honestly:** in the recorded run arms B and C were identical — Haiku read both the date and the amount correctly with no rules at all. That does not retire the rules. Both strings still have two valid readings, and *no schema can distinguish them*: `2026-02-03` and `2026-03-02` are both perfectly good `format: date` values, so the schema has already done everything a schema can. The rules are what makes a correct reading a property of the pipeline rather than of this run — and the arm you cannot see is the US-formatted invoice in the same batch, where the same instinct is wrong.

Compare with example 13, which normalises formats in a `PostToolUse` hook. Same problem; the fix moves depending on whether the ambiguity is resolvable in code. There, the conversion was known in advance (this service emits Unix milliseconds), so it belongs in a pure function. Here it depends on reading the document, so it belongs in the prompt.
