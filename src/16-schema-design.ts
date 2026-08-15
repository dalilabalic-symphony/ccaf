// Example 16 — Task Statement 4.3: the schema is not a description of the
// data. It is a set of demands, and the model will meet them.
//
// One document, three arms, two variables:
//
//   Arm A   every field required and non-nullable, enum with no escape
//           hatch, plain prompt
//   Arm B   same fields, but nullable where a document may not have them,
//           enum with `other` + detail and `unclear`, plain prompt
//   Arm C   arm B's schema, plus format normalisation rules in the prompt
//
// A vs B isolates the schema change. B vs C isolates the prompt change,
// which is the exam guide's last bullet on this task statement: format
// rules go in the PROMPT alongside a strict schema, because a schema can
// pin a value's shape and has nothing to say about its interpretation.
//
// The document is R-2026-0451 from a small German supplier. It has no
// purchase order and no tax id — not because it is a bad document, but
// because small suppliers' invoices frequently don't. It also writes its
// date as 02.03.2026 and its amount as "1.240,00 €".
//
// Every one of those is a place where a required non-nullable field asks
// the model to produce something the page does not contain, and where a
// correctly-typed answer can be off by a month or by a factor of a
// thousand. See `INVOICE_SPARSE_TRUTH` in documents.ts for what is true.

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { INVOICE_SPARSE, INVOICE_SPARSE_TRUTH } from "./shared/documents.js";
import {
  INVOICE_TOOL_ALL_REQUIRED,
  INVOICE_TOOL_NULLABLE,
  NORMALIZATION_RULES,
  T_EXTRACT_INVOICE,
  firstToolUse,
} from "./shared/extractionTools.js";

const MODEL = "claude-haiku-4-5";

// Deliberately small. Schema design is not supposed to be a thing you buy
// your way out of with a bigger model — if the fix only works on a strong
// model it is a crutch, the same argument example 13 makes about hooks.

type Extraction = {
  invoice_number?: string;
  invoice_date?: string | null;
  supplier_name?: string;
  currency?: string | null;
  total_amount?: number | null;
  purchase_order?: string | null;
  tax_id?: string | null;
  category?: string;
  category_detail?: string | null;
  notes?: string | null;
};

async function run(
  client: Anthropic,
  label: string,
  tool: Anthropic.Tool,
  withRules: boolean,
): Promise<Extraction> {
  console.log(`\n──────── ${label} ────────`);

  const prompt = [
    "Extract this invoice.",
    ...(withRules ? ["", NORMALIZATION_RULES] : []),
    "",
    INVOICE_SPARSE,
  ].join("\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [tool],
    // Forced, in all three arms. Whether a tool call happens is example 15's
    // variable; holding it fixed here means the only things that differ are
    // the schema and the prompt.
    tool_choice: { type: "tool", name: T_EXTRACT_INVOICE },
    messages: [{ role: "user", content: prompt }],
  });

  const input = (firstToolUse(response)?.input ?? {}) as Extraction;
  console.log(`  ${JSON.stringify(input, null, 2).split("\n").join("\n  ")}`);
  return input;
}

// ── grading ──────────────────────────────────────────────────────────────

type Verdict = { field: string; got: string; verdict: string };

function grade(x: Extraction): Verdict[] {
  const t = INVOICE_SPARSE_TRUTH;
  const show = (v: unknown) => (v === null || v === undefined ? "null" : String(v));

  // A required non-nullable string has two escape routes and both are bad.
  // The model either invents a plausible value, or invents a SENTINEL — a
  // placeholder string that means "absent" in a vocabulary it just made up
  // and did not tell you: <UNKNOWN>, N/A, none, "", "not provided".
  const SENTINEL =
    /^(n\/?a|unknown|none|null|nil|tbd|-{1,2}|—|not (specified|provided|available|present|found)|<[^>]*>)$/i;

  const absentField = (value: string | null | undefined, name: string): Verdict => ({
    field: name,
    got: show(value),
    verdict:
      value === null || value === undefined
        ? "correct — absent from the document"
        : SENTINEL.test(value.trim())
          ? "SENTINEL — a placeholder string sitting in a data field"
          : "FABRICATED — no such value on the page",
  });

  const dateOk = x.invoice_date === t.invoice_date_iso;
  const amountOk =
    typeof x.total_amount === "number" &&
    Math.abs(x.total_amount - t.total_amount) < 0.01;

  return [
    absentField(x.purchase_order, "purchase_order"),
    absentField(x.tax_id, "tax_id"),
    {
      field: "invoice_date",
      got: show(x.invoice_date),
      verdict: dateOk
        ? "correct"
        : `WRONG — 02.03.2026 is DD.MM.YYYY, i.e. ${t.invoice_date_iso}`,
    },
    {
      field: "total_amount",
      got: show(x.total_amount),
      verdict: amountOk
        ? "correct"
        : `WRONG — "1.240,00" is ${t.total_amount}, '.' is the thousands separator`,
    },
    {
      field: "currency",
      got: show(x.currency),
      verdict: x.currency === t.currency ? "correct" : `expected ${t.currency}`,
    },
    {
      field: "category",
      got: show(x.category) + (x.category_detail ? ` (${x.category_detail})` : ""),
      verdict:
        x.category === "other"
          ? x.category_detail
            ? "correct — outside the enum, and said what it is"
            : "'other' with no detail — the value is lost"
          : x.category === "unclear"
            ? "defensible, though the document does say what was supplied"
            : `FORCED FIT — "${show(x.category)}" is the nearest member, not the truth`,
    },
  ];
}

