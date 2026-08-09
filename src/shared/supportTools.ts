// The mock support back-end shared by examples 10-13.
//
// Three SEPARATE in-process MCP servers, on purpose. A real support agent
// talks to a CRM, an order service and a billing processor written by three
// different teams, and none of them agreed on how to encode a timestamp or a
// status. That disagreement is not a detail to tidy away in the mock — it is
// the thing example 13 exists to fix, so the mock has to actually have it:
//
//   crm.get_customer      signup_date   ISO 8601 string      verification_status  string
//   orders.get_orders     placed_at     Unix seconds (int)   status               numeric code
//   billing.get_payments  processed_at  Unix MILLIseconds    state                SCREAMING_CASE
//
// Same three concepts, three encodings, two of which look alike until one of
// them is a thousand times the other.

import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// ── tool names ───────────────────────────────────────────────────────────
// Hooks match on the fully-qualified name, so they are exported rather than
// spelled out again at each call site. A gate that silently stops matching
// because someone renamed a tool is the worst failure this file can have.

export const T_GET_CUSTOMER = "mcp__crm__get_customer";
export const T_GET_ORDERS = "mcp__orders__get_orders";
export const T_GET_PAYMENTS = "mcp__billing__get_payments";
export const T_PROCESS_REFUND = "mcp__billing__process_refund";
export const T_ESCALATE = "mcp__support__escalate_to_human";

export const ALL_SUPPORT_TOOLS = [
  T_GET_CUSTOMER,
  T_GET_ORDERS,
  T_GET_PAYMENTS,
  T_PROCESS_REFUND,
  T_ESCALATE,
];

/** Refund ceiling an agent may authorise on its own. Above this: a human. */
export const REFUND_CAP_USD = 500;

/**
 * Opening framing every support agent in examples 10-12 needs.
 *
 * This is here because of a real bug these examples hit, and it is worth
 * knowing about before you write your own persona agent. The SDK injects a
 * `# userEmail` block naming the authenticated operator into every agent's
 * context. You cannot turn it off: it survives `settingSources: []`, it
 * survives a fully custom `systemPrompt`, and it is read from the login
 * profile rather than from `CLAUDE_CODE_USER_EMAIL`, so the `env` option
 * does not override it either.
 *
 * The consequence is not subtle. Given a ticket from "alex.mercer@example.com"
 * and an ambient operator email of your own address, the model notices the
 * mismatch, decides it is being asked to act on someone else's account, and
 * refuses the whole task — which is admirable behaviour and completely
 * derails an example about refund policy. So the persona is stated
 * explicitly: this is a back-office console, and the person operating it is
 * never the customer.
 */
export const OPERATOR_FRAMING = [
  "You are an agent inside a back-office customer support console at a",
  "home-heating retailer.",
  "",
  "Every ticket you handle is ABOUT A THIRD PARTY. The account identified in",
  "your environment is the support operator running this console, not the",
  "customer, and it is irrelevant to the work — never compare it against the",
  "ticket or treat a difference between them as suspicious. The customer is",
  "whoever the ticket names, and you identify them from the ticket contents",
  "using the record tools.",
].join("\n");

// ── the data ─────────────────────────────────────────────────────────────

type Customer = {
  customer_id: string;
  email: string;
  full_name: string;
  /** ISO 8601 — the CRM team's choice. */
  signup_date: string;
  /** Free-text status, not a boolean. Only "verified" clears identity. */
  verification_status: "verified" | "pending_documents" | "failed";
  tier: string;
};

const CUSTOMERS: Customer[] = [
  {
    customer_id: "CUS-4471",
    email: "alex.mercer@example.com",
    full_name: "Alex Mercer",
    signup_date: "2023-03-14T09:12:00Z",
    verification_status: "verified",
    tier: "standard",
  },
  {
    // Present so the gate has something to actually stop. An agent that
    // merely *called* get_customer has not verified anybody if the record
    // that came back says the identity check never completed.
    customer_id: "CUS-9902",
    email: "robin.vale@example.com",
    full_name: "Robin Vale",
    signup_date: "2025-11-02T16:40:00Z",
    verification_status: "pending_documents",
    tier: "standard",
  },
];

type Order = {
  order_id: string;
  customer_id: string;
  /** Unix seconds — the orders team's choice. */
  placed_at: number;
  /** Numeric status code, meaningless without the codebook below. */
  status: number;
  total_usd: number;
  item: string;
};

/** The codebook the model would otherwise have to guess at. */
export const ORDER_STATUS_CODES: Record<number, string> = {
  1: "pending",
  2: "shipped",
  3: "delivered",
  4: "returned",
  5: "cancelled",
};

const ORDERS: Order[] = [
  {
    order_id: "ORD-1001",
    customer_id: "CUS-4471",
    placed_at: 1748347200, // 2025-05-27T12:00:00Z
    status: 3,
    total_usd: 82.5,
    item: "Thermostat control unit",
  },
  {
    order_id: "ORD-1002",
    customer_id: "CUS-4471",
    placed_at: 1751025600, // 2025-06-27T12:00:00Z
    status: 4,
    total_usd: 740.0,
    item: "Heat pump installation kit",
  },
  {
    order_id: "ORD-1003",
    customer_id: "CUS-4471",
    placed_at: 1753704000, // 2025-07-28T12:00:00Z
    status: 2,
    total_usd: 149.99,
    item: "Replacement sensor pack",
  },
  {
    order_id: "ORD-2050",
    customer_id: "CUS-9902",
    placed_at: 1762089600, // 2025-11-02T12:00:00Z
    status: 1,
    total_usd: 55.0,
    item: "Smart valve",
  },
];

