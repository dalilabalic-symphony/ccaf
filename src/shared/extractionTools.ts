// The extraction tools, schemas and validators shared by examples 14-18.
//
// Everything in here is a raw JSON-schema tool definition in the shape the
// Messages API takes directly (same style as `weatherTool.ts` in Part 1),
// rather than a Zod-derived one. That is deliberate for this part: Task 4.3
// is about the SCHEMA — required vs optional, enum shape, nullability — and
// a schema you can read line by line is easier to argue with than a schema
// generated from something else.
//
// Two ideas run through the whole file:
//
//   1. A tool schema buys you SYNTAX, not TRUTH. `tool_use.input` is
//      guaranteed to be a JSON object of the declared shape. Nothing in a
//      schema can say "the line items must sum to the total" or "do not
//      invent a purchase order number" — those are semantics, and semantics
//      are enforced by the validators at the bottom of this file.
//
//   2. Fields the model cannot fill must have somewhere honest to go.
//      A required non-nullable string on a document that doesn't contain
//      the value is an instruction to make one up.

import type Anthropic from "@anthropic-ai/sdk";

// ── tool names, as constants ─────────────────────────────────────────────
// Same reasoning as the MCP tool names in Part 3: the name is matched
// against `block.name` at every call site, and a rename that silently stops
// matching is the failure mode this design is most exposed to.

export const T_EXTRACT_INVOICE = "extract_invoice";
export const T_EXTRACT_PURCHASE_ORDER = "extract_purchase_order";
export const T_EXTRACT_SUPPORT_TICKET = "extract_support_ticket";
export const T_EXTRACT_METADATA = "extract_metadata";
export const T_REPORT_FINDINGS = "report_findings";

// ── the normalisation rules ──────────────────────────────────────────────
//
// The exam guide's own point, and the one thing on this page that is NOT a
// schema: a strict output schema fixes the SHAPE of a value, never its
// interpretation. `"2026-02-03"` and `"2026-03-02"` are both valid
// `format: "date"` strings; only one of them is what 02.03.2026 meant.
//
// So format rules live in the prompt, next to the schema, and they are
// written as rules about the SOURCE ("a European supplier writes…"), not as
// rules about the output ("use ISO dates"), because the ambiguity being
// resolved is in the input.

export const NORMALIZATION_RULES = [
  "Normalisation rules — apply these when reading the document:",
  "",
  "  DATES. Output every date as YYYY-MM-DD. Decide the source format from",
  "  the document's origin: UK and European suppliers write DD/MM/YYYY or",
  "  DD.MM.YYYY, US suppliers write MM/DD/YYYY. '14/03/2026' can only be",
  "  14 March; '02.03.2026' from a German supplier is 2 March, not 3 Feb.",
  "",
  "  NUMBERS. Output every amount as a plain decimal, no separators, no",
  "  symbol. German and other continental formats use '.' as the thousands",
  "  separator and ',' as the decimal point: '1.240,00' is 1240.00, and",
  "  '1,008.38' in a UK document is 1008.38.",
  "",
  "  CURRENCY. Output the ISO 4217 code, not the symbol: € is EUR, £ is",
  "  GBP, $ on a UK or German document is ambiguous — say so rather than",
  "  guessing USD.",
].join("\n");

// ── shared schema fragments ──────────────────────────────────────────────

const LINE_ITEM_SCHEMA = {
  type: "object" as const,
  properties: {
    description: { type: "string" },
    quantity: { type: "number" },
    unit_price: { type: "number" },
    amount: {
      type: "number",
      description: "Line total as printed on the document",
    },
  },
  required: ["description", "quantity", "unit_price", "amount"],
};

/**
 * The extensible-category pattern the exam asks for: a closed enum for the
 * cases you know, plus `other`, plus a free-text field to carry what
 * `other` actually was, plus `unclear` for "the document does not say".
 *
 * `other` and `unclear` are not the same value and collapsing them loses
 * the distinction that matters downstream — `other` is a category you have
 * not modelled yet (someone should look at the detail field and decide
 * whether it deserves an enum member); `unclear` is missing information
 * (someone should go and ask the supplier).
 */
export const CATEGORY_ENUM = [
  "hardware",
  "labour",
  "shipping",
  "software",
  "utilities",
  "other",
  "unclear",
];