function report(label: string, x: Extraction) {
  console.log(`\n  ${label}`);
  for (const v of grade(x)) {
    console.log(`    ${v.field.padEnd(16)} ${v.got.padEnd(24)} ${v.verdict}`);
  }
}

async function main() {
  const client = new Anthropic();

  console.log("════════ one sparse invoice, three schema designs ════════");
  console.log(
    "\nThe document (note: no PO, no tax id, no line items):\n\n  " +
      INVOICE_SPARSE.split("\n").join("\n  "),
  );

  const a = await run(
    client,
    "Arm A — everything required, closed enum",
    INVOICE_TOOL_ALL_REQUIRED,
    false,
  );
  const b = await run(
    client,
    "Arm B — nullable fields, enum with other/unclear",
    INVOICE_TOOL_NULLABLE,
    false,
  );
  const c = await run(
    client,
    "Arm C — arm B, plus normalisation rules in the prompt",
    INVOICE_TOOL_NULLABLE,
    true,
  );

  console.log("\n\n════════ graded against the document ════════");
  report("Arm A  required, closed enum", a);
  report("Arm B  nullable, open enum", b);
  report("Arm C  nullable + normalisation rules", c);

  const fabricatedA = [a.purchase_order, a.tax_id].filter(Boolean).length;
  const fabricatedB = [b.purchase_order, b.tax_id].filter(Boolean).length;

  // B vs C is the arm pair that does not always separate — reported from
  // what actually came back rather than asserted.
  const formatFields = (x: Extraction) =>
    `${x.invoice_date}/${x.total_amount}/${x.currency}`;
  const rulesChangedSomething = formatFields(b) !== formatFields(c);

  console.log(
    [
      "",
      "What to notice:",
      "",
      "  1. `required` and `nullable` are different axes, and conflating them",
      "     is the most expensive schema mistake on this page. Arm B keeps",
      "     every field in `required` — the KEY is always present, so nothing",
      "     downstream needs an `undefined` check — while allowing the VALUE",
      "     to be null. Completeness guarantee kept, fabrication pressure",
      "     removed.",
      "",
      `     Arm A put a value in ${fabricatedA} field(s) that are not on the page; arm B, ${fabricatedB}.`,
      "     Arm A was not being careless: a required non-nullable string leaves",
      "     no legal way to say 'not present', and the model did the only thing",
      "     the schema allowed.",
      "",
      "     Look at WHAT arm A put there. If it invented a plausible number,",
      "     the record is now quietly false. If it invented a sentinel —",
      "     `<UNKNOWN>`, `N/A`, `none` — it is telling you the field is absent",
      "     in a private vocabulary it made up on the spot and did not",
      "     document. That is not better; it is the same absence, encoded in a",
      "     way `if (invoice.purchase_order)` reads as present, and it will be",
      "     spelled differently next run. `null` is the encoding both ends",
      "     already agree on.",
      "",
      "  2. A fabricated field is worse than a missing one, because it is",
      "     indistinguishable from a real one. A null is a fact you can route",
      "     on — flag for a human, block the payment run, ask the supplier. An",
      "     invented PO number posts cleanly to the ledger and is discovered",
      "     at reconciliation, if at all.",
      "",
      "  3. `other` + detail, and `unclear`, are two different escape hatches",
      "     and both are needed. `other` means the taxonomy is incomplete —",
      "     read the detail field and decide whether it deserves an enum",
      "     member. `unclear` means the DOCUMENT is incomplete — go and ask.",
      "     Collapse them into one value and you lose the ability to tell an",
      "     ontology problem from a data problem.",
      "",
      "  4. Arm B versus arm C is about format, and it is the arm pair that",
      "     does not always separate:",
      "",
      rulesChangedSomething
        ? "     the normalisation rules changed the answer this run — diff the two\n" +
          "     arms' date, amount and currency above."
        : "     both arms got the date, the amount and the currency right this\n" +
          "     run, so the rules changed nothing. Report that rather than\n" +
          "     hiding it — and then notice what it does and does not license.\n" +
          "     '02.03.2026' still has two readings and '1.240,00' still has\n" +
          "     two; the model resolved both correctly, unprompted, on this\n" +
          "     document today. The rules are what makes that a property of\n" +
          "     the pipeline instead of a property of this run, and the arm\n" +
          "     that matters is the one you cannot see: a US-formatted invoice\n" +
          "     in the same batch, where the same instinct is wrong.",
      "",
      "     What is fixed either way is the division of labour. Both arms have",
      "     the identical strict schema, and no schema can distinguish",
      "     2026-02-03 from 2026-03-02, or 1.24 from 1240.00 — both readings",
      "     are valid values of the declared type, so the schema has already",
      "     done everything it can. The schema constrains the SHAPE; the rules",
      "     resolve the SOURCE. You need both, and they live in different",
      "     places.",
      "",
      "  5. Compare this with example 13. There, heterogeneous formats were",
      "     normalised in a PostToolUse hook, deterministically, because the",
      "     conversion was known in advance. Here the conversion depends on",
      "     reading the document, so it happens in the model and the rules go",
      "     in the prompt. Same problem, and the fix moves depending on",
      "     whether the ambiguity is resolvable in code.",
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