type Payment = {
  payment_id: string;
  customer_id: string;
  order_id: string;
  /** Unix MILLIseconds — the billing processor's choice. */
  processed_at: number;
  state: "SETTLED" | "REFUND_PENDING" | "CHARGEBACK";
  amount_usd: number;
};

const PAYMENTS: Payment[] = [
  {
    payment_id: "PAY-77120",
    customer_id: "CUS-4471",
    order_id: "ORD-1001",
    processed_at: 1748347260000,
    state: "SETTLED",
    amount_usd: 82.5,
  },
  {
    payment_id: "PAY-77455",
    customer_id: "CUS-4471",
    order_id: "ORD-1002",
    // Charged twice — the duplicate is the root cause example 11 must find.
    processed_at: 1751025660000,
    state: "SETTLED",
    amount_usd: 740.0,
  },
  {
    payment_id: "PAY-77456",
    customer_id: "CUS-4471",
    order_id: "ORD-1002",
    processed_at: 1751025720000,
    state: "SETTLED",
    amount_usd: 740.0,
  },
  {
    // Deliberately SETTLED rather than REFUND_PENDING. An in-flight refund
    // here is realistic, but it gives the agent a sound reason to decline
    // the small refund in example 12 — which quietly removes the allowed
    // half of that example's allow-one / block-one contrast. Mock data
    // should not hand the agent an off-topic excuse.
    payment_id: "PAY-78001",
    customer_id: "CUS-4471",
    order_id: "ORD-1003",
    processed_at: 1753704060000,
    state: "SETTLED",
    amount_usd: 149.99,
  },
];

// ── the tools ────────────────────────────────────────────────────────────

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function log(line: string) {
  console.log(`        [tool] ${line}`);
}

const getCustomer = tool(
  "get_customer",
  "Look up a customer record by email address. Returns the customer_id and the identity verification status. Call this before any account-specific action.",
  { email: z.string().describe("The customer's email address") },
  async ({ email }) => {
    const hit = CUSTOMERS.find(
      (c) => c.email.toLowerCase() === email.toLowerCase().trim(),
    );
    log(`crm.get_customer(${email}) -> ${hit ? hit.customer_id : "not found"}`);
    return hit ? json(hit) : json({ error: "no customer with that email" });
  },
);

const getOrders = tool(
  "get_orders",
  "List a customer's orders. Use when a question concerns what was bought, when, or an order's fulfilment state.",
  { customer_id: z.string().describe("e.g. CUS-4471") },
  async ({ customer_id }) => {
    const hits = ORDERS.filter((o) => o.customer_id === customer_id);
    log(`orders.get_orders(${customer_id}) -> ${hits.length} orders`);
    return json(hits);
  },
);

const getPayments = tool(
  "get_payments",
  "List a customer's payment records. Use when a question concerns charges, duplicates, or refund state.",
  { customer_id: z.string().describe("e.g. CUS-4471") },
  async ({ customer_id }) => {
    const hits = PAYMENTS.filter((p) => p.customer_id === customer_id);
    log(`billing.get_payments(${customer_id}) -> ${hits.length} payments`);
    return json(hits);
  },
);

const processRefund = tool(
  "process_refund",
  "Issue a refund against an order. This moves real money and cannot be undone.",
  {
    customer_id: z.string().describe("Verified customer id, e.g. CUS-4471"),
    order_id: z.string(),
    amount_usd: z.number(),
    reason: z.string(),
  },
  async ({ customer_id, order_id, amount_usd, reason }) => {
    // Nothing in here checks anything. That is deliberate: every guarantee in
    // examples 10 and 12 comes from a hook that runs BEFORE this function,
    // so if a hook fails to fire, the money moves. Reaching this line at all
    // is the observable event those examples are testing for.
    log(
      `billing.process_refund(${customer_id}, ${order_id}, $${amount_usd.toFixed(2)}) -> EXECUTED`,
    );
    return json({
      refund_id: `REF-${Math.abs(hash(order_id + amount_usd)) % 90000 + 10000}`,
      customer_id,
      order_id,
      amount_usd,
      reason,
      state: "REFUND_ISSUED",
    });
  },
);

const escalateToHuman = tool(
  "escalate_to_human",
  "Hand the case to a human agent. The human CANNOT see this conversation, so every field must stand on its own.",
  {
    customer_id: z.string().describe("Verified customer id"),
    root_cause: z
      .string()
      .describe("What actually went wrong, with the order/payment ids that evidence it"),
    refund_amount_usd: z.number().describe("Amount at stake; 0 if none"),
    recommended_action: z
      .string()
      .describe("The specific action you recommend the human take"),
  },
  async (payload) => {
    log(`support.escalate_to_human(${payload.customer_id}) -> QUEUED`);
    return json({ ticket_id: "HND-3310", state: "QUEUED_FOR_HUMAN", ...payload });
  },
);

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// ── the servers ──────────────────────────────────────────────────────────

export const crmServer = createSdkMcpServer({
  name: "crm",
  version: "1.0.0",
  tools: [getCustomer],
});

export const ordersServer = createSdkMcpServer({
  name: "orders",
  version: "1.0.0",
  tools: [getOrders],
});

export const billingServer = createSdkMcpServer({
  name: "billing",
  version: "1.0.0",
  tools: [getPayments, processRefund],
});

export const supportServer = createSdkMcpServer({
  name: "support",
  version: "1.0.0",
  tools: [escalateToHuman],
});

export const supportMcpServers = {
  crm: crmServer,
  orders: ordersServer,
  billing: billingServer,
  support: supportServer,
};