// ── example 14: the minimal tool, with strict mode on ────────────────────
//
// `strict: true` is the strongest form of the syntax guarantee: the API
// validates `input` against this schema before the block reaches you, so
// the extra field or missing key that a large schema occasionally produces
// is rejected server-side rather than by your code. It requires
// `additionalProperties: false` and a `required` list that names every
// property — which is exactly why the nullable pattern below exists.

export const INVOICE_TOOL_MINIMAL: Anthropic.Tool = {
  name: T_EXTRACT_INVOICE,
  description:
    "Record the structured contents of a supplier invoice. Call this once per invoice.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      invoice_number: { type: "string", description: "e.g. INV-8842" },
      invoice_date: { type: "string", description: "YYYY-MM-DD" },
      supplier_name: { type: "string" },
      currency: { type: "string", description: "ISO 4217 code, e.g. GBP" },
      total_amount: {
        type: "number",
        description: "The total the document states is due",
      },
    },
    required: [
      "invoice_number",
      "invoice_date",
      "supplier_name",
      "currency",
      "total_amount",
    ],
    additionalProperties: false,
  },
};

// ── example 16: the same extraction, designed two ways ───────────────────

/**
 * Arm A. Every field required, every field non-nullable, category enum with
 * no escape hatch. This is the schema everybody writes first, and it is a
 * demand: the model MUST produce a `purchase_order` string, so on a
 * document that has no purchase order it will produce one anyway.
 */
export const INVOICE_TOOL_ALL_REQUIRED: Anthropic.Tool = {
  name: T_EXTRACT_INVOICE,
  description: "Record the structured contents of a supplier invoice.",
  input_schema: {
    type: "object",
    properties: {
      invoice_number: { type: "string" },
      invoice_date: { type: "string", description: "YYYY-MM-DD" },
      supplier_name: { type: "string" },
      currency: { type: "string", description: "ISO 4217 code" },
      total_amount: { type: "number" },
      purchase_order: { type: "string", description: "Customer PO number" },
      tax_id: { type: "string", description: "Supplier VAT / tax number" },
      category: {
        type: "string",
        enum: ["hardware", "labour", "shipping", "software", "utilities"],
      },
    },
    required: [
      "invoice_number",
      "invoice_date",
      "supplier_name",
      "currency",
      "total_amount",
      "purchase_order",
      "tax_id",
      "category",
    ],
  },
};

/**
 * Arm B. Same fields, three changes:
 *
 *   - the fields a document may legitimately not contain are `["string",
 *     "null"]`, and their descriptions say so out loud. Note they stay in
 *     `required` — "required" means the KEY must be present, not that a
 *     value must be invented. That distinction is the whole trick: you keep
 *     the completeness guarantee (every key, every time, so no downstream
 *     `undefined` checks) and drop the fabrication pressure.
 *   - the category enum gains `other` and `unclear`, plus a detail string.
 *   - a `notes` field, so anything the model wants to say has a place to go
 *     that is not one of the data fields.
 */
export const INVOICE_TOOL_NULLABLE: Anthropic.Tool = {
  name: T_EXTRACT_INVOICE,
  description: "Record the structured contents of a supplier invoice.",
  input_schema: {
    type: "object",
    properties: {
      invoice_number: { type: "string" },
      invoice_date: {
        type: ["string", "null"],
        description: "YYYY-MM-DD. null if the document states no date.",
      },
      supplier_name: { type: "string" },
      currency: {
        type: ["string", "null"],
        description:
          "ISO 4217 code. null if the document gives no currency at all.",
      },
      total_amount: { type: ["number", "null"] },
      purchase_order: {
        type: ["string", "null"],
        description:
          "Customer PO number. MUST be null if the document does not contain one — do not infer it from anything else.",
      },
      tax_id: {
        type: ["string", "null"],
        description:
          "Supplier VAT / tax number. MUST be null if not printed on the document.",
      },
      category: {
        type: "string",
        enum: CATEGORY_ENUM,
        description:
          "'other' = a real category outside this list (put it in category_detail). 'unclear' = the document does not say.",
      },
      category_detail: {
        type: ["string", "null"],
        description:
          "Required when category is 'other': what the goods or services actually were, in the document's own words.",
      },
      notes: {
        type: ["string", "null"],
        description:
          "Anything ambiguous or unusual about this document. Put uncertainty here rather than into a data field.",
      },
    },
    required: [
      "invoice_number",
      "invoice_date",
      "supplier_name",
      "currency",
      "total_amount",
      "purchase_order",
      "tax_id",
      "category",
      "category_detail",
      "notes",
    ],
  },
};

