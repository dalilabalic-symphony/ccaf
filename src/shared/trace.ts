// A printer for the coordinator's message stream.
//
// This exists to make one property of hub-and-spoke visible: *everything*
// comes back through the coordinator's stream. Subagents don't talk to each
// other and they don't talk to you — their activity surfaces here, tagged
// with `parent_tool_use_id`, or it doesn't surface at all. That single
// choke point is what makes the pattern observable and what lets you handle
// every subagent failure in one place.

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

// The tool that spawns subagents was renamed `Task` -> `Agent` in the
// Claude Code 2.1.63 era. Newer SDKs emit `Agent`; older ones still emit
// `Task` in places (notably the `system:init` tool list). Accept both
// everywhere rather than betting on one.
export const AGENT_TOOL_NAMES = ["Agent", "Task"] as const;

export function isAgentTool(name: string): boolean {
  return (AGENT_TOOL_NAMES as readonly string[]).includes(name);
}

/** Short stable label per subagent invocation, e.g. `cost-researcher#1`. */
function labeller() {
  const labels = new Map<string, string>();
  const counts = new Map<string, number>();
  return {
    assign(toolUseId: string, subagentType: string) {
      const n = (counts.get(subagentType) ?? 0) + 1;
      counts.set(subagentType, n);
      labels.set(toolUseId, `${subagentType}#${n}`);
    },
    get(toolUseId: string | null | undefined) {
      if (!toolUseId) return null;
      return labels.get(toolUseId) ?? `subagent(${toolUseId.slice(-6)})`;
    },
  };
}

export type TraceOptions = {
  /** Print each subagent's own text, not just its tool calls. Requires
   *  `forwardSubagentText: true` on the query options. */
  showSubagentText?: boolean;
};

/**
 * Consumes a `query()` stream, prints an indented coordinator/subagent
 * trace, and returns the final result text.
 */
export async function trace(
  stream: AsyncIterable<SDKMessage>,
  opts: TraceOptions = {},
): Promise<string> {
  const labels = labeller();
  let finalText = "";
  let lastResult: Extract<SDKMessage, { type: "result" }> | null = null;

  for await (const message of stream) {
    // `parent_tool_use_id` is the whole story: null means the coordinator
    // itself is speaking, non-null means this came from the subagent that
    // the identified Agent tool call spawned.
    const parent =
      "parent_tool_use_id" in message ? message.parent_tool_use_id : null;
    const who = labels.get(parent);
    const indent = who ? "    " : "  ";
    const tag = who ? `[${who}]` : "[coordinator]";

    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          if (isAgentTool(block.name)) {
            // The coordinator is delegating. Record the label so every
            // later message carrying this tool_use_id is attributable.
            const input = block.input as {
              subagent_type?: string;
              description?: string;
              prompt?: string;
            };
            const type = input.subagent_type ?? "general-purpose";
            labels.assign(block.id, type);
            console.log(
              `${indent}${tag} delegate -> ${type}: ${input.description ?? ""}`,
            );
            // The prompt is the ENTIRE context the subagent will have.
            // Printing it makes that concrete.
            const prompt = (input.prompt ?? "").replace(/\s+/g, " ");
            console.log(
              `${indent}    prompt (${prompt.length} chars): ${truncate(prompt, 220)}`,
            );
          } else {
            const input = JSON.stringify(block.input);
            console.log(`${indent}${tag} tool ${block.name} ${truncate(input, 160)}`);
          }
        } else if (block.type === "text" && block.text.trim()) {
          if (who && !opts.showSubagentText) continue;
          console.log(`${indent}${tag} ${truncate(block.text.trim(), 400)}`);
        }
      }
    } else if (message.type === "result") {
      // Each finished subagent emits a result too, and result messages do
      // NOT carry `parent_tool_use_id` — so we can't attribute them the way
      // we attribute assistant messages. What we can rely on is ordering:
      // subagents finish before the coordinator does, so the last result of
      // the stream is the session's, and its cost is the cumulative total.
      lastResult = message;
      console.log(
        `  ··· a task finished (${message.subtype}) · running total $${message.total_cost_usd?.toFixed(4) ?? "?"}`,
      );
      if (message.subtype === "success") finalText = message.result;
    }
  }

  if (lastResult) {
    console.log(
      `\n  === session complete (${lastResult.subtype}) · $${lastResult.total_cost_usd?.toFixed(4) ?? "?"} total ===`,
    );
  }

  return finalText;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}
