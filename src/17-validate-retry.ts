// Example 17 — Task Statement 4.4: validation, retry with error feedback,
// and the case where retrying is useless.
//
// Example 14 ended on the sentence this file starts from: a strict schema
// eliminates syntax errors and touches nothing else. `tool_use.input` is
// guaranteed to be an object with the declared keys and the declared types.
// It is not guaranteed to be arithmetic, or to be about this document, or
// to be true.
//
// So there are two error classes and they need completely different
// machinery:
//
//   SYNTAX / STRUCTURE   malformed JSON, missing key, string where a number
//                        belongs. Eliminated by tool use + `strict`. Nothing
//                        to retry, because nothing can fail.
//
//   SEMANTICS            line items that don't sum to the total, a value in
//                        the wrong field, a date read in the wrong locale,
//                        a number invented to satisfy a required field.
//                        Invisible to the schema. Caught by code you write.
//
// The document is INV-8842, whose TOTAL DUE (1008.38) does not match its own
// subtotal + VAT (956.39). Three parts:
//
//   PART 1  the validator alone, on a handcrafted bad extraction. No model,
//           no tokens, same answer every time.
//   PART 2  extract -> validate -> retry with the specific errors appended.
//   PART 3  the same loop against a field the document does not contain,
//           which is where retrying stops helping and starts being a way to
//           pressure a model into making something up.

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { INVOICE_MISMATCHED, INVOICE_MISMATCHED_TRUTH } from "./shared/documents.js";
import {
  INVOICE_TOOL_VALIDATED,
  T_EXTRACT_INVOICE,
  type ValidatedInvoice,
  firstToolUse,
  round2,
  validateInvoice,
} from "./shared/extractionTools.js";

const MODEL = "claude-haiku-4-5";
const MAX_ATTEMPTS = 3;

const EXTRACT_PROMPT = ["Extract this invoice.", "", INVOICE_MISMATCHED].join("\n");

// ── Part 1: the validator, with no model in the loop ─────────────────────

/**
 * What a plausible bad extraction looks like. Every field is the right type
 * and the object would pass any schema check you can write:
 *
 *   - the 12 x 28.50 line says 285.00 (a dropped digit, not nonsense)
 *   - calculated_total was set equal to stated_total, which is the most
 *     natural thing to do when two numbers disagree and one field is called
 *     "total"
 *   - conflict_detected is therefore false
 *   - the date is MM/DD, the currency is a symbol
 */
const BAD_EXTRACTION: ValidatedInvoice = {
  invoice_number: "INV-8842",
  invoice_date: "03/14/2026",
  supplier_name: "Northwind Heating Supplies Ltd",
  currency: "£",
  purchase_order: null,
  line_items: [
    {
      description: "Heat pump mounting bracket",
      quantity: 3,
      unit_price: 145.0,
      amount: 435.0,
    },
    {
      description: "Copper flare fitting kit",
      quantity: 12,
      unit_price: 28.5,
      amount: 285.0,
    },
    {
      description: "Installation manual (printed)",
      quantity: 1,
      unit_price: 19.99,
      amount: 19.99,
    },
  ],
  tax_amount: 159.4,
  stated_total: 1008.38,
  calculated_total: 1008.38,
  conflict_detected: false,
  conflict_note: null,
};

function demonstrateValidator() {
  console.log("════════ Part 1 — the validator, no model involved ════════\n");

  const errors = validateInvoice(BAD_EXTRACTION);
  console.log(`  ${errors.length} semantic error(s) in a schema-valid object:\n`);
  for (const e of errors) console.log(`    - ${e}`);

  console.log(
    [
      "",
      "  Read those messages as OUTPUT, not as logging. Each one names the",
      "  field, quotes the values that disagree, and says what to do — because",
      "  in part 2 they get sent back to the model verbatim, and 'validation",
      "  failed' is not something anything can act on.",
      "",
      "  `validateInvoice` is a pure function of the extraction, so it costs",
      "  nothing to run, returns the same thing every time, and belongs in CI.",
      "  Same argument as example 10's hook probe: the checks you can make",
      "  deterministic should not be things you sample a model to evaluate.",
    ].join("\n"),
  );
}

// ── Part 2: extract, validate, retry with the errors ─────────────────────

async function extract(
  client: Anthropic,
  content: string,
): Promise<ValidatedInvoice> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    tools: [INVOICE_TOOL_VALIDATED],
    tool_choice: { type: "tool", name: T_EXTRACT_INVOICE },
    messages: [{ role: "user", content }],
  });
  return firstToolUse(response)?.input as ValidatedInvoice;
}