// ── example 15: three schemas, one unknown document ──────────────────────

/**
 * The router. Deliberately cheap — it reads the top of a document and says
 * what it is, nothing more. `document_type` carries `unclear` for the same
 * reason the category enum does: a forced tool call can be made to happen,
 * but a confident answer cannot, and a router with no way to say "I don't
 * know" launches the wrong pipeline instead of stopping.
 */
export const METADATA_TOOL: Anthropic.Tool = {
  name: T_EXTRACT_METADATA,
  description:
    "Record what kind of document this is and its identifying details. Always call this first, before any type-specific extraction.",
  input_schema: {
    type: "object",
    properties: {
      document_type: {
        type: "string",
        enum: ["invoice", "purchase_order", "support_ticket", "other", "unclear"],
      },
      document_id: {
        type: ["string", "null"],
        description: "Reference printed on the document, null if there is none",
      },
      issuer: { type: ["string", "null"] },
      issued_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
      type_detail: {
        type: ["string", "null"],
        description: "Required when document_type is 'other': what it is",
      },
    },
    required: [
      "document_type",
      "document_id",
      "issuer",
      "issued_date",
      "type_detail",
    ],
  },
};

export const PURCHASE_ORDER_TOOL: Anthropic.Tool = {
  name: T_EXTRACT_PURCHASE_ORDER,
  description:
    "Record the contents of a PURCHASE ORDER — a document ordering goods, raised by the buyer before delivery. Not for invoices, which request payment after the fact.",
  input_schema: {
    type: "object",
    properties: {
      po_number: { type: "string" },
      supplier_name: { type: "string" },
      required_by: { type: ["string", "null"], description: "YYYY-MM-DD" },
      budget_code: { type: ["string", "null"] },
      line_items: { type: "array", items: LINE_ITEM_SCHEMA },
    },
    required: [
      "po_number",
      "supplier_name",
      "required_by",
      "budget_code",
      "line_items",
    ],
  },
};

export const SUPPORT_TICKET_TOOL: Anthropic.Tool = {
  name: T_EXTRACT_SUPPORT_TICKET,
  description:
    "Record the contents of a CUSTOMER SUPPORT message — a complaint, question or request from a customer. Not for invoices or purchase orders.",
  input_schema: {
    type: "object",
    properties: {
      customer_email: { type: ["string", "null"] },
      order_reference: { type: ["string", "null"] },
      concerns: {
        type: "array",
        items: { type: "string" },
        description: "One entry per distinct concern raised",
      },
      urgency: { type: "string", enum: ["low", "normal", "high", "unclear"] },
    },
    required: ["customer_email", "order_reference", "concerns", "urgency"],
  },
};

/** The invoice schema for the routing example — same shape as the others. */
export const INVOICE_TOOL_ROUTED: Anthropic.Tool = {
  name: T_EXTRACT_INVOICE,
  description:
    "Record the contents of a SUPPLIER INVOICE — a document requesting payment for goods or services already supplied. Not for purchase orders, which order goods in advance.",
  input_schema: {
    type: "object",
    properties: {
      invoice_number: { type: "string" },
      supplier_name: { type: "string" },
      invoice_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
      currency: { type: ["string", "null"] },
      total_amount: { type: ["number", "null"] },
    },
    required: [
      "invoice_number",
      "supplier_name",
      "invoice_date",
      "currency",
      "total_amount",
    ],
  },
};

// ── example 17: the self-checking invoice schema ─────────────────────────
//
// Three fields here exist purely so that a semantic error becomes visible
// in the output instead of hiding in it:
//
//   stated_total     — what the document claims
//   calculated_total — what the line items and tax add up to
//   conflict_detected — the model's own verdict on whether those agree
//
// Asking for both totals separately is the trick. A single `total` field
// forces the model to pick one and silently discard the disagreement; two
// fields make the disagreement a value you can test, and the validator at
// the bottom of this file does exactly that — without trusting
// `conflict_detected`, which is the model's opinion, not a measurement.

