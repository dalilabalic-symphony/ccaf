// The hooks shared by examples 10-13 — Task Statements 1.4 and 1.5.
//
// A hook is a function the SDK runs at a fixed point in the tool-call
// lifecycle. Two of the thirty-odd events matter here:
//
//   PreToolUse   fires after the model has asked for a tool and BEFORE the
//                tool runs. It can let the call through, rewrite its
//                arguments, or deny it outright.
//   PostToolUse  fires after the tool returns and BEFORE the model sees the
//                result. It can replace that result.
//
// Both are ordinary async TypeScript. That is the whole point of this file:
// the rules below are not requests the model may decline, they are code on
// the path between the model and the effect. A prompt saying "never refund
// more than $500" is guidance with a failure rate you cannot measure from
// one run. `if (amount > 500) return deny` has a failure rate of zero.
//
// Use a hook when a violation is unacceptable rather than merely unwanted:
// money, identity, deletion, disclosure. Use a prompt for everything else —
// hooks are blunt, they cannot weigh context, and a gate that fires on cases
// it shouldn't is its own kind of outage.

import type {
  HookCallbackMatcher,
  HookJSONOutput,
  PostToolUseHookInput,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import {
  ORDER_STATUS_CODES,
  REFUND_CAP_USD,
  T_ESCALATE,
  T_GET_CUSTOMER,
  T_GET_ORDERS,
  T_GET_PAYMENTS,
  T_PROCESS_REFUND,
} from "./supportTools.js";

// ── plumbing ─────────────────────────────────────────────────────────────

/** Let the call proceed untouched. */
const PROCEED: HookJSONOutput = { continue: true };

/**
 * Block a tool call and tell the model why.
 *
 * The reason is not a log line — it comes back to the model as an error
 * `tool_result`, so it is the only thing the model learns about the refusal.
 * Write it as an instruction it can act on ("do X instead"), not as a
 * complaint. A denial the model can't recover from just produces a stuck
 * agent apologising to the user.
 */
function deny(reason: string): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

/** Replace the tool's output with `value` before the model reads it. */
function replaceOutput(value: unknown): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      updatedToolOutput: JSON.stringify(value, null, 2),
    },
  };
}

/**
 * MCP tools hand back `[{ type: "text", text: "..." }]`, so the payload is a
 * JSON string inside a content block rather than an object. Unwrap it, and
 * return null rather than throwing if it is shaped some other way — a
 * normaliser that crashes on an unexpected result is worse than one that
 * passes it through untouched.
 */