/**
 * The retry request. Three ingredients, and dropping any one of them is
 * what makes retries not work:
 *
 *   1. the original document — otherwise the model is correcting a record
 *      against nothing, and "fixing" the arithmetic means editing whichever
 *      number makes the sum work rather than re-reading the page
 *   2. the extraction that failed — so it corrects rather than re-extracts,
 *      and the fields that were right stay right
 *   3. the SPECIFIC errors — not "that was wrong", but which field, which
 *      values, and what the rule is
 *
 * This is a fresh, stateless request rather than a continuation of the
 * conversation. The other shape — append the assistant's tool_use turn and
 * reply with a `tool_result` carrying `is_error: true` — is equally valid
 * and is what an agent loop does naturally. This version is easier to see:
 * everything the model gets is visible in one string.
 */
function retryPrompt(failed: ValidatedInvoice, errors: string[]): string {
  return [
    "Your previous extraction of this invoice failed validation.",
    "",
    "THE DOCUMENT:",
    INVOICE_MISMATCHED,
    "",
    "YOUR PREVIOUS EXTRACTION:",
    JSON.stringify(failed, null, 2),
    "",
    "VALIDATION ERRORS — fix every one of these:",
    ...errors.map((e) => `  - ${e}`),
    "",
    "Re-read the document and call the tool again with a corrected",
    "extraction. Do not change fields that were already correct. If the",
    "document itself is internally inconsistent, record both numbers and set",
    "conflict_detected — do not adjust a value to make the arithmetic work.",
  ].join("\n");
}

async function correctionLoop(
  client: Anthropic,
  first: ValidatedInvoice,
  opts: { requirePurchaseOrder?: boolean } = {},
): Promise<{ final: ValidatedInvoice; attempts: number; errors: string[] }> {
  let current = first;
  let errors = validateInvoice(current, opts);

  for (let attempt = 2; attempt <= MAX_ATTEMPTS && errors.length; attempt++) {
    console.log(`\n  attempt ${attempt} — retrying with ${errors.length} error(s)`);
    current = await extract(client, retryPrompt(current, errors));
    errors = validateInvoice(current, opts);
    console.log(
      `    -> ${errors.length ? `${errors.length} error(s) remain` : "clean"}`,
    );
    for (const e of errors) console.log(`       - ${e.slice(0, 110)}…`);
  }

  return { final: current, attempts: MAX_ATTEMPTS, errors };
}

async function partTwo(client: Anthropic) {
  console.log("\n\n════════ Part 2 — extract, validate, retry ════════");

  console.log("\n  attempt 1 — plain extraction");
  const first = await extract(client, EXTRACT_PROMPT);
  const firstErrors = validateInvoice(first);

  console.log(`    stated_total     : ${first.stated_total}`);
  console.log(`    calculated_total : ${first.calculated_total}`);
  console.log(`    conflict_detected: ${first.conflict_detected}`);
  console.log(
    `    -> ${firstErrors.length ? `${firstErrors.length} error(s)` : "clean on the first pass"}`,
  );
  for (const e of firstErrors) console.log(`       - ${e.slice(0, 110)}…`);

  if (firstErrors.length === 0) {
    // Reported rather than tuned away. The schema in extractionTools.ts asks
    // for stated_total and calculated_total as SEPARATE fields, which is
    // most of why this passes: the model never has to choose which number to
    // discard, so the disagreement survives into the output instead of being
    // silently resolved. Schema design doing the work a retry would
    // otherwise have to do is the good outcome, not a failed demo.
    console.log(
      [
        "",
        "  The first attempt validated. That is the schema earning its keep —",
        "  asking for both totals separately means the model records the",
        "  disagreement instead of picking a winner.",
        "",
        "  So the correction loop below is seeded with part 1's handcrafted bad",
        "  extraction instead, to show the mechanism working end to end.",
      ].join("\n"),
    );
    const seeded = await correctionLoop(client, BAD_EXTRACTION);
    reportFinal("seeded correction", seeded.final, seeded.errors);
    return;
  }

  const result = await correctionLoop(client, first);
  reportFinal("after retry", result.final, result.errors);
}