export const INVOICE_TOOL_VALIDATED: Anthropic.Tool = {
  name: T_EXTRACT_INVOICE,
  description:
    "Record the structured contents of a supplier invoice, including both the total the document states and the total its own line items add up to.",
  input_schema: {
    type: "object",
    properties: {
      invoice_number: { type: "string" },
      invoice_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
      supplier_name: { type: "string" },
      currency: { type: ["string", "null"], description: "ISO 4217 code" },
      purchase_order: {
        type: ["string", "null"],
        description:
          "Customer PO number. MUST be null if the document does not contain one.",
      },
      line_items: { type: "array", items: LINE_ITEM_SCHEMA },
      tax_amount: { type: ["number", "null"] },
      stated_total: {
        type: "number",
        description: "The total printed on the document, exactly as printed",
      },
      calculated_total: {
        type: "number",
        description:
          "The sum of the line item amounts plus tax_amount, computed from the values in this extraction",
      },
      conflict_detected: {
        type: "boolean",
        description:
          "true if stated_total and calculated_total disagree by more than 0.01",
      },
      conflict_note: {
        type: ["string", "null"],
        description: "If conflict_detected, what disagrees and by how much",
      },
    },
    required: [
      "invoice_number",
      "invoice_date",
      "supplier_name",
      "currency",
      "purchase_order",
      "line_items",
      "tax_amount",
      "stated_total",
      "calculated_total",
      "conflict_detected",
      "conflict_note",
    ],
  },
};

export type ValidatedInvoice = {
  invoice_number: string;
  invoice_date: string | null;
  supplier_name: string;
  currency: string | null;
  purchase_order: string | null;
  line_items: {
    description: string;
    quantity: number;
    unit_price: number;
    amount: number;
  }[];
  tax_amount: number | null;
  stated_total: number;
  calculated_total: number;
  conflict_detected: boolean;
  conflict_note: string | null;
};

// ── example 18: findings, with a machine-readable cause ──────────────────

/**
 * `detected_pattern` is the field the exam guide singles out, and it is the
 * only thing here that makes a feedback loop possible. A finding's title is
 * prose and will be worded differently every run; the file and line move
 * with the next commit. A stable pattern key survives both, so dismissals
 * can be counted by CAUSE — which construct keeps producing findings nobody
 * acts on — rather than by wording.
 *
 * Enum-with-`other`, again, and for the same reason: a fixed list of
 * patterns would quietly relabel anything new as the nearest known one,
 * which is exactly the data corruption the loop is trying to measure.
 */
export const FINDINGS_TOOL: Anthropic.Tool = {
  name: T_REPORT_FINDINGS,
  description:
    "Record every issue found in the code under review. Call once, with all findings.",
  input_schema: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "One line, plain English" },
            symbol: {
              type: "string",
              description: "The function or export the finding is in",
            },
            severity: {
              type: "string",
              enum: ["high", "medium", "low", "unclear"],
            },
            detected_pattern: {
              type: "string",
              description:
                "Stable snake_case key for the CODE CONSTRUCT that triggered this finding, not for this specific instance. Reuse the same key for the same construct across files and runs: math_random_for_identifier, empty_catch_block, parse_int_without_radix, await_in_loop, loose_equality, unbounded_array_growth. Use a new snake_case key if none of those fit.",
            },
            rationale: { type: "string" },
          },
          required: [
            "title",
            "symbol",
            "severity",
            "detected_pattern",
            "rationale",
          ],
        },
      },
    },
    required: ["findings"],
  },
};

export type Finding = {
  title: string;
  symbol: string;
  severity: "high" | "medium" | "low" | "unclear";
  detected_pattern: string;
  rationale: string;
};

// ── response helpers ─────────────────────────────────────────────────────

/** The first `tool_use` block, or null if the model answered in prose. */
export function firstToolUse(
  response: Anthropic.Message,
): Anthropic.ToolUseBlock | null {
  for (const block of response.content) {
    if (block.type === "tool_use") return block;
  }
  return null;
}

/** Every text block, joined. Empty string when the model only called tools. */
export function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/**
 * The salvage path you need when JSON arrives as prose — and do not need at
 * all when it arrives as `tool_use.input`.
 *
 * Every repair here is a guess about what the model meant. They are all
 * ordinary and they all mostly work, which is the problem: this function
 * fails silently and differently depending on what the model wrapped its
 * answer in today. Example 14 exercises it on fixtures, with no API call.
 */