function parseToolResponse(response: unknown): unknown | null {
  const block = Array.isArray(response) ? response[0] : response;
  const text =
    block && typeof block === "object" && "text" in block
      ? (block as { text?: unknown }).text
      : block;
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function hookLog(line: string) {
  console.log(`      [hook] ${line}`);
}

/** `matcher` is an unanchored regex over the fully-qualified tool name. */
function on(
  matcher: string,
  fn: (input: PreToolUseHookInput | PostToolUseHookInput) => Promise<HookJSONOutput>,
): HookCallbackMatcher {
  return {
    matcher,
    hooks: [
      async (input) => {
        if (
          input.hook_event_name !== "PreToolUse" &&
          input.hook_event_name !== "PostToolUse"
        ) {
          return PROCEED;
        }
        return fn(input);
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 1.4 · Programmatic prerequisite gate
//
// "Block process_refund until get_customer has returned a verified customer
// ID." The gate needs to remember something across two tool calls, so it
// owns a ledger. Because the ledger lives in a closure created per run, one
// conversation cannot inherit another's verifications.
//
// Note what is being checked. Not "did the agent call get_customer" — an
// agent can call it and get back a record saying the identity check never
// completed. The prerequisite is a *verified* id, so the ledger is written
// from the tool's RESULT (PostToolUse), not from the fact of the call.
// ─────────────────────────────────────────────────────────────────────────

export type VerificationLedger = {
  /** Customer ids whose identity check came back clean, this run. */
  verified: Set<string>;
  /** Every refund the gate refused, for the end-of-run summary. */
  blocked: { tool: string; reason: string }[];
  /** Refunds that reached the tool. Should only ever be legitimate ones. */
  executed: { customer_id: string; amount_usd: number }[];
};

export function createLedger(): VerificationLedger {
  return { verified: new Set(), blocked: [], executed: [] };
}

/**
 * PostToolUse on get_customer — record the id only if the record says the
 * identity check actually passed.
 */
function recordVerification(ledger: VerificationLedger): HookCallbackMatcher {
  return on(T_GET_CUSTOMER, async (input) => {
    if (input.hook_event_name !== "PostToolUse") return PROCEED;
    const record = parseToolResponse(input.tool_response) as {
      customer_id?: string;
      verification_status?: string;
    } | null;

    if (!record?.customer_id) return PROCEED;

    if (record.verification_status === "verified") {
      ledger.verified.add(record.customer_id);
      hookLog(`prerequisite met: ${record.customer_id} is identity-verified`);
    } else {
      hookLog(
        `prerequisite NOT met: ${record.customer_id} is "${record.verification_status}" — refunds stay blocked`,
      );
    }
    return PROCEED;
  });
}

/**
 * PreToolUse on process_refund — the gate itself.
 */
function requireVerifiedCustomer(ledger: VerificationLedger): HookCallbackMatcher {
  return on(T_PROCESS_REFUND, async (input) => {
    if (input.hook_event_name !== "PreToolUse") return PROCEED;
    const args = input.tool_input as { customer_id?: string; amount_usd?: number };
    const id = args.customer_id ?? "";

    if (!ledger.verified.has(id)) {
      const reason =
        `PREREQUISITE_NOT_MET: refunds require a verified customer id, and ` +
        `${id || "(no customer_id)"} has not been verified in this conversation. ` +
        `Call get_customer with the customer's email first. If the record comes ` +
        `back with verification_status other than "verified", do not retry the ` +
        `refund — tell the user identity verification must be completed first.`;
      ledger.blocked.push({ tool: input.tool_name, reason: "unverified customer" });
      hookLog(`DENY process_refund — ${id || "(no id)"} not verified`);
      return deny(reason);
    }

    hookLog(`allow process_refund — ${id} verified earlier this run`);
    ledger.executed.push({ customer_id: id, amount_usd: args.amount_usd ?? 0 });
    return PROCEED;
  });
}

/** The prerequisite gate, both halves. Order within the array is irrelevant. */
export function prerequisiteGate(ledger: VerificationLedger) {
  return {
    PostToolUse: [recordVerification(ledger)],
    PreToolUse: [requireVerifiedCustomer(ledger)],
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 1.5 · Tool-call interception: block a policy violation, redirect the work
//
// Denying is the easy half. The half that matters is that the denial names
// the alternative workflow, because a blocked agent with nowhere to go will
// either retry the same call or give up and tell the user nothing useful.
// Here the redirect is escalate_to_human, and the reason string tells the
// model exactly which fields that handoff needs.
// ─────────────────────────────────────────────────────────────────────────

export function refundCapGate(ledger: VerificationLedger): HookCallbackMatcher {
  return on(T_PROCESS_REFUND, async (input) => {
    if (input.hook_event_name !== "PreToolUse") return PROCEED;
    const { amount_usd } = input.tool_input as { amount_usd?: number };
    const amount = typeof amount_usd === "number" ? amount_usd : 0;

    if (amount > REFUND_CAP_USD) {
      const reason =
        `REFUND_CAP_EXCEEDED: $${amount.toFixed(2)} is above the $${REFUND_CAP_USD} ` +
        `limit an agent may authorise. This refund was NOT issued and retrying ` +
        `will fail again. Escalate instead: call escalate_to_human with ` +
        `customer_id, root_cause (naming the order and payment ids that evidence ` +
        `it), refund_amount_usd, and recommended_action.`;
      ledger.blocked.push({ tool: input.tool_name, reason: `$${amount} over cap` });
      hookLog(`DENY process_refund — $${amount.toFixed(2)} > $${REFUND_CAP_USD} cap`);
      return deny(reason);
    }

    hookLog(`allow process_refund — $${amount.toFixed(2)} within $${REFUND_CAP_USD} cap`);
    return PROCEED;
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 1.4 · The handoff contract
//
// The human picking this ticket up cannot see the transcript. So the fields
// are not paperwork — they are the entire case. A PreToolUse hook on the
// escalation tool turns "please include a root cause" from a hope into a
// precondition: an escalation missing one is refused and the model is told
// which one, in time to fix it.
// ─────────────────────────────────────────────────────────────────────────

export type HandoffSummary = {
  customer_id: string;
  root_cause: string;
  refund_amount_usd: number;
  recommended_action: string;
};

export function handoffContract(sink: { summary?: HandoffSummary }): HookCallbackMatcher {
  return on(T_ESCALATE, async (input) => {
    if (input.hook_event_name !== "PreToolUse") return PROCEED;
    const p = input.tool_input as Partial<HandoffSummary>;
    const missing: string[] = [];

    if (!p.customer_id?.trim()) missing.push("customer_id");
    // A root cause of "customer is unhappy" restates the ticket. Requiring an
    // id in it is a crude proxy for "you actually looked", but a crude check
    // that runs beats a sophisticated one in the prompt that might not.
    if (!p.root_cause || !/\b(ORD|PAY|CUS)-\d+/.test(p.root_cause)) {
      missing.push("root_cause (must cite at least one ORD-/PAY-/CUS- id as evidence)");
    }
    if (typeof p.refund_amount_usd !== "number") missing.push("refund_amount_usd");
    if (!p.recommended_action || p.recommended_action.trim().length < 15) {
      missing.push("recommended_action (must name a specific action)");
    }

    if (missing.length) {
      hookLog(`DENY escalate_to_human — incomplete handoff: ${missing.join(", ")}`);
      return deny(
        `INCOMPLETE_HANDOFF: the human agent cannot see this conversation, so ` +
          `these fields are the whole case. Missing or inadequate: ${missing.join("; ")}. ` +
          `Re-call escalate_to_human with those filled in.`,
      );
    }

    sink.summary = p as HandoffSummary;
    hookLog(`allow escalate_to_human — handoff complete`);
    return PROCEED;
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 1.5 · PostToolUse normalisation
//
// Three services, three encodings. Left alone, the model has to reconcile
// them itself on every read — and it will sometimes read 1751025660000 as a
// year in the distant future, or report status 4 as "status 4".
//
// Doing it in a hook rather than in the prompt is not just reliability. The
// normalised record costs fewer tokens to reason over, the conversion is
// unit-testable without an API call, and adding a fourth service means
// editing one function instead of every prompt that touches it.
// ─────────────────────────────────────────────────────────────────────────

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Map one record from one service onto the common shape. */
type Normaliser = (record: Record<string, unknown>) => Record<string, unknown>;

const NORMALISERS: Record<string, Normaliser> = {
  // CRM: already ISO 8601. Restated under the common key anyway — the value
  // of a canonical field is that it is present on every record, including
  // the ones that needed no conversion.
  [T_GET_CUSTOMER]: (r) => ({
    ...r,
    occurred_at_iso: r.signup_date,
    status_label: r.verification_status,
  }),

  // Orders: Unix SECONDS, and a status code that needs the codebook.
  [T_GET_ORDERS]: (r) => ({
    ...r,
    occurred_at_iso:
      typeof r.placed_at === "number" ? iso(r.placed_at * 1000) : null,
    status_label:
      typeof r.status === "number"
        ? (ORDER_STATUS_CODES[r.status] ?? `unknown_code_${r.status}`)
        : null,
  }),

  // Billing: Unix MILLIseconds — the one that silently differs from orders
  // by a factor of 1000 — and a SCREAMING_CASE state.
  [T_GET_PAYMENTS]: (r) => ({
    ...r,
    occurred_at_iso: typeof r.processed_at === "number" ? iso(r.processed_at) : null,
    status_label:
      typeof r.state === "string" ? r.state.toLowerCase() : null,
  }),
};

/**
 * The conversion for one record, independent of any hook or API call.
 *
 * Exported because that independence is half the argument for putting
 * normalisation here instead of in a prompt: this is a pure function over
 * plain data, so it can be exercised — and got wrong, and fixed — without
 * spending a token. Example 13 prints it side by side with its input.
 */
export function normalizeRecord(
  toolName: string,
  record: Record<string, unknown>,
): Record<string, unknown> {
  return (NORMALISERS[toolName] ?? ((r) => r))(record);
}

/**
 * One PostToolUse hook covering all three read tools. The matcher is a regex
 * alternation so a single registration spans the servers.
 */
export function normalizeReads(): HookCallbackMatcher {
  const matcher = `(${[T_GET_CUSTOMER, T_GET_ORDERS, T_GET_PAYMENTS].join("|")})`;

  return on(matcher, async (input) => {
    if (input.hook_event_name !== "PostToolUse") return PROCEED;
    const normalise = NORMALISERS[input.tool_name];
    if (!normalise) return PROCEED;

    const parsed = parseToolResponse(input.tool_response);
    if (parsed === null) {
      // Unrecognised shape — pass it through rather than mangle it.
      hookLog(`normalise skipped for ${input.tool_name} (unparseable result)`);
      return PROCEED;
    }

    const out = Array.isArray(parsed)
      ? parsed.map((r) => normalise(r as Record<string, unknown>))
      : normalise(parsed as Record<string, unknown>);

    const n = Array.isArray(out) ? out.length : 1;
    hookLog(
      `normalised ${n} record(s) from ${input.tool_name} -> occurred_at_iso + status_label`,
    );
    return replaceOutput(out);
  });
}

// ── an audit trail, which is most of why hooks are nice ──────────────────

/**
 * A no-op PreToolUse hook across every support tool. It changes nothing and
 * exists only to record what was attempted — including the calls that other
 * hooks go on to deny, which is exactly what a tool-result log would miss.
 */
export function auditTrail(
  entries: { tool: string; input: unknown }[],
  matcher = "mcp__(crm|orders|billing|support)__",
): HookCallbackMatcher {
  return on(matcher, async (input) => {
    if (input.hook_event_name !== "PreToolUse") return PROCEED;
    entries.push({ tool: input.tool_name, input: input.tool_input });
    return PROCEED;
  });
}

/**
 * Counts subagent spawns. `Agent` was called `Task` before Claude Code
 * 2.1.63 and the matcher is a regex, so both names are accepted — the same
 * reconciliation `trace.ts` makes.
 */
export function delegationTrail(
  entries: { tool: string; input: unknown }[],
): HookCallbackMatcher {
  return auditTrail(entries, "^(Agent|Task)$");
}

/**
 * Observation only — did money actually move?
 *
 * Example 10 has to compare a run with an enforcing gate against a run
 * without one, so the measurement cannot come from the gate. This watches
 * process_refund's RESULT instead: the mock only emits `REFUND_ISSUED` when
 * the tool body really executed, so this counts effects rather than
 * intentions. It never blocks anything.
 */
export function refundWatcher(sink: { issued: unknown[] }): HookCallbackMatcher {
  return on(T_PROCESS_REFUND, async (input) => {
    if (input.hook_event_name !== "PostToolUse") return PROCEED;
    const r = parseToolResponse(input.tool_response) as { state?: string } | null;
    if (r?.state === "REFUND_ISSUED") sink.issued.push(r);
    return PROCEED;
  });
}
