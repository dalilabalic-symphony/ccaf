// The mock document set shared by examples 14-18.
//
// Same fictional company as the support desk in examples 10-13, one
// department over: accounts payable at a home-heating retailer. Everything
// here is a plain string — no PDFs, no OCR, no network — because the subject
// of Part 4 is what you do with the model's OUTPUT, not how the input got
// into the prompt.
//
// Every document is built around a specific extraction hazard, and the
// ground truth for each is written down next to it. That matters more here
// than anywhere else in the repo: an extraction example whose correct answer
// is not recorded cannot tell you whether the extraction was right, and
// "looks plausible" is precisely the failure mode Part 4 is about.

// ── INV-8842: the arithmetic that does not add up ────────────────────────
//
// Used by examples 14 and 17. The subtotal and the VAT line are internally
// consistent (796.99 + 159.40 = 956.39); the TOTAL DUE is not. This is what
// a transcription error looks like in the wild — not a garbled document, a
// tidy one with one wrong number in it.
//
// A schema cannot catch this. Every field is a well-formed number of the
// right type in the right place; the document is simply wrong about itself.
//
// Two more traps in here:
//   - the date is 14/03/2026, i.e. DD/MM. Read as MM/DD it becomes a date
//     that also exists, which is the dangerous kind of wrong.
//   - the purchase order is not in the document at all. It is "in the
//     attached supply agreement", which was not attached. Example 17 part 3
//     is about what retrying does for a field like that (nothing).

export const INVOICE_MISMATCHED = [
  "NORTHWIND HEATING SUPPLIES LTD",
  "Unit 7, Bexley Trade Park, Manchester M17 1QT",
  "",
  "INVOICE  INV-8842",
  "Invoice date: 14/03/2026",
  "Payment terms: 30 days from invoice date",
  "",
  "Bill to:  Hearth & Home Retail Ltd, Accounts Payable",
  "Purchase order: see attached supply agreement",
  "",
  "  3 x Heat pump mounting bracket        @ 145.00        435.00",
  "  12 x Copper flare fitting kit         @  28.50        342.00",
  "  1 x Installation manual (printed)     @  19.99         19.99",
  "",
  "                                Subtotal              796.99",
  "                                VAT @ 20%             159.40",
  "                                TOTAL DUE       GBP 1,008.38",
  "",
  "Remit to: Northwind Heating Supplies Ltd, sort 40-11-08, acct 74112390",
].join("\n");

/** Hand-computed, so the examples can grade themselves. */
export const INVOICE_MISMATCHED_TRUTH = {
  invoice_number: "INV-8842",
  /** 14/03/2026 is DD/MM/YYYY — British supplier, British format. */
  invoice_date_iso: "2026-03-14",
  currency: "GBP",
  line_item_total: 796.99,
  tax_amount: 159.4,
  /** What the arithmetic says the total should be. */
  calculated_total: 956.39,
  /** What the document claims. */
  stated_total: 1008.38,
  discrepancy: 51.99,
  /** Not in the document. Any value for this field is invented. */
  purchase_order: null,
};

// ── R-2026-0451: the sparse one ──────────────────────────────────────────
//
// Used by example 16. A small German supplier's invoice, and the point is
// everything it does NOT have: no purchase order, no tax id, no line items,
// no category that fits a tidy enum. It is not a bad document — most real
// invoices from small suppliers look like this.
//
// Format traps, all of which a schema will happily accept the wrong answer
// for, because "1.240,00" parses as a perfectly good number if you assume
// the wrong locale:
//   - 02.03.2026 is DD.MM.YYYY -> 2026-03-02, not the 3rd of February.
//   - 1.240,00 uses "." as the thousands separator and "," as the decimal
//     point -> 1240.00, not 1.24.
//   - the currency is a symbol, not a code.

export const INVOICE_SPARSE = [
  "Kessler Anlagentechnik GmbH",
  "Industriestraße 44, 45143 Essen",
  "",
  "RECHNUNG  R-2026-0451",
  "Datum: 02.03.2026",
  "",
  "Leistung: diverse Verbrauchsmaterialien Baustelle Bochum",
  "",
  "Betrag: 1.240,00 €",
  "Zahlbar innerhalb 14 Tagen ohne Abzug.",
].join("\n");

export const INVOICE_SPARSE_TRUTH = {
  invoice_number: "R-2026-0451",
  invoice_date_iso: "2026-03-02",
  currency: "EUR",
  total_amount: 1240.0,
  /** Absent from the document. Both of these must come back null. */
  purchase_order: null,
  tax_id: null,
  /**
   * "diverse Verbrauchsmaterialien" — assorted consumables. It is not
   * hardware, labour, shipping, software or utilities; it is genuinely
   * something else, and the honest answer is "other" plus the detail.
   */
  category: "other",
};