export function parseLooseJson(text: string): {
  ok: boolean;
  value: unknown;
  repairs: string[];
  error?: string;
} {
  const repairs: string[] = [];
  let candidate = text.trim();

  const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    candidate = fenced[1].trim();
    repairs.push("stripped a markdown code fence");
  }

  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace > 0 || (lastBrace !== -1 && lastBrace < candidate.length - 1)) {
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      candidate = candidate.slice(firstBrace, lastBrace + 1);
      repairs.push("cut prose from around the object");
    }
  }

  const withoutTrailingCommas = candidate.replace(/,(\s*[}\]])/g, "$1");
  if (withoutTrailingCommas !== candidate) {
    candidate = withoutTrailingCommas;
    repairs.push("removed a trailing comma");
  }

  try {
    return { ok: true, value: JSON.parse(candidate), repairs };
  } catch (err) {
    return {
      ok: false,
      value: null,
      repairs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── semantic validation ──────────────────────────────────────────────────
//
// The half a schema cannot do. Each of these is a rule ABOUT the values,
// and each one is a pure function of the extraction — no model, no API, no
// tokens, testable in CI, and (this is the part that matters for the retry
// loop) each returns a message written for the model to act on rather than
// for a log file to swallow.

/**
 * Semantic checks against one extracted invoice.
 *
 * `requirePurchaseOrder` is passed in rather than inferred because it is
 * a fact about the DOCUMENT, and example 17 needs to demonstrate what
 * happens when a validator demands a field the source simply does not have.
 */
export function validateInvoice(
  x: ValidatedInvoice,
  opts: { requirePurchaseOrder?: boolean } = {},
): string[] {
  const errors: string[] = [];

  const lineSum = x.line_items.reduce((acc, li) => acc + (li.amount ?? 0), 0);
  const expected = round2(lineSum + (x.tax_amount ?? 0));

  if (x.line_items.length === 0) {
    errors.push(
      "line_items is empty, but the document lists individual priced lines. Extract every line.",
    );
  }

  for (const li of x.line_items) {
    const product = round2(li.quantity * li.unit_price);
    if (Math.abs(product - round2(li.amount)) > 0.01) {
      errors.push(
        `line item "${li.description}": quantity ${li.quantity} x unit_price ${li.unit_price} = ${product}, but amount is ${li.amount}. One of the three is misread.`,
      );
    }
  }

  if (Math.abs(round2(x.calculated_total) - expected) > 0.01) {
    errors.push(
      `calculated_total is ${x.calculated_total}, but the line items in this extraction sum to ${round2(lineSum)} and tax_amount is ${x.tax_amount ?? 0}, giving ${expected}. calculated_total must be computed from the values you extracted.`,
    );
  }

  const disagree = Math.abs(round2(x.stated_total) - expected) > 0.01;
  if (disagree && !x.conflict_detected) {
    errors.push(
      `stated_total (${x.stated_total}) and the arithmetic (${expected}) differ by ${round2(Math.abs(x.stated_total - expected))}, so conflict_detected must be true and conflict_note must say what disagrees.`,
    );
  }
  if (!disagree && x.conflict_detected) {
    errors.push(
      `conflict_detected is true, but stated_total (${x.stated_total}) matches the arithmetic (${expected}). Set it to false.`,
    );
  }
  if (x.conflict_detected && !x.conflict_note) {
    errors.push("conflict_detected is true but conflict_note is null.");
  }

  if (x.invoice_date && !/^\d{4}-\d{2}-\d{2}$/.test(x.invoice_date)) {
    errors.push(
      `invoice_date "${x.invoice_date}" is not YYYY-MM-DD. Re-read the document's date format and convert it.`,
    );
  }

  if (x.currency && !/^[A-Z]{3}$/.test(x.currency)) {
    errors.push(
      `currency "${x.currency}" is not a 3-letter ISO 4217 code (e.g. GBP, EUR).`,
    );
  }

  if (opts.requirePurchaseOrder) {
    // Two checks, not one. "Is it present" is the check everybody writes,
    // and a field under pressure gets filled with whatever is nearby — a
    // sentinel, or the sentence the document used instead of a number.
    // Presence is not validity, and a validator that only tests for null
    // will pass `"see attached supply agreement"` as a purchase order.
    if (!x.purchase_order) {
      errors.push(
        "purchase_order is null. Accounts payable cannot post an invoice without a PO number — find it and fill this field.",
      );
    } else if (!/^[A-Za-z]{2,}[- ]?\d{2,}/.test(x.purchase_order.trim())) {
      errors.push(
        `purchase_order "${x.purchase_order}" is not a purchase order reference — those look like "PO-5567". Copying the document's wording into the field does not fill it.`,
      );
    }
  }

  return errors;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