function reportFinal(label: string, x: ValidatedInvoice, errors: string[]) {
  const t = INVOICE_MISMATCHED_TRUTH;
  console.log(`\n  ${label}:`);
  console.log(
    `    invoice_date     : ${x.invoice_date} ${x.invoice_date === t.invoice_date_iso ? "✓" : `(truth ${t.invoice_date_iso})`}`,
  );
  console.log(
    `    currency         : ${x.currency} ${x.currency === t.currency ? "✓" : `(truth ${t.currency})`}`,
  );
  console.log(
    `    line items sum   : ${round2(x.line_items.reduce((a, li) => a + li.amount, 0))} (truth ${t.line_item_total})`,
  );
  console.log(
    `    calculated_total : ${x.calculated_total} (truth ${t.calculated_total})`,
  );
  console.log(`    stated_total     : ${x.stated_total} (truth ${t.stated_total})`);
  console.log(`    conflict_detected: ${x.conflict_detected}`);
  console.log(`    validation       : ${errors.length ? `${errors.length} error(s)` : "clean"}`);
}

// ── Part 3: the retry that cannot work ───────────────────────────────────

async function partThree(client: Anthropic) {
  console.log(
    "\n\n════════ Part 3 — the same loop, on a field that isn't there ════════",
  );
  console.log(
    [
      "",
      "  The document's PO line reads:  'Purchase order: see attached supply",
      "  agreement'. The agreement was not attached. Accounts payable cannot",
      "  post the invoice without it, so the validator now insists — and every",
      "  retry hands the model the same document, the same extraction, and one",
      "  error it has no way to fix.",
    ].join("\n"),
  );

  console.log("\n  attempt 1");
  const first = await extract(client, EXTRACT_PROMPT);
  console.log(`    purchase_order: ${JSON.stringify(first.purchase_order)}`);

  const result = await correctionLoop(client, first, { requirePurchaseOrder: true });

  console.log(`\n  after ${MAX_ATTEMPTS} attempts:`);
  console.log(`    purchase_order : ${JSON.stringify(result.final.purchase_order)}`);
  console.log(
    `    still failing  : ${result.errors.length ? "yes" : "no — see below"}`,
  );

  const po = result.final.purchase_order;
  const looksLikeReference = po ? /^[A-Za-z]{2,}[- ]?\d{2,}/.test(po.trim()) : false;

  console.log(
    [
      "",
      po === null
        ? "  It held at null for every attempt, which is the right behaviour and\n" +
          "  the reason the schema declares this field nullable (example 16).\n" +
          "  The loop still burned three calls to learn something that was\n" +
          "  knowable after the first one."
        : looksLikeReference
          ? "  It produced a PO number. There is no PO number in the document, so\n" +
            "  that value came from nowhere — and it now passes every check the\n" +
            "  validator has, which is the worst available outcome: a fabricated\n" +
            "  reference that reconciliation will discover, months later.\n" +
            "\n" +
            "  The retry loop did not fail. It succeeded at the wrong thing."
          : `  It filled the field with ${JSON.stringify(po)} — the document's own\n` +
            "  wording, moved into a data field. That is the exam's 'values in the\n" +
            "  wrong field', and it is what a model does when a validator demands\n" +
            "  a value and the page offers only a sentence about one.\n" +
            "\n" +
            "  Note which check caught it. A presence test (`!purchase_order`)\n" +
            "  passes this happily; it took a FORMAT test to notice that the\n" +
            "  string is not a purchase order reference. Presence is not\n" +
            "  validity, and the gap between them is where this class of error\n" +
            "  lives.",
      "",
      "  Either way the lesson is the same, and it is the one thing to take",
      "  from this task statement: RETRY FIXES FORM, NOT ABSENCE.",
      "",
      "    retryable      wrong format, wrong locale, value in the wrong",
      "                   field, arithmetic not carried out, a flag not set —",
      "                   everything needed is on the page and was misread.",
      "",
      "    not retryable  the information is not in the source. No number of",
      "                   attempts adds it, and each attempt raises the",
      "                   pressure to invent it.",
      "",
      "  One more thing the trace shows, and it is why the loop re-validates",
      "  the WHOLE record rather than the field it complained about: a retry",
      "  is a fresh extraction, so it can break something that was already",
      "  right. Watch the middle attempts — a corrected total arriving with a",
      "  newly wrong one somewhere else is normal. Hence 'do not change fields",
      "  that were already correct' in the retry prompt, and hence re-running",
      "  every check rather than the failed one.",
      "",
      "  So classify the error before looping. A validator that cannot tell",
      "  'you misread this' from 'this is not here' will spend real money",
      "  re-asking an unanswerable question, and may eventually get an answer.",
      "  The practical split: a field absent from the source is a routing",
      "  decision (hold the invoice, ask the supplier, escalate), not a",
      "  retry — and it needs a distinct outcome in your code, not a third",
      "  attempt.",
    ].join("\n"),
  );
}

async function main() {
  demonstrateValidator();

  const client = new Anthropic();
  await partTwo(client);
  await partThree(client);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