// ── Three documents of unknown type, plus one that fits nothing ──────────
//
// Used by example 15. The routing question is only interesting if the
// caller does not already know what it is holding, so these arrive as an
// undifferentiated pile.

export const PURCHASE_ORDER = [
  "HEARTH & HOME RETAIL LTD — PURCHASE ORDER",
  "",
  "PO number: PO-5567",
  "Raised: 2026-02-19",
  "Supplier: Northwind Heating Supplies Ltd",
  "Delivery to: Leeds distribution centre, bay 4",
  "Required by: 2026-03-06",
  "",
  "  20 x Heat pump mounting bracket       @ 145.00",
  "  50 x Copper flare fitting kit         @  28.50",
  "",
  "Authorised by: D. Okafor, Procurement",
  "Budget code: CAP-2026-NORTH",
].join("\n");

export const SUPPORT_EMAIL = [
  "From: alex.mercer@example.com",
  "To: support@hearthandhome.example",
  "Subject: heat pump kit arrived damaged AGAIN",
  "",
  "This is the second time. The installation kit from order ORD-1002 turned",
  "up with the manifold casing cracked right across the inlet. My installer",
  "is booked for Thursday and I have no working part.",
  "",
  "I have already paid twice for this order — please sort both out.",
  "",
  "Alex Mercer",
].join("\n");

/**
 * Fits none of the three extraction schemas. It is here specifically so
 * that `tool_choice: "any"` has something it cannot honestly classify —
 * forcing a tool call does not conjure a document type that isn't there.
 */
export const INTERNAL_MEMO = [
  "ALL STAFF — Bank holiday cover, May",
  "",
  "The Leeds distribution centre closes Monday 4 May. Goods-in reopens",
  "Tuesday at 07:00. Anyone rostered for Monday should speak to their line",
  "manager this week about swapping the shift rather than banking it.",
  "",
  "The canteen refurbishment finishes the same weekend.",
  "",
  "— Facilities",
].join("\n");

export const UNSORTED_DOCUMENTS: { label: string; text: string }[] = [
  { label: "document 1", text: INVOICE_MISMATCHED },
  { label: "document 2", text: PURCHASE_ORDER },
  { label: "document 3", text: SUPPORT_EMAIL },
  { label: "document 4", text: INTERNAL_MEMO },
];

// ── The code under review ────────────────────────────────────────────────
//
// Used by example 18. Deliberately mixed: two findings that a reviewer
// would act on, and two that a reviewer would look at and dismiss. The
// dismissible ones are not mistakes in the fixture — they are the whole
// subject of that example. You cannot study false positives without any.

export const CODE_UNDER_REVIEW = [
  "// src/orders/pricing.ts",
  "",
  "export function orderReference(): string {",
  "  // Human-facing reference printed on the packing slip. Collisions are",
  "  // checked against the DB before use; this is not a security token.",
  "  return `ORD-${Math.floor(Math.random() * 9000 + 1000)}`;",
  "}",
  "",
  "export function applyDiscount(total: string, pct: string): number {",
  "  const t = parseInt(total);",
  "  const p = parseInt(pct);",
  "  return t - (t * p) / 100;",
  "}",
  "",
  "export async function repriceAll(orderIds: string[]) {",
  "  const out = [];",
  "  for (const id of orderIds) {",
  "    out.push(await repriceOne(id));",
  "  }",
  "  return out;",
  "}",
  "",
  "export function isSettled(state: string, code: number) {",
  "  if (state == 'SETTLED') return true;",
  "  try {",
  "    return LEGACY_CODES[code].settled;",
  "  } catch {",
  "    // Legacy code table is incomplete by design; unknown codes are",
  "    // treated as unsettled and reconciled nightly.",
  "    return false;",
  "  }",
  "}",
].join("\n");

/**
 * Six months of prior review decisions, keyed by the `detected_pattern`
 * field the extraction schema asks for. This is the mock "outcome" store
 * that turns one-shot findings into a feedback loop: reviewers dismissed
 * these, and something has to notice.
 *
 * Real systems get this from whatever the reviewer clicked. The shape is
 * the part worth copying — a stable machine-readable key per finding, so
 * dismissals can be counted by CAUSE rather than by file or by wording.
 */
export const DISMISSAL_HISTORY: {
  detected_pattern: string;
  raised: number;
  dismissed: number;
}[] = [
  { detected_pattern: "math_random_for_identifier", raised: 31, dismissed: 29 },
  { detected_pattern: "empty_catch_block", raised: 24, dismissed: 22 },
  { detected_pattern: "parse_int_without_radix", raised: 12, dismissed: 2 },
  { detected_pattern: "await_in_loop", raised: 18, dismissed: 7 },
  { detected_pattern: "loose_equality", raised: 9, dismissed: 1 },
  { detected_pattern: "unbounded_array_growth", raised: 5, dismissed: 4 },
];
