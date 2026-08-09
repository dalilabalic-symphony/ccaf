# Study Notes

## Coordinator/Subagent Fan-out (`src/6-coordinator-fanout.ts`)

Notes from working through the hub-and-spoke coordination example: one
coordinator delegating to research subagents and a synthesist via the
Claude Agent SDK.

### 1. MCP tool access is a two-layer scope

`mcpServers` (set on the coordinator's `query` options) and each agent's own
`tools` array control two different things:

- **`mcpServers`** — makes an MCP server's tools *available in the run at
  all*. It's the pool of tools that exist for this session.
- **Each agent's `tools` array** — decides which of those available tools
  *that specific agent* is allowed to call.

```ts
// coordinator registers the server but never lists CORPUS_TOOL_NAME itself
mcpServers: { corpus: corpusServer },
...coordinatorToolOptions,   // tools: ["Agent"] — no corpus access

// researchers opt in
tools: [CORPUS_TOOL_NAME],   // shared/researchTeam.ts:49

// synthesist opts out entirely
tools: [],                   // shared/researchTeam.ts:88
```

Mental model: `mcpServers` stocks the shelf; each agent's `tools` says what
that agent personally may take off it. The coordinator stocks the shelf but
never shops from it — it can only delegate to agents that do.

### 2. `forwardSubagentText` is an observability-only switch

By default the coordinator's stream only surfaces subagent `tool_use` /
`tool_result` events (enough for a progress counter). `forwardSubagentText:
true` additionally forwards each subagent's actual text output into the
stream, so the trace shows the full nested conversation (e.g. a
researcher's written findings) instead of just "tool called, tool
returned."

It does **not** change what data actually reaches the coordinator's or
synthesist's context — that's controlled separately by what the coordinator
chooses to copy into the next agent's prompt. It only changes what a human
watching the console sees.

### 3. How a subagent's result gets back to the coordinator

The `Agent` tool call is the entire return channel — from the coordinator
model's point of view it behaves like calling an ordinary function.

Under the hood:

1. Coordinator emits a `tool_use` block for `Agent`, with `prompt` (the
   task) and `subagent_type` (which agent definition to use).
2. The harness spins up a **fresh, isolated agent loop** for that
   subagent — its own message history, starting from the `AgentDefinition`'s
   system prompt, its own tools, its own model. Nothing of the coordinator's
   context is shared.
3. That nested loop runs to completion independently (its own turns, its
   own tool calls) in a sub-transcript the coordinator never sees directly.
4. When it finishes, the harness packages the result as an `AgentOutput`
   (final text content + metadata: `agentId`, `totalToolUseCount`, `usage`,
   etc. — see `sdk-tools.d.ts`).
5. That `AgentOutput` becomes the `tool_result` matched to the original
   `tool_use` and is spliced into the coordinator's own message history.

**Takeaway:** the subagent's entire run — however many internal turns and
tool calls it took — collapses into a single tool_result containing its
final answer text. The coordinator's context only ever sees the finished
product, never the subagent's intermediate reasoning. `forwardSubagentText`
(above) is the separate, human-facing channel that shows that intermediate
work without it entering the coordinator's actual context.

### 4. Two different things are both called "prompt"

- **`AgentInput.prompt`** (the field on the `Agent` tool_use, written fresh
  by the coordinator each call) — *"The task for the agent to perform."*
  This is the first user turn for that specific delegation, e.g. "Research
  the cost dimension of gas-boiler-vs-heat-pump retrofits in cold-climate
  Europe." Varies call to call.

- **`AgentDefinition.prompt`** (set once, in `shared/researchTeam.ts`) —
  *"The agent's system prompt."* Fixed identity/standing instructions for
  that agent type ("you research the cost dimension, cite everything, stay
  in your lane"), applied on every invocation regardless of the specific
  task sent.

So a subagent's nested loop effectively starts with:

```
system prompt   = AgentDefinition.prompt   (identity, set by the team's author)
first user turn = AgentInput.prompt        (specific task, set by the coordinator)
```

### 5. `subagent_type` picks the `AgentDefinition`

`AgentInput.subagent_type` is the **key** into the `agents` record the
coordinator was given (`researchTeam` in `shared/researchTeam.ts`) — e.g.
`"cost-researcher"`, `"performance-researcher"`, `"policy-researcher"`,
`"synthesist"`. The coordinator model picks which one to use by reading each
definition's `description` field ("use this when…" routing guidance), which
selects the system prompt, tool set, and model for that delegation.
