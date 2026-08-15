# Part 1 — Basic Agent Loop examples

Four small scripts that build up from a single Claude API call to a full agent
loop, so you can see exactly how the pieces fit together. Read them in order
and diff each one against the last — that's the point of this part.

## Running these examples

```bash
npm run basic      # 1-basic-message.ts
npm run manual     # 2-manual-loop.ts
npm run runner     # 3-tool-runner.ts
npm run agent-sdk  # 4-agent-sdk.ts
```

## What each one shows

### `npm run basic` — one request, one response

The smallest possible call to the Messages API: send a message, print the
text back. No loop, no tools. This is the shape every other example builds
on.

### `npm run manual` — the agent loop, written by hand

This is the one to read closely. An "agent loop" is just this cycle,
repeated until the model stops asking for tools:

1. Send the conversation so far, plus the tools Claude is allowed to call.
2. Claude replies with a `stop_reason`:
   - `tool_use` — Claude wants to call one or more tools.
   - `end_turn` — Claude is done; this is the final answer.
3. If it's a tool call: run the tool yourself, append the result to the
   conversation as a `tool_result`, and go back to step 1.

The script logs `stop_reason` and every content block on every turn, so
you can watch the request → tool_use → tool_result → request cycle happen
in real time.

### `npm run runner` — the same thing via the SDK's Tool Runner

Same question, same mock tool, same result — but the loop itself is now
handled by the SDK's (beta) Tool Runner. You define the tool as a typed
function and hand the whole conversation to `toolRunner`; it calls the API,
detects tool calls, runs your function, and feeds the result back
automatically, looping until Claude is done.

Compare this file to `2-manual-loop.ts` line for line: it's the same
mechanism, just with the loop itself abstracted away. In real projects,
default to the Tool Runner — the manual loop is here purely so the
mechanics aren't a black box.

### `npm run agent-sdk` — the same thing again, via the Claude Agent SDK

A different package: `@anthropic-ai/claude-agent-sdk` (not `@anthropic-ai/sdk`
used in the other three scripts) — the SDK that Claude Code itself is built
on. Instead of making Messages API calls directly, `query()` spawns a whole
agent session (its own subprocess, permission system, and built-in tools
like Bash/Read/Write) and runs its *own* agent loop internally. This example
disables all the built-in tools (`tools: []`) and gives it exactly one
custom tool — the same mock `get_weather` — registered as an in-process MCP
server via `createSdkMcpServer()` + `tool()`, so it stays comparable to the
other two.

Use this one when you want an agent that can autonomously use a whole
toolbox (files, shell, MCP servers) with minimal orchestration code of your
own. Use the Messages API + Tool Runner (examples 1-3) when you want direct
control over a small, fixed set of tools and the request/response cycle
itself — e.g. building a feature inside an existing backend rather than a
standalone coding agent.

## Notes

- Examples 1–4 use `claude-haiku-4-5` — fast and cheap, good for repeatedly
  re-running while learning. Swap the `MODEL` constant at the top of each
  file to try a different model.
- Every "tool" in this repo is a hardcoded mock — `src/shared/weatherTool.ts`
  for examples 2–4. No network calls, no extra credentials, and the same
  query returns the same records every time, so reruns differ only where
  the *model* made a different choice.
